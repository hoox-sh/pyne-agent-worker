# pyne-agent-worker

> **Cloudflare® Workers AI™** **PYNE Agent** — natural-language script authoring for the HOOX / PYNE stack,
> backed by an optional private **Vectorize™** knowledge base. **AXIS** sister plugin.
> (Targets the Pine Script™ language; not a TradingView® product.)

**Version:** 0.2.0 · **Runtime:** Cloudflare Workers (TypeScript) · **License:** AGPL-3.0-or-later

_Pine Script™ and TradingView® are trademarks of TradingView, Inc.  
Cloudflare® is a registered trademark of Cloudflare, Inc.  
This project is independent and is **not** affiliated with, endorsed by, or sponsored by TradingView, Inc. or Cloudflare, Inc._

---

## Standalone by default (no HOOX / pyne-worker required)

You can deploy and use this agent with **only Cloudflare® Workers AI™** (plus optional Vectorize/R2 for RAG).  
**pyne-worker, trade-worker, and the rest of the HOOX mesh are optional.**

| Mode | What you need | Behavior |
|------|----------------|----------|
| **Standalone** | Worker + AI binding (+ optional KB) | NL → PYNE script chat; validation skipped |
| **HOOX-enhanced** | + pyne-worker service binding or `PYNE_WORKER_URL` | Same chat + generate→validate→retry on `/run` |

`GET /health` reports `"mode": "standalone" | "hoox"`. Chat always works in standalone.

## Why this repo exists

