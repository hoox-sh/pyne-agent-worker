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
| AXIS | [Plugins — PYNE Agent](https://hoox.sh/axis/docs/plugins/pine-agent) |
| AXIS | [End-user guide](https://hoox.sh/axis/docs/enduser/guides/pine-agent) |
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
