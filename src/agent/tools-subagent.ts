// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { tool } from "ai";
import { z } from "zod";
import type { SpecialistQuota } from "./subagents/quota";
import { runSpecialist } from "./subagents/runner";

/** Orchestrator-only. Never register on MCP or specialist tool sets. */
export function createSubagentTools(env: Env, quota: SpecialistQuota) {
  return {
    subagent_spawn: tool({
      description:
        "Spawn an in-isolate specialist LLM loop. Ceiling: 1 orchestrator + 5 specialists = 6 agents; in-flight specialists ≤ 3. Prefer tools (pyne_*, search_knowledge_base, axis_*) when they suffice.",
      inputSchema: z.object({
        role: z.enum([
          "parser",
          "validator",
          "optimizer",
          "docs",
          "axis",
          "dynamic",
        ]),
        task: z.string().min(8).max(4000),
        context: z
          .string()
          .max(24_000)
          .optional()
          .describe("Truncated Pine / errors / RAG for the specialist"),
        model: z
          .string()
          .max(80)
          .optional()
          .describe("Allowlisted Workers AI model id only — never a URL"),
      }),
      execute: async ({ role, task, context, model }) =>
        runSpecialist(env, quota, { role, task, context, model }),
    }),
  };
}
