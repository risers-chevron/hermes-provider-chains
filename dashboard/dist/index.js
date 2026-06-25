(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  const { React } = SDK;
  const h = React.createElement;
  const { useState, useEffect, useCallback } = SDK.hooks;

  const BASE = "/api/plugins/provider-chains";

  // ── Provider + model data from Hermes API ──────────────────────────────
  function useProviders() {
    const [providers, setProviders] = useState([]);
    useEffect(() => {
      SDK.fetchJSON("/api/model/options")
        .then((payload) => {
          setProviders(
            (payload.providers || []).map((p) => ({
              slug: p.slug,
              name: p.name || p.slug,
              models: Array.isArray(p.models) ? p.models : [],
            }))
          );
        })
        .catch(() => {
          setProviders([
            { slug: "lmstudio",   name: "LM Studio",  models: [] },
            { slug: "freellmapi", name: "FreeLLMAPI", models: [] },
            { slug: "openrouter", name: "OpenRouter", models: [] },
            { slug: "anthropic",  name: "Anthropic",  models: [] },
            { slug: "openai",     name: "OpenAI",     models: [] },
          ]);
        });
    }, []);
    return providers;
  }

  // ── ProviderSelect ─────────────────────────────────────────────────────
  function ProviderSelect({ value, onChange, providers }) {
    return h(
      "select",
      { className: "pc-select pc-select--provider", value: value || "", onChange: (e) => onChange(e.target.value) },
      h("option", { value: "", disabled: true }, "— provider —"),
      providers.map((p) => h("option", { key: p.slug, value: p.slug }, p.name || p.slug))
    );
  }

  // ── ModelField: select when models known, input otherwise ─────────────
  function ModelField({ providerSlug, value, onChange, providers }) {
    const provider = providers.find((p) => p.slug === providerSlug);
    const knownModels = provider ? provider.models : [];

    if (knownModels.length === 0) {
      return h("input", {
        className: "pc-input pc-input--model",
        placeholder: "model (optional)",
        value: value || "",
        onChange: (e) => onChange(e.target.value || null),
        onBlur: (e) => onChange(e.target.value.trim() || null),
      });
    }

    const currentVal = value || "";
    const isCustom = currentVal && !knownModels.includes(currentVal);
    return h(
      "select",
      {
        className: "pc-select pc-select--model",
        value: isCustom ? "__custom__" : currentVal,
        onChange: (e) => onChange(e.target.value === "" || e.target.value === "__custom__" ? null : e.target.value),
      },
      h("option", { value: "" }, "auto (default)"),
      knownModels.map((m) => h("option", { key: m, value: m }, m)),
      isCustom && h("option", { value: "__custom__", disabled: true }, currentVal)
    );
  }

  // ── OptField: label + hint + input ───────────────────────────────────
  function OptField({ label, hint, children }) {
    return h(
      "div", { className: "pc-opt-field" },
      h("label", { className: "pc-opt-label", title: hint }, label,
        hint && h("span", { className: "pc-opt-hint-icon", title: hint, "aria-label": hint }, " ⓘ")
      ),
      React.cloneElement(children, { title: hint }),
      hint && h("span", { className: "pc-opt-hint" }, hint)
    );
  }

  // ── EntryOpts: the expandable options panel ───────────────────────────
  function EntryOpts({ opts, onChange }) {
    function field(key) { return opts[key] != null ? String(opts[key]) : ""; }
    function numChange(key, val) {
      onChange({ ...opts, [key]: val === "" ? null : Number(val) });
    }
    function strChange(key, val) {
      onChange({ ...opts, [key]: val || null });
    }
    // thinking is tristate: null = inherit, true = on, false = off
    function thinkingVal() {
      if (opts.thinking === true)  return "on";
      if (opts.thinking === false) return "off";
      return "inherit";
    }
    function thinkingChange(val) {
      onChange({ ...opts, thinking: val === "on" ? true : val === "off" ? false : null });
    }

    return h(
      "div", { className: "pc-entry-opts" },
      h(OptField, {
        label: "Timeout (s)",
        hint: "Seconds to wait before this provider is considered failed and the next entry is tried. e.g. 30 for freellmapi, 1800 for lmstudio",
      },
        h("input", {
          className: "pc-input pc-input--small",
          type: "number", min: "1", placeholder: "profile default",
          value: field("timeout"),
          onChange: (e) => numChange("timeout", e.target.value),
        })
      ),
      h(OptField, {
        label: "Max tokens",
        hint: "Cap the number of output tokens this provider may generate. Useful to keep a fallback provider fast and cheap. e.g. 2048",
      },
        h("input", {
          className: "pc-input pc-input--small",
          type: "number", min: "1", placeholder: "provider default",
          value: field("max_tokens"),
          onChange: (e) => numChange("max_tokens", e.target.value),
        })
      ),
      h(OptField, {
        label: "Temperature",
        hint: "Sampling randomness. 0.0 = deterministic, 1.0 = balanced, 2.0 = very creative. Leave blank to use the model's default.",
      },
        h("input", {
          className: "pc-input pc-input--small",
          type: "number", min: "0", max: "2", step: "0.1", placeholder: "model default",
          value: field("temperature"),
          onChange: (e) => numChange("temperature", e.target.value),
        })
      ),
      h(OptField, {
        label: "Retry count",
        hint: "How many times to retry this provider on failure before moving to the next entry in the chain. e.g. 2 to retry rate-limited providers",
      },
        h("input", {
          className: "pc-input pc-input--small",
          type: "number", min: "0", max: "10", placeholder: "0 (no retry)",
          value: field("retry_count"),
          onChange: (e) => numChange("retry_count", e.target.value),
        })
      ),
      h(OptField, {
        label: "Thinking",
        hint: "Enable or disable extended thinking for Claude models. 'Inherit' uses the provider default. Only effective on models that support extended thinking.",
      },
        h("select", {
          className: "pc-select pc-input--small",
          value: thinkingVal(),
          onChange: (e) => thinkingChange(e.target.value),
        },
          h("option", { value: "inherit" }, "inherit (default)"),
          h("option", { value: "on" },      "enabled"),
          h("option", { value: "off" },     "disabled")
        )
      ),
      h(OptField, {
        label: "Thinking effort",
        hint: "Thinking budget when extended thinking is enabled. 'low' is fast and cheap, 'high' uses more tokens for harder problems. Only effective when thinking is enabled.",
      },
        h("select", {
          className: "pc-select pc-input--small",
          value: field("thinking_effort") || "inherit",
          onChange: (e) => strChange("thinking_effort", e.target.value === "inherit" ? "" : e.target.value),
        },
          h("option", { value: "inherit" }, "inherit (default)"),
          h("option", { value: "low" },     "low"),
          h("option", { value: "medium" },  "medium"),
          h("option", { value: "high" },    "high")
        )
      ),
      h(OptField, {
        label: "Base URL",
        hint: "Override the provider API endpoint for this entry only. e.g. http://local-model-proxy:8010/v1",
      },
        h("input", {
          className: "pc-input pc-input--url",
          type: "text", placeholder: "e.g. http://local-model-proxy:8010/v1",
          value: field("base_url"),
          onChange: (e) => strChange("base_url", e.target.value),
        })
      ),
      h(OptField, {
        label: "API key",
        hint: "Override the API key for this entry only. Useful for using a backup account on the same provider. Stored in chains.json — use Infisical for production secrets.",
      },
        h("input", {
          className: "pc-input pc-input--url",
          type: "password", placeholder: "override (optional)",
          value: field("api_key"),
          onChange: (e) => strChange("api_key", e.target.value),
          autoComplete: "off",
        })
      )
    );
  }

  // ── hasOpts: true if any non-default option is set ────────────────────
  function hasOpts(entry) {
    return !!(entry.timeout || entry.max_tokens || entry.temperature != null ||
              entry.retry_count || entry.base_url || entry.api_key ||
              entry.thinking != null || entry.thinking_effort);
  }

  // ── EntryRow ──────────────────────────────────────────────────────────
  function EntryRow({ entry, index, total, onMove, onRemove, onChange, providers }) {
    const [state, setState] = useState(entry);
    const [showOpts, setShowOpts] = useState(hasOpts(entry));

    useEffect(() => { setState(entry); }, [entry]);

    function handleProviderChange(slug) {
      const next = { ...state, provider: slug, model: null };
      setState(next);
      onChange(next);
    }

    function handleModelChange(model) {
      const next = { ...state, model };
      setState(next);
      onChange(next);
    }

    function handleOptsChange(updated) {
      const next = { ...state, ...updated };
      setState(next);
      onChange(next);
    }

    const hasActive = hasOpts(state);

    return h(
      "div", { className: "pc-entry-wrap" },
      h(
        "div", { className: "pc-entry-row" },
        h("div", { className: "pc-entry-order" },
          h("button", { className: "pc-btn-icon", onClick: () => onMove(index, -1), disabled: index === 0, title: "Move up" }, "↑"),
          h("span", { className: "pc-entry-num" }, index + 1),
          h("button", { className: "pc-btn-icon", onClick: () => onMove(index, 1), disabled: index === total - 1, title: "Move down" }, "↓")
        ),
        h("div", { className: "pc-entry-fields" },
          h(ProviderSelect, { value: state.provider, onChange: handleProviderChange, providers }),
          h(ModelField, { providerSlug: state.provider, value: state.model, onChange: handleModelChange, providers })
        ),
        h("div", { className: "pc-entry-actions" },
          h("button", {
            className: "pc-btn-icon pc-btn-icon--opts" + (showOpts ? " active" : "") + (hasActive ? " has-value" : ""),
            onClick: () => setShowOpts((v) => !v),
            title: showOpts ? "Hide options" : "Timeout, tokens, temperature…",
          }, "⚙"),
          h("button", { className: "pc-btn-icon pc-btn-icon--danger", onClick: () => onRemove(index), title: "Remove" }, "✕")
        )
      ),
      showOpts && h(EntryOpts, { opts: state, onChange: handleOptsChange })
    );
  }

  // ── AddEntryForm ───────────────────────────────────────────────────────
  function AddEntryForm({ onAdd, providers }) {
    const [provider, setProvider] = useState("");
    const [model, setModel] = useState(null);

    function handleSubmit(e) {
      e.preventDefault();
      if (!provider) return;
      onAdd({ provider, model, timeout: null, max_tokens: null, temperature: null, retry_count: null, base_url: null, api_key: null, thinking: null, thinking_effort: null });
      setProvider("");
      setModel(null);
    }

    return h(
      "form", { className: "pc-add-entry", onSubmit: handleSubmit },
      h(ProviderSelect, { value: provider, onChange: (s) => { setProvider(s); setModel(null); }, providers }),
      h(ModelField, { providerSlug: provider, value: model, onChange: setModel, providers }),
      h("button", { className: "pc-btn pc-btn--primary", type: "submit", disabled: !provider }, "+ Add")
    );
  }

  // ── CopyBadge ──────────────────────────────────────────────────────────
  function CopyBadge({ text }) {
    const [copied, setCopied] = useState(false);
    function handleCopy(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
    }
    return h("span", { onClick: handleCopy, title: copied ? "Copied!" : "Click to copy", className: "pc-copy-badge" + (copied ? " pc-copy-badge--copied" : "") },
      h("code", null, text),
      h("span", { className: "pc-copy-icon" }, copied ? "✓" : "⎘")
    );
  }

  // ── ChainCard ──────────────────────────────────────────────────────────
  function ChainCard({ name, chain, onSaved, onDeleted, providers }) {
    const [entries, setEntries] = useState(chain.entries || []);
    const [label, setLabel] = useState(chain.label || name);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => { setEntries(chain.entries || []); setLabel(chain.label || name); }, [chain]);

    async function save(updatedEntries, updatedLabel) {
      setSaving(true);
      setError(null);
      try {
        const result = await SDK.fetchJSON(`${BASE}/chains/${name}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: updatedLabel, entries: updatedEntries }),
        });
        onSaved(name, result.chain);
      } catch (e) {
        setError("Save failed: " + (e.message || String(e)));
      } finally {
        setSaving(false);
      }
    }

    function handleEntryChange(index, updated) {
      const next = entries.map((e, i) => (i === index ? updated : e));
      setEntries(next);
      save(next, label);
    }

    function handleMove(index, dir) {
      const next = [...entries];
      const swap = index + dir;
      if (swap < 0 || swap >= next.length) return;
      [next[index], next[swap]] = [next[swap], next[index]];
      setEntries(next);
      save(next, label);
    }

    function handleRemove(index) {
      const next = entries.filter((_, i) => i !== index);
      setEntries(next);
      save(next, label);
    }

    function handleAdd(entry) {
      const next = [...entries, entry];
      setEntries(next);
      save(next, label);
    }

    async function handleDelete() {
      setDeleting(true);
      try {
        await SDK.fetchJSON(`${BASE}/chains/${name}`, { method: "DELETE" });
        onDeleted(name);
      } catch (e) {
        setError("Delete failed: " + (e.message || String(e)));
        setDeleting(false);
        setConfirmDelete(false);
      }
    }

    return h(
      "div", { className: "pc-card" },
      h("div", { className: "pc-card-header" },
        h("div", { className: "pc-card-title-group" },
          h("h3", { className: "pc-chain-name" }, name),
          h("input", {
            className: "pc-input pc-input--label",
            value: label,
            onChange: (e) => setLabel(e.target.value),
            onBlur: () => save(entries, label),
            onKeyDown: (e) => e.key === "Enter" && save(entries, label),
            title: "Display label",
          })
        ),
        h("div", { className: "pc-card-actions" },
          h(CopyBadge, { text: `chain:${name}` }),
          saving && h("span", { className: "pc-saving" }, "saving…"),
          confirmDelete
            ? h("div", { className: "pc-confirm-delete" },
                h("span", null, "Delete?"),
                h("button", { className: "pc-btn pc-btn--danger", onClick: handleDelete, disabled: deleting }, deleting ? "…" : "Yes"),
                h("button", { className: "pc-btn", onClick: () => setConfirmDelete(false) }, "No")
              )
            : h("button", { className: "pc-btn-icon pc-btn-icon--danger", onClick: () => setConfirmDelete(true), title: "Delete chain" }, "🗑")
        )
      ),
      error && h("div", { className: "pc-error" }, error),
      h("div", { className: "pc-entry-list" },
        entries.length === 0
          ? h("p", { className: "pc-empty-entries" }, "No entries yet — add a provider below.")
          : entries.map((entry, i) =>
              h(EntryRow, { key: i, entry, index: i, total: entries.length, onMove: handleMove, onRemove: handleRemove, onChange: (u) => handleEntryChange(i, u), providers })
            )
      ),
      h(AddEntryForm, { onAdd: handleAdd, providers })
    );
  }

  // ── NewChainForm ───────────────────────────────────────────────────────
  function NewChainForm({ onCreated, onCancel }) {
    const [name, setName] = useState("");
    const [label, setLabel] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    async function handleSubmit(e) {
      e.preventDefault();
      const n = name.trim();
      if (!n) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await SDK.fetchJSON(`${BASE}/chains`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: n, label: label.trim() || n, entries: [] }),
        });
        onCreated(result.name, result.chain);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setSubmitting(false);
      }
    }

    return h(
      "form", { className: "pc-new-chain-form", onSubmit: handleSubmit },
      h("h3", { className: "pc-new-chain-title" }, "New chain"),
      h("input", { className: "pc-input", placeholder: "chain-name (e.g. local-first)", value: name, onChange: (e) => setName(e.target.value), autoFocus: true }),
      h("input", { className: "pc-input", placeholder: "display label (optional)", value: label, onChange: (e) => setLabel(e.target.value) }),
      error && h("div", { className: "pc-error" }, error),
      h("div", { className: "pc-form-actions" },
        h("button", { className: "pc-btn pc-btn--primary", type: "submit", disabled: !name.trim() || submitting }, submitting ? "Creating…" : "Create chain"),
        h("button", { className: "pc-btn", type: "button", onClick: onCancel }, "Cancel")
      )
    );
  }

  // ── App ────────────────────────────────────────────────────────────────
  function App() {
    const [chains, setChains] = useState(null);
    const [showNewForm, setShowNewForm] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const providers = useProviders();

    const load = useCallback(async () => {
      try {
        const result = await SDK.fetchJSON(`${BASE}/chains`);
        setChains(result.chains || {});
      } catch (e) {
        setLoadError("Failed to load chains: " + (e.message || String(e)));
      }
    }, []);

    useEffect(() => { load(); }, [load]);

    if (loadError) return h("div", { className: "pc-page" }, h("div", { className: "pc-error pc-error--page" }, loadError));
    if (chains === null) return h("div", { className: "pc-page" }, h("div", { className: "pc-spinner" }, "Loading…"));

    const chainNames = Object.keys(chains);

    return h(
      "div", { className: "pc-page" },
      h("div", { className: "pc-header" },
        h("div", null,
          h("h1", { className: "pc-title" }, "Provider Chains"),
          h("p", { className: "pc-subtitle" },
            "Named fallback chains. Assign with ",
            h("code", null, "provider: chain:<name>"),
            " in any cron job, blueprint, or profile."
          )
        ),
        h("button", { className: "pc-btn pc-btn--primary", onClick: () => setShowNewForm(true), disabled: showNewForm }, "+ New chain")
      ),
      showNewForm && h(NewChainForm, {
        onCreated: (name, chain) => { setChains((p) => ({ ...p, [name]: chain })); setShowNewForm(false); },
        onCancel: () => setShowNewForm(false),
      }),
      chainNames.length === 0 && !showNewForm
        ? h("div", { className: "pc-empty-state" },
            h("div", { className: "pc-empty-icon" }, "⛓"),
            h("h2", null, "No chains yet"),
            h("p", null, "Create a chain to define an ordered list of providers. When one fails, Hermes tries the next."),
            h("button", { className: "pc-btn pc-btn--primary", onClick: () => setShowNewForm(true) }, "Create your first chain")
          )
        : chainNames.map((name) =>
            h(ChainCard, {
              key: name, name, chain: chains[name], providers,
              onSaved: (n, updated) => setChains((p) => ({ ...p, [n]: updated })),
              onDeleted: (n) => setChains((p) => { const next = { ...p }; delete next[n]; return next; }),
            })
          )
    );
  }

  window.__HERMES_PLUGINS__.register("provider-chains", App);
})();
