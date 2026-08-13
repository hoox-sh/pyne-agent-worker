# PYNE Agent — Agents SDK edge architecture

Branch: `feat/agents-sdk-edge-architecture` · Service version **0.2.0**

_Pine Script™ and TradingView® are trademarks of TradingView, Inc.  
Cloudflare® is a registered trademark of Cloudflare, Inc._

## Abstract

Stateful **NL → Pine Script™ v6** agent on Cloudflare Workers:

| Surface | Path | Persistence |
|---------|------|-------------|
| **Agents SDK chat** | `/agents/pyne-agent/:session` | Durable Object SQLite (`AIChatAgent`) |
| **MCP tools** | `/mcp` | Durable Object (`McpAgent`) |
| **Legacy REST** | `POST /v1/chat` | Optional D1 (unchanged) |
| **AXIS plugin** | `/plugin/axis-pine-agent.js` | Client UI |

Standalone-first: **Workers AI only** is enough. AI Search, Vectorize, R2, D1, pyne-worker, AI Gateway are optional enhancements.

## Pillar map (10 agents → modules)

| # | Pillar | Implementation |
|---|--------|----------------|
| 1 | Agents SDK / DO | `src/agent/pyne-agent.ts` · `new_sqlite_classes: ["PyneAgent","PyneMcp"]` |
| 2 | LLM / prompts | `src/agent/prompts-v6.ts` · `workers-ai-provider` + `streamText` |
| 3 | AI Search / RAG | `src/agent/knowledge.ts` · `AI_SEARCH` + Vectorize fallback |
| 4 | AXIS chart tool | `render_axis_chart` in `src/agent/tools.ts` |
| 5 | Lint / validate | `src/agent/lint.ts` · tool `validate_pine` |
| 6 | Gateway / cache | `src/agent/gateway.ts` · model fallback + RAG cache |
| 7 | Streaming UI | Agents WS protocol + `public/agent.html` |
| 8 | MCP | `src/mcp/pyne-mcp.ts` · `POST /mcp` |
| 9 | Guardrails | `looksOffTopic` + Zod tool schemas |
| 10 | QA | `tests/lint.test.ts` (+ existing suite) |

## Wrangler bindings

```jsonc
{
  "ai": { "binding": "AI" },
  "ai_search_namespaces": [{ "binding": "AI_SEARCH", "namespace": "default", "remote": true }],
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "pyne-agent-kb" }],
  "durable_objects": {
    "bindings": [
      { "name": "PyneAgent", "class_name": "PyneAgent" },
      { "name": "PyneMcp", "class_name": "PyneMcp" }
    ]
  },
  "migrations": [{ "tag": "v1-agents-sdk", "new_sqlite_classes": ["PyneAgent", "PyneMcp"] }]
}
```

## Session isolation

- Agent instance name **is** the session id: `/agents/pyne-agent/<session>`.
- Each session is a separate Durable Object — chat history does not bleed across users.
- Prefer opaque random session ids from the client (do not reuse public user emails as names without hashing).

## Tools

| Tool | Purpose |
|------|---------|
| `search_knowledge_base` | AI Search hybrid → Vectorize fallback; isolate-level TTL cache |
| `validate_pine` | Heuristic lint + safe auto-fixes (`security`→`request.security`) |
| `render_axis_chart` | Structural AXIS pane layout JSON for the plugin |

## Edge cases

| Case | Handling |
|------|----------|
| DO hibernation | AIChatAgent SQLite + resumable stream buffers |
| Primary model timeout | Retry once with `CHAT_MODEL_FALLBACK` |
| AI Search missing | Vectorize retrieve; empty → conservative prompt |
| Malformed tool args | Zod schemas reject before execute |
| Off-topic prompt | Short refusal, no tool loop |
| `API_KEY` set | REST + MCP require key; WS upgrade currently open for agent clients (tighten with ticket auth if needed) |

## Validation

```bash
bun test
bun run typecheck
bun run legal-check
```

Manual:

```bash
bun run dev
# REST still works:
curl -s localhost:8787/health | jq .
# MCP (open mode):
# configure Cursor/VS Code MCP URL → http://127.0.0.1:8787/mcp
```

## Legal

- No TradingView® built-in sources in git.
- Marks: Pine Script™, TradingView®, Cloudflare®.
- Knowledge only in R2 / Vectorize / AI Search (operator-ingested).
