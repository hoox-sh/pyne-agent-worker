# Knowledge base (operator-private)

This directory describes **how** to build the Pine Script™ RAG index.
It does **not** ship TradingView® documentation dumps, open corpora, or
built-in sources.

| Path | Git? | Purpose |
|------|------|---------|
| `manifests/` | yes | Schemas / source declarations |
| `templates/` | yes | Tiny HOOX-owned `.pine.example` samples |
| `pineDocs.json` | **no** | Operator Pine Script™ language reference (v6 + 2025–2026) |
| `axisDocs.json` | **no** | Generated AXIS PWA KB (`bun run ingest:axis`) |
| `axis-llm.txt` / `pyne-llm.txt` | **no** | HOOX consolidated doc packs |
| `data/` | **no** (gitignored) | Staged chunks from ingest scripts |
| `raw/` `corpus/` `builtins/` `docs-cache/` | **no** | Operator working dirs |

## What goes into Vectorize™ / R2

Preferred one-shot (uses sister repos when present, else local packs):

```bash
bun run ingest:kb
bun run ingest:index
```

Or step by step:

1. **Pine Script™ language reference** — `knowledge/pineDocs.json`  
   (`bun run ingest:pinedocs`)
2. **AXIS PWA** — live `../axis/docs` or `knowledge/axis-llm.txt`  
   (`bun run ingest:axis` then ingest via `ingest:kb`)
3. **PYNE docs** — live `../pynescript/docs/pyne` or `knowledge/pyne-llm.txt`  
   (`bun run ingest:docs -- --pyne-docs ../pynescript/docs/pyne` or `bun run ingest:llm`)
4. **Open corpus ≤ 1000** — OSS / your scripts only  
   (`bun run ingest:corpus -- --dir … --max 1000`)
5. **Built-in references** — private metadata or operator-held refs, never committed  
   (`bun run ingest:builtins -- --metadata …` or `--dir …`)

Then:

```bash
bun run ingest:index
# or with embeddings:
bun run scripts/build-index.ts --embed-endpoint https://<worker>/v1/admin/embed
```

## Legal

Pine Script™ and TradingView® are trademarks of TradingView, Inc.
Cloudflare®, Workers AI™, and Vectorize™ are marks of Cloudflare, Inc.

Do **not** commit proprietary TradingView® built-in indicator/strategy sources.
Operators are responsible for rights to any ingested material.
