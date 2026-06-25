"""
provider-chains: Hermes plugin for named provider fallback chains.

Intercepts resolve_runtime_provider for requests starting with "chain:<name>"
and walks the named chain until one provider resolves successfully.

Per-entry options: timeout, max_tokens, temperature, retry_count, base_url,
api_key, thinking, thinking_effort.

Chain definitions live in $HERMES_HOME/chains.json (gateway-level, shared
across all profiles) and are re-read on every call so dashboard edits take
effect without a restart.

Model picker integration:
  Option B (preferred): Hermes calls build_models_payload() on this module
    if it supports the plugin models hook — no config.yaml changes needed.
  Option A (fallback): if Hermes doesn't support the hook, virtual provider
    entries (chain:<name>) are written to each profile's config.yaml at
    startup and whenever chains are created/deleted via the dashboard API.
"""

import importlib.util as _ilu
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Import shared sync helpers ──────────────────────────────────────────────
# Use importlib so this works regardless of sys.path (e.g. coder profile).
_spec = _ilu.spec_from_file_location("_pc_sync", Path(__file__).parent / "_sync.py")
_pc_sync = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_pc_sync)  # type: ignore[union-attr]
base_hermes_home = _pc_sync.base_hermes_home
load_chains = _pc_sync.load_chains
sync_virtual_providers = _pc_sync.sync_virtual_providers


# ── Option B hook ───────────────────────────────────────────────────────────
def build_models_payload(profile: str | None = None) -> list:
    """Called by Hermes (Option B) to inject chain entries into the model picker.

    Returns a list of provider dicts in the format expected by build_models_payload
    in hermes_cli/inventory.py.  Hermes must support the plugin models hook for
    this to be invoked — see README for details.
    """
    chains = load_chains()
    if not chains:
        return []

    # Return chains as a single grouped provider entry so they appear under
    # one "Provider Chains" heading in the picker.
    return [
        {
            "slug": "chain",
            "name": "Provider Chains",
            "models": list(chains.keys()),
            "source": "plugin:provider-chains",
        }
    ]


# ── Startup: register Option B or fall back to Option A ────────────────────
def _try_register_option_b(ctx) -> bool:
    """Attempt to register build_models_payload with the Hermes models hook.
    Returns True if successful (Option B active), False if not supported."""
    for attr in ("register_models_provider", "register_models_hook", "add_models_provider"):
        if hasattr(ctx, attr):
            try:
                getattr(ctx, attr)(build_models_payload)
                logger.info("provider-chains: Option B active (models hook: ctx.%s)", attr)
                return True
            except Exception as exc:
                logger.debug("provider-chains: Option B hook %s failed: %s", attr, exc)
    return False


def register(ctx) -> None:
    # ── Wrap the runtime resolver ───────────────────────────────────────────
    try:
        import hermes_cli.runtime_provider as _rp
    except ImportError:
        logger.warning("provider-chains: hermes_cli not available, resolver wrap skipped")
        return

    _original = _rp.resolve_runtime_provider

    def _wrapped(requested=None, **kwargs):
        if not (requested and isinstance(requested, str)):
            return _original(requested=requested, **kwargs)

        # "chain:name" comes from config.yaml provider slugs (Option A).
        # "chain" + target_model="name" comes from the model picker (Option B).
        if requested.startswith("chain:"):
            chain_name = requested[len("chain:"):]
        elif requested == "chain":
            chain_name = kwargs.get("target_model") or ""
        else:
            return _original(requested=requested, **kwargs)

        if not chain_name:
            return _original(requested=requested, **kwargs)

        chains = load_chains()
        chain = chains.get(chain_name)
        if not chain:
            available = ", ".join(chains.keys()) or "(none defined)"
            raise ValueError(
                f"Provider chain '{chain_name}' not found. "
                f"Available chains: {available}"
            )

        entries = chain.get("entries", [])
        if not entries:
            raise ValueError(f"Provider chain '{chain_name}' has no entries configured")

        last_exc = None
        for entry in entries:
            provider = entry.get("provider")
            if not provider:
                continue

            retries = max(0, int(entry.get("retry_count") or 0))
            attempt = 0
            while attempt <= retries:
                try:
                    entry_kwargs = dict(kwargs)
                    if entry.get("model") and "target_model" not in entry_kwargs:
                        entry_kwargs["target_model"] = entry["model"]
                    if entry.get("base_url"):
                        entry_kwargs["explicit_base_url"] = entry["base_url"]
                    if entry.get("api_key"):
                        entry_kwargs["explicit_api_key"] = entry["api_key"]

                    result = _original(requested=provider, **entry_kwargs)

                    if isinstance(result, dict):
                        result = dict(result)
                        for opt_key in ("timeout", "max_tokens", "temperature",
                                        "thinking", "thinking_effort"):
                            if entry.get(opt_key) is not None:
                                result[opt_key] = entry[opt_key]

                    logger.info(
                        "chain:%s resolved via %s (model=%s, attempt=%d)",
                        chain_name, provider, entry.get("model") or "default", attempt,
                    )
                    return result

                except Exception as exc:
                    last_exc = exc
                    attempt += 1
                    if attempt <= retries:
                        logger.debug(
                            "chain:%s — %s attempt %d failed, retrying: %s",
                            chain_name, provider, attempt, exc,
                        )
                    else:
                        logger.debug(
                            "chain:%s — %s failed after %d attempt(s): %s",
                            chain_name, provider, attempt, exc,
                        )

        if last_exc:
            raise last_exc
        raise RuntimeError(f"All entries in chain '{chain_name}' failed to resolve")

    _rp.resolve_runtime_provider = _wrapped

    # ── Model picker integration ────────────────────────────────────────────
    if not _try_register_option_b(ctx):
        # Hermes doesn't support the models hook yet — use Option A:
        # ensure virtual provider entries are written to all profile configs.
        try:
            sync_virtual_providers()
        except Exception as exc:
            logger.warning("provider-chains: Option A startup sync failed: %s", exc)

    logger.info(
        "provider-chains: resolver installed (chains.json: %s)",
        base_hermes_home() / "chains.json",
    )
