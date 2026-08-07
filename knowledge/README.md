# Knowledge base (operator-private)

This directory describes **how** to build the Pine Script™ RAG index.
It does **not** ship TradingView® documentation dumps, open corpora, or
built-in sources.

| Path | Git? | Purpose |
|------|------|---------|
| `manifests/` | yes | Schemas / source declarations |
| `templates/` | yes | Tiny HOOX-owned `.pine.example` samples |
| `data/` | **no** (gitignored) | Staged chunks from ingest scripts |
| `raw/` `corpus/` `builtins/` `docs-cache/` | **no** | Operator working dirs |

## What goes into Vectorize™ / R2

1. **Docs v5 + v6** — lawful offline exports of Pine Script™ language reference  
   (`bun run ingest:docs -- --dir …`)
2. **Open corpus ≤ 1000** — OSS / your scripts only  
   (`bun run ingest:corpus -- --dir … --max 1000`)
3. **Built-in references** — private metadata or operator-held refs, never committed  
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
