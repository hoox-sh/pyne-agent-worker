# AGENTS.md — pyne-agent-worker

Guidance for coding agents working in this repository.

## Mission

Cloudflare® Worker that turns natural language into Pine Script™ using Workers AI™
and a Vectorize™ RAG knowledge base. Ships an AXIS plugin. Sister of pyne-worker
(evaluate) and axis (UI).

## Non-negotiables

1. **Never commit TradingView® built-in Pine sources** or scraped corpora.
2. **Always** use legal marks: Pine Script™, TradingView®, Cloudflare® (and ™/® on product names as in NOTICE).
3. Knowledge lives in **R2 + Vectorize** only; git has ingest scripts + tiny `.pine.example` templates.
4. Run `bash scripts/legal-check.sh` before deploy.
5. Do not claim TradingView® platform bit-parity.

## Stack

- TypeScript Cloudflare Worker (`src/index.ts`)
- Bindings: AI, Vectorize, R2 (`KB`), D1 (`DB`), Assets
- AXIS plugin: `plugin/axis-pine-agent.js` → served from `public/plugin/`

## Commands

```bash
bun install
bun test
bun run typecheck
bun run legal-check
bun run dev
```

## Touch points

| Area | Path |
|------|------|
| HTTP router | `src/index.ts` |
| Chat + RAG prompt | `src/routes/chat.ts`, `src/rag/*` |
| Validate loop | `src/rag/validate-loop.ts`, `src/lib/pyne-worker.ts` |
| Legal strings | `src/lib/legal.ts` |
| AXIS plugin | `plugin/axis-pine-agent.js` |
| Ingest | `scripts/ingest-*.ts`, `scripts/build-index.ts` |

## Standalone first

**pyne-worker is optional.** Default `wrangler.jsonc` has no `services` binding.
Users who do not run the HOOX stack still get full NL → PYNE Agent chat (AI + optional RAG).

## Validate loop (optional)

When `PYNE_SERVICE` or `PYNE_WORKER_URL` is set: **generate → pyne-worker `/run` → retry**.  
When not set: single generate; `validation.available: false` / skipped. Never fail chat because pyne-worker is absent.

## Related repos

- `/home/jango/Git/pynescript` — PYNE
- `/home/jango/Git/pyne-worker` — evaluate worker
- `/home/jango/Git/axis` — AXIS PWA plugins (`pynescript.axis.plugins.v1`)
