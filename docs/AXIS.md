# AXIS integration

_Pine Script™ and TradingView® are trademarks of TradingView, Inc.  
Cloudflare® is a registered trademark of Cloudflare, Inc._

## Plugin URL

```text
https://<your-deploy>/plugin/axis-pine-agent.js
```

Module path in this repo: `plugin/axis-pine-agent.js` (also served from `public/plugin/`). Preview: `/plugin-preview.html`.

## Docs (synced)

| Site | Page |
|------|------|
| AXIS | [Plugins — PYNE Agent](https://hoox.sh/axis/docs/plugins/pyne-agent) |
| AXIS | [End-user guide](https://hoox.sh/axis/docs/enduser/guides/pyne-agent) |
| PYNE | [Agent overview](https://hoox.sh/pyne/docs/agent) |

## Config

| Field | Required | Notes |
|-------|----------|--------|
| `endpoint` | yes | Worker origin (`http` or `https`) |
| `apiKey` | if worker has `API_KEY` | |
| `pineVersion` | no | `auto` / `v5` / `v6` |
| `style` | no | indicator / strategy / library |
| `persona` | no | `auto` / `pine` / `axis` / `trader` |
| `pyneBackend` | no | `auto` / `pro` / `local` / `worker` / `container` / `none` |

Plugin **0.1.8** always sends `orchestrate: true` on `POST /v1/chat`. A missing field (curl, 0.1.7) stays cheap REST. `pyne_backend` is a named kind; the worker maps it to Pro (`pynescript.online`), local Flask, edge pyne-worker, or `pyne-api-container`.

## Standalone

AXIS + this worker alone is enough. pyne-worker is optional (validate loop only).

## Deep control (agent → AXIS MCP)

Set `AXIS_MCP_URL` (+ `AXIS_MCP_KEY` secret) and the agent drives AXIS:

| Layer | Tools | Needs |
|-------|-------|--------|
| Validate | `axis_run` via `axis_run_pine` / staged validate | MCP configured |
| Worker plane | `axis_control` → scripts, market, on-chain, health, usage | MCP configured |
| App plane | First-class wrappers + `axis_app` | Bridged PWA tab (`bridge_connected > 0`) |

### First-class wrappers

| Tool | Capability |
|------|------------|
| `axis_chart_load` | `chart.load` |
| `axis_editor_set` | `editor.set` (`doc`) |
| `axis_editor_run` | `editor.run` |
| `axis_alerts_create` | `alerts.create` (AXIS dispatch fields only) |
| `axis_results_get` | `results.get` (snapshot includes strategy stats) |
| `axis_engine_tick` | `engine.tick` |

`axis_run_pine` takes **only** Pine source (worker supplies synthetic bars). Do not pass ticker or timeframe. Escape hatches: `axis_control`, `axis_app`.

`axis_mcp_status` reports wiring + `bridge_connected`. The same surface is on `/mcp` (additive wrappers; `rag_search` aliases knowledge search; **no** `subagent_spawn` on MCP).
