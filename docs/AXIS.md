# AXIS integration

_Pine Script™ and TradingView® are trademarks of TradingView, Inc.  
Cloudflare® is a registered trademark of Cloudflare, Inc._

## Plugin URL

```text
https://<your-deploy>/plugin/axis-pine-agent.js
```

Module path in this repo: `plugin/axis-pine-agent.js` (also served from `public/plugin/`).

## Docs (synced)

| Site | Page |
|------|------|
| AXIS | [Plugins — PYNE Agent](https://hoox.sh/axis/docs/plugins/pyne-agent) |
| AXIS | [End-user guide](https://hoox.sh/axis/docs/enduser/guides/pyne-agent) |
| PYNE | [Agent overview](https://hoox.sh/pyne/docs/agent) |

## Config

| Field | Required | Notes |
|-------|----------|--------|
| `endpoint` | yes | Worker origin |
| `apiKey` | if worker has `API_KEY` | |
| `pineVersion` | no | `auto` / `v5` / `v6` |
| `style` | no | indicator / strategy / library |

## Standalone

AXIS + this worker alone is enough. pyne-worker is optional (validate loop only).

## Deep control (agent → AXIS MCP)

Set `AXIS_MCP_URL` (+ `AXIS_MCP_KEY` secret) and the agent drives AXIS:

| Layer | Tools | Needs |
|-------|-------|-------|
| Validate | `axis_run` via `axis_run_pine` / validate loop | MCP configured |
| Worker plane | `axis_control` → scripts, market, on-chain, health, usage | MCP configured |
| App plane | `axis_app` → editor, chart, indicators, alerts, results, workspace, … | Bridged PWA tab (`bridge_connected > 0`) |

`axis_mcp_status` reports all three layers. The same surface is exposed on
`/mcp` (`axis_mcp_*`, `axis_run_pine`, `axis_app_invoke`) for external IDEs.
