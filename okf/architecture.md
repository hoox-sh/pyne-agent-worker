---
type: Reference
title: Architecture
description: The project shape and the OpenOrchestrate team.
tags: [architecture, openorchestrate]
status: stable
---

# Architecture

pyne-agent-worker uses OpenOrchestrate. Languages: TypeScript, JavaScript, SQL, Shell, Python.

## Runtime surfaces

A Cloudflare Workers AI agent that authors PYNE scripts from natural language,
with an optional Vectorize knowledge base. It runs standalone on Workers AI, or
HOOX-enhanced when a `pyne-worker` service is bound for parse/lint/eval.

- **Entry points:** the Worker fetch handler (chat); `GET /health` reports
  `"mode": "standalone" | "hoox"`. Optional `/ast/*` and `/run` proxying when a
  PYNE service is available.
- **Run:** `bun run dev` locally, `bun run deploy` to Wrangler.
- **Verify:** `./scripts/verify.sh` runs `bun fmt --check`, `bun run typecheck`,
  and `bun run test`.

## The team

| Seat        | Title               | Agent        |
| ----------- | ------------------- | ------------ |
| Chief       | Chief of Staff      | `oo-chief`   |
| Ops         | Head of Operations  | `oo-ops`     |
| Checker     | Quality Gate        | `oo-checker` |
| Docs        | Head of Docs        | `oo-spec-1`  |
| Engineering | Head of Engineering | `oo-spec-2`  |
| Misc        | General Desk        | `oo-misc`    |

## The board

The board lives at `.openorchestrate/board.md`. It has five statuses:
Todo, Working, Blocked, Ready for Review, Done. A card moves to Done only with proof.

## Related

- [Development](development.md)
- [Security](security.md)
