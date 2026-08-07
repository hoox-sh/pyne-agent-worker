// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AXIS dynamic plugin — Pine Script™ natural-language agent (Cloudflare® Worker).
//
// Install in AXIS → Manager → Plugins → Install from URL:
//   https://<your-worker>/plugin/axis-pine-agent.js
//
// Contract namespace: pynescript.axis.plugins.v1
// Kind: component (manager-tab + topbar-action). AXIS may still be phase-2
// for component mounting; this module also attaches a floating chat when the
// host does not call mount() (best-effort global bootstrap).
//
// Pine Script™ and TradingView® are trademarks of TradingView, Inc.
// Cloudflare® is a registered trademark of Cloudflare, Inc.
// Not affiliated with or endorsed by TradingView, Inc. or Cloudflare, Inc.

/**
 * @typedef {object} PluginContext
 * @property {() => Record<string, unknown>} getConfig
 * @property {(msg: string, level?: string) => void} [setStatus]
 * @property {{ fetch?: typeof fetch }} [host]
 */

const DEFAULT_ENDPOINT = "";

function cfg(config) {
  const c = config || {};
  return {
    endpoint: String(c.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, ""),
    apiKey: String(c.apiKey || c.api_key || ""),
    pineVersion: String(c.pineVersion || c.pine_version || "auto"),
    style: String(c.style || "auto"),
  };
}

