// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { tool } from "ai";
import { z } from "zod";
import { searchKnowledge } from "./knowledge";
import { formatLintForModel, lintPine } from "./lint";
import { createAxisTools } from "./tools-axis";
import { createPyneTools } from "./tools-pyne";
import { createSubagentTools } from "./tools-subagent";
import { featureSubagents } from "../ai/routing";
import type { SpecialistQuota } from "./subagents/quota";

export type AgentToolsCatalog = "full" | "axis";

export type CreateAgentToolsOpts = {
  /** full = default; axis = REST looksActionable (no pyne_*, no spawn). */
  catalog?: AgentToolsCatalog;
  /** Per-request quota; required for subagent_spawn. */
  quota?: SpecialistQuota;
  /** When true and FEATURE_SUBAGENTS, attach subagent_spawn. */
  allowSpawn?: boolean;
};

export type AxisPane = {
  id: string;
  kind: "price" | "oscillator" | "volume" | "custom";
  title?: string;
  height?: number;
  overlays?: string[];
};

export type AxisChartLayout = {
  version: 1;
  title?: string;
  theme?: "dark" | "light" | "auto";
  panes: AxisPane[];
  colors?: Record<string, string>;
};

/**
 * Server-side tools for PyneAgent (AIChatAgent + MCP).
 * Strict Zod schemas prevent malformed tool args from crashing the DO.
 */
export function createAgentTools(env: Env, opts?: CreateAgentToolsOpts) {
  const catalog = opts?.catalog ?? "full";

  const searchKbTool = tool({
    description:
      "Search Pine Script™ / PYNE knowledge (AI Search hybrid or Vectorize fallback) for exact syntax, builtins, and limits before writing code.",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .max(500)
        .describe("Search query, e.g. 'strategy.entry v6' or 'ta.rsi signature'"),
      top_k: z.number().int().min(1).max(12).optional().describe("Max chunks (default 6)"),
    }),
    execute: async ({ query, top_k }) => {
      const result = await searchKnowledge(env, query, top_k ?? 6);
      return {
        ok: true,
        cached: Boolean(result.cached),
        backend: result.backend,
        hit_count: result.hits.length,
        text: result.formatted,
      };
    },
  });

  const core = {
    search_knowledge_base: searchKbTool,
    /** Alias of search_knowledge_base (0.4.0 vocabulary). */
    rag_search: searchKbTool,

    validate_pine: tool({
      description:
        "Lint generated Pine Script™ for common LLM hallucinations (missing version, bad builtins, deprecated security/study). Call before final answer.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000).describe("Full Pine source to validate"),
        apply_fixes: z
          .boolean()
          .optional()
          .describe("Return auto-fixed source when safe (default true)"),
      }),
      execute: async ({ code, apply_fixes }) => {
        const result = lintPine(code);
        const apply = apply_fixes !== false;
        return {
          ok: result.ok,
          summary: formatLintForModel(result),
          issues: result.issues,
          fixed_code: apply ? result.fixed : code,
          changed: apply ? result.changed : false,
        };
      },
    }),

    render_axis_chart: tool({
      description:
        "Emit an AXIS chart layout plan (panes, overlays, colors) for the client plugin to render alongside the generated script. Does not execute trades.",
      inputSchema: z.object({
        title: z.string().max(120).optional(),
        theme: z.enum(["dark", "light", "auto"]).optional(),
        pine_summary: z
          .string()
          .max(500)
          .optional()
          .describe("One-line description of what the script plots"),
        panes: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              kind: z.enum(["price", "oscillator", "volume", "custom"]),
              title: z.string().max(80).optional(),
              height: z.number().min(0.1).max(1).optional(),
              overlays: z.array(z.string().max(80)).max(20).optional(),
            })
          )
          .min(1)
          .max(6),
        colors: z.record(z.string(), z.string()).optional(),
      }),
      execute: async (input) => {
        const layout: AxisChartLayout = {
          version: 1,
          title: input.title,
          theme: input.theme ?? "auto",
          panes: input.panes,
          colors: input.colors,
        };
        return {
          ok: true,
          type: "axis_chart_layout",
          layout,
          pine_summary: input.pine_summary ?? null,
          note: "AXIS plugin may render this layout; standalone UI shows JSON preview.",
        };
      },
    }),
  };

  if (catalog === "axis") {
    return {
      ...core,
      ...createAxisTools(env),
    };
  }

  const full = {
    ...core,
    ...createAxisTools(env),
    ...createPyneTools(env),
  };

  if (
    opts?.allowSpawn &&
    opts.quota &&
    featureSubagents(env)
  ) {
    return {
      ...full,
      ...createSubagentTools(env, opts.quota),
    };
  }

  return full;
}

export type AgentTools = ReturnType<typeof createAgentTools>;
