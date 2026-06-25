"""
Shared sync helpers for provider-chains.

Handles HERMES_HOME resolution, chains.json loading, and the Option A
workaround that writes virtual chain:<name> provider entries to profile
config.yamls so chains appear in the Hermes model picker.
"""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_VIRTUAL_MARKER = "provider-chains"


def base_hermes_home() -> Path:
    """Gateway-level HERMES_HOME, navigating up from per-profile worker paths."""
    home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
    if home.parent.name == "profiles":
        home = home.parent.parent
    return home


def load_chains() -> dict:
    f = base_hermes_home() / "chains.json"
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text()).get("chains", {})
    except Exception:
        return {}


def sync_virtual_providers() -> None:
    """Option A: write/remove chain:<name> virtual entries in all enabled
    profile config.yamls so chains appear in the Hermes model picker."""
    try:
        from ruamel.yaml import YAML
        from ruamel.yaml.comments import CommentedMap
    except ImportError:
        logger.warning("provider-chains: ruamel.yaml not available, skipping config sync")
        return

    hermes_home = base_hermes_home()
    profiles_dir = hermes_home / "profiles"
    if not profiles_dir.exists():
        return

    chain_names = list(load_chains().keys())
    yaml = YAML()
    yaml.preserve_quotes = True

    for profile_dir in sorted(profiles_dir.iterdir()):
        if not profile_dir.is_dir():
            continue
        config_path = profile_dir / "config.yaml"
        if not config_path.exists():
            continue

        try:
            with open(config_path) as fh:
                cfg = yaml.load(fh)
            if cfg is None:
                cfg = CommentedMap()

            plugins_cfg = cfg.get("plugins") or {}
            if "provider-chains" not in list(plugins_cfg.get("enabled") or []):
                continue

            providers = cfg.get("providers")
            if providers is None:
                providers = CommentedMap()
                cfg["providers"] = providers

            # Remove stale virtual entries
            stale = [
                k for k, v in list(providers.items())
                if str(k).startswith("chain:") and isinstance(v, dict)
                and v.get("_virtual") == _VIRTUAL_MARKER
            ]
            for k in stale:
                del providers[k]

            # Write current chains
            for name in chain_names:
                entry = CommentedMap()
                entry["base_url"] = "http://provider-chains-virtual/v1"
                entry["api_key"] = "provider-chains-virtual"
                entry["_virtual"] = _VIRTUAL_MARKER
                providers[f"chain:{name}"] = entry

            with open(config_path, "w") as fh:
                yaml.dump(cfg, fh)

        except Exception as exc:
            logger.warning("provider-chains: could not sync %s: %s", config_path, exc)
