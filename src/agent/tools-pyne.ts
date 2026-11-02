// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PYNE language + eval tools. HTTP only — never invent Pine APIs.
 */

import { tool } from "ai";
import { z } from "zod";
import {
  envPyneBackend,
  type PyneBackendKind,
  validateOnSelectedBackend,
} from "../lib/pyne-backend";
import { pyneAstOp, pyneLintOrHeuristic } from "../lib/pyne-ast";
import { isAxisMcpConfigured, validateOnAxisMcp } from "../axis/mcp-client";
import { syntheticBars } from "../lib/synthetic-bars";

function kindFromArg(raw: string | undefined, env: Env): PyneBackendKind {
  const s = String(raw || "").trim().toLowerCase();
  if (
    s === "auto" ||
    s === "pro" ||
    s === "local" ||
    s === "worker" ||
    s === "container" ||
    s === "none"
  ) {
    return s;
  }
  return envPyneBackend(env);
}

export function createPyneTools(env: Env) {
  const backendField = z
    .enum(["auto", "pro", "local", "worker", "container", "none"])
    .optional()
    .describe("Named PYNE host override for this call");

  return {
    pyne_parse: tool({
      description:
        "Parse Pine Script™ via PYNE (/ast/parse or Flask /lsp/diagnostics). Skips when the host has no language route.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        backend: backendField,
      }),
      execute: async ({ code, backend }) =>
        pyneAstOp(env, "parse", code, kindFromArg(backend, env)),
    }),

    pyne_ast: tool({
      description:
        "Dump the PYNE AST (/ast/dump). Flask hosts skip — use pyne_parse/pyne_diagnostics instead.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        as_json: z.boolean().optional(),
        backend: backendField,
      }),
      execute: async ({ code, as_json, backend }) =>
        pyneAstOp(env, "dump", code, kindFromArg(backend, env), {
          as_json: as_json !== false,
        }),
    }),

    pyne_unparse: tool({
      description: "Parse→unparse round-trip via PYNE /ast/unparse (worker only).",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        backend: backendField,
      }),
      execute: async ({ code, backend }) =>
        pyneAstOp(env, "unparse", code, kindFromArg(backend, env)),
    }),

    pyne_format: tool({
      description: "Format Pine via PYNE /ast/format (worker only; alias of unparse).",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        backend: backendField,
      }),
      execute: async ({ code, backend }) =>
        pyneAstOp(env, "format", code, kindFromArg(backend, env)),
    }),

    pyne_lint: tool({
      description:
        "Lint Pine via PYNE language surface, or heuristic lint when no host is available.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        backend: backendField,
      }),
      execute: async ({ code, backend }) =>
        pyneLintOrHeuristic(env, code, kindFromArg(backend, env)),
    }),

    pyne_diagnostics: tool({
      description:
        "Parse errors + lint findings (PYNE /ast/diagnostics or Flask /lsp/diagnostics).",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        backend: backendField,
      }),
      execute: async ({ code, backend }) =>
        pyneAstOp(env, "diagnostics", code, kindFromArg(backend, env)),
    }),

    pyne_compile: tool({
      description:
        "Compile-check only via POST /ast/compile (worker). Never runs bars. Never returns Python IR. Skips until the sister route exists.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        backend: backendField,
      }),
      execute: async ({ code, backend }) =>
        pyneAstOp(env, "compile", code, kindFromArg(backend, env)),
    }),

    pyne_eval: tool({
      description:
        "Evaluate Pine on the selected PYNE host POST /run (or AXIS axis_run). Uses synthetic bars by default.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
        mode: z.enum(["interpret", "compile", "auto"]).optional(),
        bars: z.number().int().min(32).max(256).optional(),
        symbol: z.string().max(24).optional(),
        backend: backendField,
      }),
      execute: async ({ code, mode, bars, symbol, backend }) => {
        const kind = kindFromArg(backend, env);
        const ohlcv = syntheticBars(bars ?? 64);
        if (kind !== "none") {
          const r = await validateOnSelectedBackend(
            env,
            { script: code, mode: mode || "interpret", symbol, ohlcv },
            kind
          );
          if (!r.skipped || r.ok) return r;
        }
        if (isAxisMcpConfigured(env)) {
          return validateOnAxisMcp(env, {
            script: code,
            mode: mode || "interpret",
            symbol,
          });
        }
        return {
          ok: false,
          skipped: true,
          retryable: false,
          backend: "none",
          reason: "no PYNE eval backend configured",
          latency_ms: 0,
        };
      },
    }),
  };
}

export type PyneTools = ReturnType<typeof createPyneTools>;
