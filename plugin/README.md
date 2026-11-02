# AXIS plugin — PYNE Agent

ES module for the AXIS charting PWA (`pynescript.axis.plugins.v1`).

## Install

1. Deploy **pyne-agent-worker** and note its HTTPS origin.
2. In AXIS → Manager → Plugins → Install from URL:

```text
https://<your-worker>.workers.dev/plugin/axis-pine-agent.js
```

3. Configure:

| Field | Meaning |
|-------|---------|
| `endpoint` | Worker origin (no trailing slash) |
| `apiKey` | Worker `API_KEY` secret |
| `pineVersion` | `auto` \| `v5` \| `v6` |
| `style` | `auto` \| `indicator` \| `strategy` \| `library` |
| `persona` | `auto` \| `pine` \| `axis` \| `trader` |
| `pyneBackend` | `auto` \| `pro` \| `local` \| `worker` \| `container` \| `none` — parse/lint/eval host (kind, not a URL) |

Chat always sends `orchestrate: true` (plugin 0.1.8). Curl / plugin 0.1.7 omit the field and stay on cheap REST.

## Contract

- **kind:** `component`
- **slots:** `manager-tab`, `topbar-action`, `settings-section`
- **Fallback:** compact accent **Agent** launcher (bottom-right above editor bottom bars) if AXIS has not mounted component slots yet; free-floating chat modal with close + resize (not a dock panel)
- **Preview:** open `/plugin-preview.html` on the worker (AXIS void tokens, mock chat) to inspect 0.1.8 chrome without a live PWA tab

If your AXIS build’s dynamic loader still rejects `kind: 'component'`, use the
Worker’s built-in chat UI (`https://<worker>/`) or register the module from a
local fork that allows component plugins.

## Legal

Pine Script™ and TradingView® are trademarks of TradingView, Inc.
Cloudflare® is a registered trademark of Cloudflare, Inc.
Not affiliated with TradingView, Inc. or Cloudflare, Inc.
