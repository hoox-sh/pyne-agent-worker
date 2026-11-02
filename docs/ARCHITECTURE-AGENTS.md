# PYNE Agent — Grandmaster edge architecture

Service version **0.4.0** (worker). Plugin **0.1.9**. Grandmaster capabilities ship behind feature flags; git defaults stay Free-plan safe until operators opt in.

_Pine Script™ and TradingView® are trademarks of TradingView, Inc.  
Cloudflare® is a registered trademark of Cloudflare, Inc._

## Abstract

Stateful **NL → Pine Script™ v6** agent on Cloudflare Workers:

| Surface | Path | Persistence |
|---------|------|-------------|
| **Agents SDK chat** | `/agents/pyne-agent/:session` | Durable Object SQLite (`AIChatAgent`) |
| **MCP tools** | `/mcp` | Durable Object (`McpAgent`) |
| **REST** | `POST /v1/chat` | Optional D1 |
| **AXIS plugin** | `/plugin/axis-pine-agent.js` | Agent panel UI (0.1.9 always `orchestrate: true`) |

Standalone-first: **Workers AI only** is enough. AI Search, Vectorize, R2, D1, PYNE hosts, AXIS MCP, AI Gateway are optional.

## Pillar map

| # | Pillar | Implementation |
|---|--------|----------------|
| 1 | Agents SDK / DO | `src/agent/pyne-agent.ts` · `PyneAgent` + `PyneMcp` |
| 2 | Model routing | `src/ai/routing.ts` · `FEATURE_GLM53` gated allowlist · BYOM |
| 3 | Grandmaster prompts | `src/agent/grandmaster.ts` · `tools: none\|axis\|full` |
| 4 | RAG | `src/agent/knowledge.ts` · AI Search → Vectorize V1/V2 |
| 5 | PYNE backends | `src/lib/pyne-backend.ts` · pro / local / worker / container |
| 6 | Language + staged validate | `src/lib/pyne-ast.ts` · `src/rag/validate-loop.ts` |
| 7 | AXIS tools | `src/agent/tools-axis.ts` · wrappers + escape hatches |
| 8 | Sub-agents | `src/agent/subagents/*` · `FEATURE_SUBAGENTS` · per-request quota |
| 9 | MCP | `src/mcp/pyne-mcp.ts` · additive tools · `rag_search` alias |
| 10 | Guardrails / QA | Zod schemas · `looksOffTopic` · `bun test` |

## Feature flags (git defaults)

| Flag | Default | Effect when `true` |
|------|---------|-------------------|
| `FEATURE_GLM53` | `false` | Allowlist GLM-5.3 / Flash / Kimi; promote default Qwen → GLM |
| `FEATURE_SUBAGENTS` | `false` | Attach `subagent_spawn` on SDK / `orchestrate: true` |
| `FEATURE_PYNE_AST` | `false` | Worker `/ast/*` language ops |
| `FEATURE_KB_384` | `false` | Prefer Vectorize V2 (384-d, `cls`) when bound |
| `KB_FALLBACK_V1` | `false` | On empty/error V2, re-embed and query 768-d V1 |

## REST chat paths

| Request | Tools mode | Loop |
|---------|------------|------|
| Missing `orchestrate` (curl / plugin 0.1.7) | `none` | Generate + **server-side** staged parse→lint→eval |
| `looksActionable` + AXIS MCP | `axis` | ≤4 steps, AXIS tools only (no `pyne_*`, no spawn) |
| `orchestrate: true` (plugin 0.1.9) | `full` | ≤8–12 steps; spawn if `FEATURE_SUBAGENTS` |

Compute actionable / orchestrate **before** `buildSystemPrompt` so Grandmaster prose matches the tool catalog.

## Tools (composition root: `src/agent/tools.ts`)

| Group | Tools |
|-------|-------|
| Knowledge | `search_knowledge_base`, `rag_search` (alias) |
| Lint | `validate_pine` (heuristic) |
| Layout | `render_axis_chart` |
| PYNE language | `pyne_parse`, `pyne_ast`, `pyne_unparse`, `pyne_format`, `pyne_lint`, `pyne_diagnostics`, `pyne_compile`, `pyne_eval` |
| AXIS | `axis_mcp_status`, wrappers (`axis_chart_load`, `axis_editor_set`, `axis_editor_run`, `axis_alerts_create`, `axis_results_get`, `axis_engine_tick`), `axis_run_pine`, `axis_app`, `axis_control` |
| Sub-agents | `subagent_spawn` (SDK/orchestrate only; **not** on MCP) |

`axis_run_pine` sends only `{ script, data }` — never ticker/timeframe. Strategy stats live on `axis_results_get` / `results.get` (no `results.strategy` tool).

## PYNE backends

Named kinds (client sends a kind, never a URL): `auto` · `pro` · `local` · `worker` · `container` · `none`.

| Kind | Dialect | Language | Eval |
|------|---------|----------|------|
| `worker` | `{ script, ohlcv, timeframe }` | `/ast/*` when flagged | `POST /run` |
| `pro` / `local` / `container` | Flask `{ script, data }` | `/lsp/diagnostics` | `POST /run` |
| `none` | — | heuristic lint | AXIS `axis_run` if configured |

`auto` order: worker → container → pro → local. Loopback needs `PYNE_ALLOW_PRIVATE_URLS=true`.

## Validation

Staged: **parse → lint → eval** (`VALIDATE_STAGES`). Missing `/ast` skips that stage (not a parse failure). Structured JSON error on retry. Never App-plane `editor.*` inside `generateValidateRetry`.

## Knowledge indexes

| Binding | Dims | Model | Pooling |
|---------|------|-------|---------|
| `VECTORIZE` | 768 | `bge-base-en-v1.5` | `mean` |
| `VECTORIZE_V2` (optional) | 384 | `bge-small-en-v1.5` | `cls` |

Never cross-query dimensions. Create V2 with:

```bash
npx wrangler vectorize create pyne-agent-kb-384 --dimensions=384 --metric=cosine
```

## Sub-agents

Per-request quota: max **5** specialists, **3** in-flight, isolate fuse. Nested spawn forbidden. MCP never exposes `subagent_spawn` in 0.4.0.

## Session isolation

- Agent instance name **is** the session id: `/agents/pyne-agent/<session>`.
- Each session is a separate Durable Object.
- State: `pineVersion`, `style`, `persona` (`auto` re-detects per turn).

## Edge cases

| Case | Handling |
|------|----------|
| Primary model timeout / 403-5035 | Retry once with fallback |
| AI Search missing | Vectorize; empty → conservative prompt |
| Off-topic / chit-chat | Refusal or greeting; no validate loop |
| AXIS `NO_BACKEND` / `UNKNOWN_FIELDS` | Skip, no GPU retry |
| Explicit `pyne_backend` unbound | Skip with reason (no silent fallthrough) |
| Missing `orchestrate` | Cheap REST |

## Validation commands

```bash
bun test
bun run typecheck
bun run legal-check
```

## Legal

- No TradingView® built-in sources in git.
- Marks: Pine Script™, TradingView®, Cloudflare®.
- Knowledge only in R2 / Vectorize / AI Search (operator-ingested).
