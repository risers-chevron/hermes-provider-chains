import importlib.util
import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)

# Load shared sync helpers from the plugin root (_sync.py).
_spec = importlib.util.spec_from_file_location(
    "_pc_sync", Path(__file__).parent.parent / "_sync.py"
)
_pc_sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pc_sync)

_base_hermes_home = _pc_sync.base_hermes_home
_sync_virtual_providers = _pc_sync.sync_virtual_providers


def _chains_file() -> Path:
    return _base_hermes_home() / "chains.json"


def _load() -> dict:
    import json
    f = _chains_file()
    if not f.exists():
        return {"version": 1, "chains": {}}
    try:
        return json.loads(f.read_text())
    except Exception:
        return {"version": 1, "chains": {}}


def _save(data: dict) -> None:
    import json
    f = _chains_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(f)


class ChainEntry(BaseModel):
    provider: str
    model: Optional[str] = None
    timeout: Optional[int] = None           # seconds; overrides profile default
    max_tokens: Optional[int] = None        # cap output tokens for this provider
    temperature: Optional[float] = None     # sampling temperature (0.0–2.0)
    retry_count: Optional[int] = None       # retries before advancing to next entry
    base_url: Optional[str] = None          # override provider base URL
    api_key: Optional[str] = None           # override provider API key
    thinking: Optional[bool] = None         # enable/disable extended thinking
    thinking_effort: Optional[str] = None   # "low", "medium", "high"


class ChainCreate(BaseModel):
    name: str
    label: Optional[str] = None
    entries: List[ChainEntry] = []


class ChainUpdate(BaseModel):
    label: Optional[str] = None
    entries: List[ChainEntry]


@router.get("/chains")
async def list_chains():
    data = _load()
    return {"chains": data.get("chains", {})}


@router.post("/chains")
async def create_chain(body: ChainCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Chain name is required")
    if not all(c.isalnum() or c in "-_" for c in name):
        raise HTTPException(
            status_code=400,
            detail="Chain name may only contain letters, numbers, hyphens, and underscores",
        )
    data = _load()
    chains = data.setdefault("chains", {})
    if name in chains:
        raise HTTPException(status_code=409, detail=f"Chain '{name}' already exists")
    chains[name] = {
        "label": (body.label or name).strip(),
        "entries": [e.model_dump() for e in body.entries],
    }
    _save(data)
    _sync_virtual_providers()
    return {"name": name, "chain": chains[name]}


@router.put("/chains/{name}")
async def update_chain(name: str, body: ChainUpdate):
    data = _load()
    chains = data.get("chains", {})
    if name not in chains:
        raise HTTPException(status_code=404, detail=f"Chain '{name}' not found")
    chain = chains[name]
    if body.label is not None:
        chain["label"] = body.label.strip()
    chain["entries"] = [e.model_dump() for e in body.entries]
    _save(data)
    return {"name": name, "chain": chain}


@router.delete("/chains/{name}")
async def delete_chain(name: str):
    data = _load()
    if name not in data.get("chains", {}):
        raise HTTPException(status_code=404, detail=f"Chain '{name}' not found")
    del data["chains"][name]
    _save(data)
    _sync_virtual_providers()
    return {"deleted": name}
