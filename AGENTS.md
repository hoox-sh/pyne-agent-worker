# AGENTS.md — pyne-agent-worker

Guidance for coding agents working in this repository.

## Mission

Cloudflare® Worker that turns natural language into Pine Script™ using Workers AI™
and a Vectorize™ RAG knowledge base. Ships an AXIS plugin. Sister of pyne-worker
(evaluate) and axis (UI).

Service **0.4.0** (Grandmaster edition). Capabilities (GLM routing, PYNE backends,
staged validate, AXIS wrappers, sub-agents, 384-d KB) ship **behind feature flags**.
Git defaults stay on Qwen 32B / 768-d / no spawn until operators opt in. Plugin is **0.1.8**.

## Non-negotiables

1. **Never commit TradingView® built-in Pine sources** or scraped corpora.
2. **Always** use legal marks: Pine Script™, TradingView®, Cloudflare® (and ™/® on product names as in NOTICE).
3. Knowledge lives in **R2 + Vectorize** only; git has ingest scripts + tiny `.pine.example` templates.
4. Run `bash scripts/legal-check.sh` before deploy.
5. Do not claim TradingView® platform bit-parity.
6. Never invent Pine APIs. Client `model` / `pyne_backend` must never be arbitrary URLs.

## Stack

- TypeScript Cloudflare Worker (`src/index.ts`)
- Bindings: AI, Vectorize (+ optional V2), R2 (`KB`), D1 (`DB`), Assets, optional AI Search
- AXIS plugin: `plugin/axis-pine-agent.js` → served from `public/plugin/` (must stay byte-identical)

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
| Chat | `src/routes/chat.ts` |
| Model routing / flags | `src/ai/routing.ts` |
| Grandmaster prompts | `src/agent/grandmaster.ts`, `prompts-v6.ts`, `rag/prompts.ts` |
| Tools composition | `src/agent/tools.ts`, `tools-axis.ts`, `tools-pyne.ts`, `tools-subagent.ts` |
| Sub-agents | `src/agent/subagents/*`, `orchestrator.ts` |
| Validate loop | `src/rag/validate-loop.ts` |
| PYNE backends | `src/lib/pyne-backend.ts`, `pyne-ast.ts`, `pyne-http.ts` |
| AXIS MCP | `src/axis/mcp-client.ts`, `src/axis/prompts.ts` |
| MCP server | `src/mcp/pyne-mcp.ts` |
| RAG retrieve | `src/rag/retrieve.ts`, `src/agent/knowledge.ts` |
| Legal strings | `src/lib/legal.ts` |
| AXIS plugin | `plugin/axis-pine-agent.js` |
| Ingest | `scripts/ingest-*.ts`, `scripts/build-index.ts`, `scripts/lib/chunk.ts` |

## Standalone first

**pyne-worker is optional.** Default `wrangler.jsonc` has no `services` binding.
Users who do not run the HOOX stack still get full NL → PYNE Agent chat (AI + optional RAG).

## Validate loop (optional)

Named PYNE host (`PYNE_BACKEND` / request `pyne_backend`): **generate → staged parse → lint → eval → retry**.  
Flask hosts use `/lsp/diagnostics` for parse/lint; worker `/ast/*` needs `FEATURE_PYNE_AST` + sister routes.  
When only `AXIS_MCP_URL` is set: eval via AXIS `axis_run`.  
When neither is set: single generate; validation skipped. Never fail chat because a backend is absent.

## Related repos

- `/home/jango/Git/pynescript` — PYNE
- `/home/jango/Git/pyne-worker` — evaluate worker (`/run`; `/ast/*` is a sister follow-up)
- `/home/jango/Git/axis` — AXIS PWA plugins (`pynescript.axis.plugins.v1`)
