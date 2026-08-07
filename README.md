# pyne-agent-worker

> **Cloudflare® Workers AI™** agent that writes **Pine Script™** from natural language,
> backed by a private **Vectorize™** knowledge base (v5/v6 docs + open corpus ≤ 1000 +
> operator-supplied built-in references). **AXIS** sister plugin for the HOOX / PYNE stack.

**Version:** 0.1.1 · **Runtime:** Cloudflare Workers (TypeScript) · **License:** AGPL-3.0-or-later

_Pine Script™ and TradingView® are trademarks of TradingView, Inc.  
Cloudflare® is a registered trademark of Cloudflare, Inc.  
This project is independent and is **not** affiliated with, endorsed by, or sponsored by TradingView, Inc. or Cloudflare, Inc._

---

## Why this repo exists

| Sibling | Role |
|---------|------|
| [hoox-sh/pyne](https://github.com/hoox-sh/pyne) (`pynescript`) | Pine toolchain + Pro API |
| [hoox-sh/pyne-worker](https://github.com/hoox-sh/pyne-worker) | Edge **evaluate** host |
| [hoox-sh/axis](https://github.com/hoox-sh/axis) | Charting PWA (plugins) |
| **pyne-agent-worker** (this) | Edge **write** Pine via chat + RAG |

```text
User (AXIS chat / HTTP)
        │  natural language
        ▼
┌─────────────────────────┐
│  pyne-agent-worker      │  Workers AI™ (coder model)
│  POST /v1/chat          │
└───────────┬─────────────┘
            │ retrieve
            ▼
   Vectorize™ + R2 knowledge
   (docs v5/v6 · corpus ≤1000 · builtin-refs)
            │
            ▼
   Pine Script™ source in reply
   → paste / insert into AXIS editor
   → evaluate with pyne-worker / Pro API
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

- **POST `/v1/chat`** — NL → Pine Script™ with RAG context
- **Generate → validate → retry** — each draft is run on sister **pyne-worker** (`POST /run` with synthetic bars); failures are fed back to the model (default up to 2 retries)
- **GET/POST `/v1/search`** — raw Vectorize search over the knowledge base
- **Sessions** — optional D1 history (`/v1/sessions`)
- **AXIS plugin** — `GET /plugin/axis-pine-agent.js` (`kind: component` + floating UI fallback)
- **Static chat shell** — `GET /` for demos / iframe
- **Admin index** — `POST /v1/admin/embed` + `/v1/admin/index` (requires `API_KEY`)
- **Trademark-safe copy** — Pine Script™ / TradingView® / Cloudflare® in UI + API

## Quick start

```bash
cd ~/Git/pyne-agent-worker
bun install

# Create Cloudflare resources (once)
npx wrangler vectorize create pyne-agent-kb --dimensions=768 --metric=cosine
npx wrangler r2 bucket create pyne-agent-kb
npx wrangler d1 create pyne-agent-sessions
# paste database_id into wrangler.jsonc
npx wrangler d1 execute pyne-agent-sessions --remote --file=schemas/sessions.sql

# Local
cp .env.example .dev.vars   # optional API_KEY=
bun run dev

# Deploy
echo "your-secret" | npx wrangler secret put API_KEY
bun run deploy
```

### Build the knowledge base (private)

```bash
# 1) Docs you are allowed to use (offline export) + optional PYNE docs
bun run ingest:docs -- --dir /secure/pine-docs-v6 --version v6
bun run ingest:docs -- --pyne-docs ../pynescript/docs/pyne

# 2) Open corpus (max 1000) — not TV built-ins
bun run ingest:corpus -- --dir /secure/open-pine-corpus --max 1000

# 3) Built-in *metadata* / private refs (never commit the inputs)
bun run ingest:builtins -- --metadata ../pynescript/src/pynescript/langserver/providers/builtin_metadata.json

# 4) Embed + upsert (worker must be deployed with API_KEY)
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

See [`plugin/README.md`](./plugin/README.md).

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

**Validation loop** (when pyne-worker is configured via `PYNE_SERVICE` binding or `PYNE_WORKER_URL`):

```text
generate (Workers AI™)
    → extract ```pine
    → POST pyne-worker /run (synthetic OHLCV)
    → ok? return
    → else: fix prompt with error → retry (max_retries)
```

Disable per request with `"validate": false`.

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
| `PYNE_SERVICE` | Service binding → `pyne-worker` |
| `PYNE_WORKER_URL` | HTTP fallback evaluate host |
| `PYNE_WORKER_API_KEY` | Secret for HTTP pyne-worker |
| `VALIDATE_DEFAULT` | `true` / `false` |
| `VALIDATE_MAX_RETRIES` | Extra fix attempts (default `2`) |

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