| Sibling | Role | Required? |
|---------|------|-----------|
| **pyne-agent-worker** (this) | Edge **write** scripts via chat + RAG (PYNE Agent) | — |
| [hoox-sh/pyne](https://github.com/hoox-sh/pyne) | Pine toolchain + Pro API | Optional |
| [hoox-sh/pynets](https://github.com/hoox-sh/pynets) | TypeScript library (`@hoox-sh/pynets`) — in-process evaluate | Optional |
| [hoox-sh/pyne-worker](https://github.com/hoox-sh/pyne-worker) | Edge **evaluate** host | Optional (validate loop only) |
| [hoox-sh/axis](https://github.com/hoox-sh/axis) | Charting PWA (plugins) | Optional UI |

```text
User (AXIS plugin / browser / HTTP)
        │  natural language
        ▼
┌─────────────────────────┐
│  pyne-agent-worker      │  Workers AI™ (coder model)
│  POST /v1/chat          │  ← works standalone
└───────────┬─────────────┘
            │ optional RAG
            ▼
   Vectorize™ + R2 knowledge (optional)
            │
            ├──► script source in reply (always)
            │
            └──► optional: pyne-worker /run validate→retry
                 (only if you run HOOX / set PYNE_WORKER_URL)
```

## Hard legal rule

**This git repository never contains TradingView® built-in Pine sources.**

Knowledge is **operator-ingested** into private R2 + Vectorize only:

| Content | Ingest | In git? |
|---------|--------|---------|
| Pine Script™ v5/v6 documentation | `ingest:docs` | No (exports stay local / R2) |
| Open corpus (≤ 1000 scripts) | `ingest:corpus` | No |
| Built-in references | `ingest:builtins` | No |
| HOOX `.pine.example` templates | `knowledge/templates/` | Yes (examples only) |

`scripts/legal-check.sh` runs on `predeploy` and refuses tracked `*.pine` files.

## Features

- **POST `/v1/chat`** — NL → PYNE scripts with RAG context (**standalone OK**)
- **Optional generate → validate → retry** — only when **pyne-worker** is configured (`POST /run` with synthetic bars); otherwise skipped automatically
- **GET/POST `/v1/search`** — Vectorize search (no-op empty if KB not set up)
- **Sessions** — optional D1 history (`/v1/sessions`)
- **AXIS plugin** — `GET /plugin/axis-pine-agent.js` (`kind: component` + floating UI fallback)
- **Static chat shell** — `GET /` for demos / iframe
- **Admin index** — `POST /v1/admin/embed` + `/v1/admin/index` (requires `API_KEY`)
- **Product name:** **PYNE Agent** (not “Pine Script Agent”); legal marks appear only in disclaimers

## Quick start (standalone)

```bash
cd ~/Git/pyne-agent-worker
bun install

# Minimum: Workers AI is enough for chat.
# Optional RAG / sessions (recommended for quality, not required to run):
npx wrangler vectorize create pyne-agent-kb --dimensions=768 --metric=cosine
npx wrangler r2 bucket create pyne-agent-kb
npx wrangler d1 create pyne-agent-sessions
# paste database_id into wrangler.jsonc
npx wrangler d1 execute pyne-agent-sessions --remote --file=schemas/sessions.sql

# Local — do NOT need pyne-worker running
cp .env.example .dev.vars   # optional API_KEY=
bun run dev

# Deploy (no HOOX mesh, no pyne-worker service binding)
echo "your-secret" | npx wrangler secret put API_KEY
bun run deploy
```

### Optional: enable validate loop (HOOX / pyne-worker)

Only if you already run [pyne-worker](https://github.com/hoox-sh/pyne-worker):

```jsonc
// wrangler.jsonc — uncomment services block, OR set:
// "vars": { "PYNE_WORKER_URL": "https://pyne-worker.<you>.workers.dev" }
```

```bash
# if using HTTP instead of service binding
echo "pyne-api-key" | npx wrangler secret put PYNE_WORKER_API_KEY
```

Without either binding, responses include `validation.available: false` and a single generate pass.

### Build the knowledge base (private)

```bash
# 0) One-shot: pineDocs.json + AXIS PWA + PYNE packs / sister repos
#    Drop knowledge/pineDocs.json, knowledge/axis-llm.txt, knowledge/pyne-llm.txt
#    (all gitignored) or keep ../axis and ../pynescript checked out beside this repo.
bun run ingest:kb

# Or stepwise:
bun run ingest:pinedocs                         # knowledge/pineDocs.json → v6 language ref
bun run ingest:axis                             # build knowledge/axisDocs.json from ../axis/docs
bun run ingest:docs -- --pyne-docs ../pynescript/docs/pyne
bun run ingest:llm                              # fallback: knowledge/axis-llm.txt + pyne-llm.txt

# Open corpus (max 1000) — not TV built-ins
bun run ingest:corpus -- --dir /secure/open-pine-corpus --max 1000

# Built-in *metadata* / private refs (never commit the inputs)
bun run ingest:builtins -- --metadata ../pynescript/src/pynescript/langserver/providers/builtin_metadata.json

# Embed + upsert (worker must be deployed with API_KEY)
bun run scripts/build-index.ts \
  --embed-endpoint https://pyne-agent-worker.<you>.workers.dev/v1/admin/embed
```

Alternatively, point **Cloudflare® AI Search™** (formerly AutoRAG) at the R2 bucket
`pyne-agent-kb` for managed chunking/indexing, and keep this Worker as the chat shell.

## AXIS install

1. Deploy this worker.
2. AXIS → Plugins → Install from URL:

```text
https://pyne-agent-worker.<you>.workers.dev/plugin/axis-pine-agent.js
```

3. Set **endpoint** + **API key** in plugin config.

See [`plugin/README.md`](./plugin/README.md) · [`docs/AXIS.md`](./docs/AXIS.md).

Published AXIS docs (after site sync):

- [PYNE Agent plugin](https://hoox.sh/axis/docs/plugins/pyne-agent)
- [End-user guide](https://hoox.sh/axis/docs/enduser/guides/pyne-agent)
- [PYNE agent overview](https://hoox.sh/pyne/docs/agent)

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness + binding checks |
| GET | `/` | No | Chat UI + service meta |
| POST | `/v1/chat` | Yes* | NL chat → Pine |
| GET/POST | `/v1/search` | Yes* | KB semantic search |
| POST | `/v1/sessions` | Yes* | Create session |
| GET | `/v1/sessions/:id` | Yes* | Session + messages |
| POST | `/v1/admin/embed` | Yes (required) | Batch embeddings |
| POST | `/v1/admin/index` | Yes (required) | Embed + R2 + Vectorize upsert |
| GET | `/plugin/axis-pine-agent.js` | No | AXIS ES module |

\* When `API_KEY` secret is unset, open mode is allowed for local dev only.

### POST `/v1/chat`

```json
{
  "message": "v6 RSI strategy with ATR trailing stop for AXIS",
  "pine_version": "v6",
  "style": "strategy",
  "session_id": null,
  "validate": true,
  "max_retries": 2
}
```

Response includes `reply`, extracted `pine` source, `validation` (attempts / pyne-worker errors), `rag` hit list, and trademark disclaimer.

**Validation loop** (optional — only when `PYNE_SERVICE` or `PYNE_WORKER_URL` is set):

```text
generate (Workers AI™)
    → extract ```pine
    → [if pyne-worker configured]
         POST pyne-worker /run (synthetic OHLCV)
         → ok? return
         → else: fix prompt with error → retry (max_retries)
    → [else] return draft as-is (standalone)
```

- Standalone users: no config needed; loop is skipped.
- Disable even when configured: `"validate": false`.

## Configuration

| Binding / var | Purpose |
|---------------|---------|
| `AI` | Workers AI™ |
| `VECTORIZE` | Knowledge index (`pyne-agent-kb`, 768-d cosine) |
| `KB` | R2 document store |
| `DB` | D1 sessions |
| `ASSETS` | Static plugin + chat UI |
| `CHAT_MODEL` | Default `@cf/qwen/qwen2.5-coder-32b-instruct` |
| `EMBED_MODEL` | Default `@cf/baai/bge-base-en-v1.5` |
| `RAG_TOP_K` | Context chunks (default 8) |
| `ALLOWED_ORIGINS` | CORS for AXIS / HOOX |
| `API_KEY` | Secret |
| `PYNE_SERVICE` | **Optional** service binding → `pyne-worker` (off by default) |
| `PYNE_WORKER_URL` | **Optional** HTTP evaluate host |
| `PYNE_WORKER_API_KEY` | **Optional** secret for HTTP pyne-worker |
| `VALIDATE_DEFAULT` | Prefer validate when available (`true` / `false`) |
| `VALIDATE_MAX_RETRIES` | Extra fix attempts (default `2`) |

Standalone deploy: leave `PYNE_*` unset. Do not add a `services` binding to a worker you do not run.

## Local layout

```text
~/Git/pynescript          # PYNE core
~/Git/pyne-worker         # evaluate edge
~/Git/pyne-agent-worker   # this repo (write edge)
~/Git/axis                # charting PWA
~/Git/hoox                # edge mesh
```

## Scripts

| npm script | Action |
|------------|--------|
| `dev` / `deploy` | wrangler |
| `test` | bun tests |
| `legal-check` | refuse tracked Pine / missing marks |
| `ingest:docs` / `ingest:corpus` / `ingest:builtins` | stage KB chunks |
| `ingest:index` | R2 + Vectorize pipeline |

## License

GNU Affero General Public License v3 or later — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