async function agentFetch(endpoint, apiKey, path, init = {}, hostFetch) {
  const f = hostFetch || fetch;
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  if (apiKey) {
    headers.set("X-API-Key", apiKey);
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  const res = await f(`${endpoint}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function injectStyles() {
  const id = "pyne-agent-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .pyne-agent-root {
      display: flex; flex-direction: column; height: 100%; min-height: 320px;
      font-family: ui-sans-serif, system-ui, sans-serif; color: #e8eaed;
      background: #0f1419; border: 1px solid #2a3441; border-radius: 8px;
      overflow: hidden;
    }
    .pyne-agent-header {
      padding: 10px 12px; border-bottom: 1px solid #2a3441;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      background: #151b23;
    }
    .pyne-agent-header h3 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
    .pyne-agent-header small { color: #8b98a5; font-size: 11px; }
    .pyne-agent-msgs {
      flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px;
    }
    .pyne-agent-msg {
      max-width: 92%; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.45;
      white-space: pre-wrap; word-break: break-word;
    }
    .pyne-agent-msg.user { align-self: flex-end; background: #1d4f7c; }
    .pyne-agent-msg.assistant { align-self: flex-start; background: #1a222c; border: 1px solid #2a3441; }
    .pyne-agent-msg.error { align-self: stretch; background: #3a1515; border: 1px solid #7f1d1d; color: #fecaca; }
    .pyne-agent-form {
      display: flex; gap: 8px; padding: 10px; border-top: 1px solid #2a3441; background: #151b23;
    }
    .pyne-agent-form textarea {
      flex: 1; resize: none; min-height: 56px; max-height: 140px;
      background: #0b0f14; color: #e8eaed; border: 1px solid #2a3441; border-radius: 6px;
      padding: 8px; font: inherit; font-size: 12.5px;
    }
    .pyne-agent-form button {
      align-self: flex-end; background: #2563eb; color: white; border: 0; border-radius: 6px;
      padding: 8px 12px; font-weight: 600; font-size: 12px; cursor: pointer;
    }
    .pyne-agent-form button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pyne-agent-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .pyne-agent-actions button {
      background: #243041; color: #e8eaed; border: 1px solid #3a4a5c; border-radius: 4px;
      padding: 4px 8px; font-size: 11px; cursor: pointer;
    }
    .pyne-agent-float {
      position: fixed; right: 16px; bottom: 16px; z-index: 99999;
      width: min(420px, calc(100vw - 24px)); height: min(560px, calc(100vh - 48px));
      box-shadow: 0 12px 40px rgba(0,0,0,0.45);
    }
    .pyne-agent-fab {
      position: fixed; right: 16px; bottom: 16px; z-index: 99998;
      background: #2563eb; color: #fff; border: 0; border-radius: 999px;
      padding: 12px 16px; font-weight: 700; font-size: 12px; cursor: pointer;
      box-shadow: 0 8px 24px rgba(37,99,235,0.4);
    }
    .pyne-agent-legal { font-size: 10px; color: #6b7785; padding: 0 12px 8px; }
  `;
  document.head.appendChild(style);
}

/**
 * Mount chat UI into a host element.
 * @param {HTMLElement} el
 * @param {Record<string, unknown>} api host API (optional insertScript, getConfig)
 * @param {Record<string, unknown>} [config]
 */
function mountChat(el, api, config) {
  injectStyles();
  const conf = cfg({ ...cfg(api?.getConfig?.() || {}), ...(config || {}) });
  el.innerHTML = "";
  el.classList.add("pyne-agent-host");

  const root = document.createElement("div");
  root.className = "pyne-agent-root";
  root.innerHTML = `
    <div class="pyne-agent-header">
      <div>
        <h3>Pine Script™ Agent</h3>
        <small>Cloudflare® Workers AI™ · AXIS plugin</small>
      </div>
      <small class="pyne-agent-status">ready</small>
    </div>
    <div class="pyne-agent-msgs" data-msgs></div>
    <form class="pyne-agent-form" data-form>
      <textarea data-input placeholder="Ask in natural language… e.g. RSI divergence strategy with ATR stops (Pine Script™ v6)"></textarea>
      <button type="submit" data-send>Send</button>
    </form>
    <div class="pyne-agent-legal">
      Pine Script™ and TradingView® are trademarks of TradingView, Inc.
      Cloudflare® is a registered trademark of Cloudflare, Inc.
      Independent project — not affiliated with TradingView® or Cloudflare®.
    </div>
  `;
  el.appendChild(root);

  const msgs = root.querySelector("[data-msgs]");
  const form = root.querySelector("[data-form]");
  const input = root.querySelector("[data-input]");
  const sendBtn = root.querySelector("[data-send]");
  const status = root.querySelector(".pyne-agent-status");

  let sessionId = null;
  let busy = false;

  function setStatus(t) {
    if (status) status.textContent = t;
  }

  function addMsg(role, text, opts = {}) {
    const div = document.createElement("div");
    div.className = `pyne-agent-msg ${opts.error ? "error" : role}`;
    div.textContent = text;
    if (opts.pine && typeof api?.insertScript === "function") {
      const actions = document.createElement("div");
      actions.className = "pyne-agent-actions";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Insert into editor";
      btn.addEventListener("click", () => {
        try {
          api.insertScript(opts.pine);
          setStatus("inserted");
        } catch (e) {
          setStatus("insert failed");
        }
      });
      actions.appendChild(btn);
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy Pine";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(opts.pine);
          setStatus("copied");
        } catch {
          setStatus("copy failed");
        }
      });
      actions.appendChild(copy);
      div.appendChild(actions);
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  addMsg(
    "assistant",
    "Hi — describe the indicator or strategy you want in plain language. I use a private Pine Script™ knowledge base (v5/v6 docs + open corpus) on Cloudflare®. I do not ship TradingView® built-in sources."
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const text = String(input.value || "").trim();
    if (!text) return;

    const live = cfg({ ...cfg(api?.getConfig?.() || {}), ...(config || {}) });
    if (!live.endpoint) {
      addMsg("assistant", "Set plugin config: endpoint = your pyne-agent-worker HTTPS URL.", {
        error: true,
      });
      return;
    }

    busy = true;
    sendBtn.disabled = true;
    setStatus("thinking…");
    addMsg("user", text);
    input.value = "";

    try {
      const data = await agentFetch(
        live.endpoint,
        live.apiKey,
        "/v1/chat",
        {
          method: "POST",
          body: JSON.stringify({
            message: text,
            session_id: sessionId || undefined,
            pine_version: live.pineVersion,
            style: live.style,
          }),
        },
        api?.host?.fetch
      );
      sessionId = data.session_id || sessionId;
      addMsg("assistant", data.reply || "(empty)", { pine: data.pine || null });
      setStatus(data.model ? `ok · ${data.model}` : "ok");
    } catch (e) {
      addMsg("assistant", e instanceof Error ? e.message : String(e), { error: true });
      setStatus("error");
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  });

  return () => {
    el.innerHTML = "";
  };
}

/** Best-effort floating UI when AXIS does not mount component slots yet. */
function bootstrapFloating(config) {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById("pyne-agent-float-root")) return () => {};

  injectStyles();
  const fab = document.createElement("button");
  fab.className = "pyne-agent-fab";
  fab.type = "button";
  fab.id = "pyne-agent-fab";
  fab.textContent = "Pine™ Agent";
  document.body.appendChild(fab);

  let panel = null;
  let unmount = null;

  fab.addEventListener("click", () => {
    if (panel) {
      unmount?.();
      panel.remove();
      panel = null;
      unmount = null;
      return;
    }
    panel = document.createElement("div");
    panel.className = "pyne-agent-float";
    panel.id = "pyne-agent-float-root";
    document.body.appendChild(panel);
    unmount = mountChat(panel, { getConfig: () => config || {} }, config);
  });

  return () => {
    unmount?.();
    panel?.remove();
    fab.remove();
  };
}

const plugin = {
  id: "pine-agent",
  name: "Pine Script™ Agent",
  kind: "component",
  version: "0.1.0",
  description:
    "Natural-language Pine Script™ coding via Cloudflare® Workers AI™ and a private Vectorize™ knowledge base (v5/v6 docs + open corpus). AXIS sister plugin for HOOX / PYNE.",
  builtIn: false,
  capabilities: {
    needsNetwork: true,
    needsAuth: true,
  },
  configSchema: {
    endpoint: {
      type: "string",
      default: "",
      label: "Agent worker URL",
      description: "HTTPS origin of pyne-agent-worker (no trailing slash)",
      placeholder: "https://pyne-agent-worker.example.workers.dev",
    },
    apiKey: {
      type: "string",
      default: "",
      label: "API key",
      description: "X-API-Key / Bearer token for the worker",
      placeholder: "optional in local open mode",
    },
    pineVersion: {
      type: "select",
      default: "auto",
      label: "Pine version preference",
      options: ["auto", "v5", "v6"],
    },
    style: {
      type: "select",
      default: "auto",
      label: "Script kind preference",
      options: ["auto", "indicator", "strategy", "library"],
    },
  },
  slots: ["manager-tab", "topbar-action", "settings-section"],

  /**
   * @param {string} slot
   * @param {HTMLElement} el
   * @param {Record<string, unknown>} api
   */
  mount(slot, el, api) {
    const config = {
      ...(api?.getConfig?.() || {}),
    };
    if (slot === "topbar-action") {
      el.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Pine™ Agent";
      btn.title = "Open Pine Script™ Agent chat";
      let open = null;
      btn.addEventListener("click", () => {
        if (open) {
          open();
          open = null;
          return;
        }
        const host = document.createElement("div");
        host.style.cssText =
          "position:fixed;right:16px;bottom:56px;z-index:99999;width:min(420px,calc(100vw - 24px));height:min(560px,calc(100vh - 80px));";
        document.body.appendChild(host);
        const stop = mountChat(host, api, config);
        open = () => {
          stop();
          host.remove();
        };
      });
      el.appendChild(btn);
      return () => {
        el.innerHTML = "";
      };
    }
    // manager-tab / settings-section → full chat panel
    return mountChat(el, api, config);
  },

  async init(ctx) {
    const config = ctx?.getConfig?.() || {};
    // If AXIS never calls mount (component phase 2), still offer a FAB.
    if (typeof document !== "undefined" && !config.disableFloating) {
      this._floatDispose = bootstrapFloating(config);
    }
    ctx?.setStatus?.("Pine Script™ Agent ready", "info");
  },

  async dispose() {
    try {
      this._floatDispose?.();
    } catch {
      /* ignore */
    }
  },
};

export default plugin;
export { plugin, mountChat };
