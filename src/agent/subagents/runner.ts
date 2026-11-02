// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateText, stepCountIs } from "ai";
import {
  type SpecialistRole,
  isUrlModelId,
  resolveRequestedModel,
  specialistModel,
} from "../../ai/routing";
import { resolveChatModel } from "../gateway";
import { createPyneTools } from "../tools-pyne";
import { createAxisTools } from "../tools-axis";
import { searchKnowledge } from "../knowledge";
import { formatLintForModel, lintPine } from "../lint";
import { tool } from "ai";
import { z } from "zod";
import { specialistSystemPrompt } from "./prompts";
import type { SpecialistQuota } from "./quota";
import { extractPineBlock } from "../../rag/prompts";

export type SpecialistResult = {
  ok: boolean;
  role: SpecialistRole;
  model?: string;
  text?: string;
  pine?: string | null;
  error?: string;
  skipped?: boolean;
  latency_ms: number;
};

function knowledgeTool(env: Env) {
  return {
    search_knowledge_base: tool({
      description: "Search Pine / PYNE knowledge.",
      inputSchema: z.object({
        query: z.string().min(2).max(500),
        top_k: z.number().int().min(1).max(12).optional(),
      }),
      execute: async ({ query, top_k }) => {
        const result = await searchKnowledge(env, query, top_k ?? 6);
        return {
          ok: true,
          backend: result.backend,
          text: result.formatted,
        };
      },
    }),
  };
}

function validateTool() {
  return {
    validate_pine: tool({
      description: "Heuristic Pine lint.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000),
      }),
      execute: async ({ code }) => {
        const result = lintPine(code);
        return {
          ok: result.ok,
          summary: formatLintForModel(result),
          fixed_code: result.fixed,
        };
      },
    }),
  };
}

/** Narrow tool subset per role. Never includes subagent_spawn. */
export function toolsForRole(env: Env, role: SpecialistRole) {
  const pyne = createPyneTools(env);
  const axis = createAxisTools(env);
  const knowledge = knowledgeTool(env);
  const lint = validateTool();

  switch (role) {
    case "parser":
      return {
        pyne_parse: pyne.pyne_parse,
        pyne_ast: pyne.pyne_ast,
        pyne_unparse: pyne.pyne_unparse,
        pyne_format: pyne.pyne_format,
        ...lint,
      };
    case "validator":
      return {
        pyne_lint: pyne.pyne_lint,
        pyne_diagnostics: pyne.pyne_diagnostics,
        pyne_eval: pyne.pyne_eval,
        pyne_compile: pyne.pyne_compile,
        ...lint,
      };
    case "optimizer":
      return {
        pyne_parse: pyne.pyne_parse,
        pyne_lint: pyne.pyne_lint,
        ...knowledge,
      };
    case "docs":
      return knowledge;
    case "axis":
      return {
        axis_mcp_status: axis.axis_mcp_status,
        axis_chart_load: axis.axis_chart_load,
        axis_editor_set: axis.axis_editor_set,
        axis_editor_run: axis.axis_editor_run,
        axis_alerts_create: axis.axis_alerts_create,
        axis_results_get: axis.axis_results_get,
        axis_engine_tick: axis.axis_engine_tick,
        axis_app: axis.axis_app,
        axis_run_pine: axis.axis_run_pine,
      };
    case "dynamic":
      return {
        ...knowledge,
        ...lint,
        pyne_parse: pyne.pyne_parse,
        pyne_lint: pyne.pyne_lint,
        pyne_eval: pyne.pyne_eval,
        axis_mcp_status: axis.axis_mcp_status,
        axis_run_pine: axis.axis_run_pine,
        axis_results_get: axis.axis_results_get,
      };
  }
}

export async function runSpecialist(
  env: Env,
  quota: SpecialistQuota,
  opts: {
    role: SpecialistRole;
    task: string;
    context?: string;
    model?: string;
  }
): Promise<SpecialistResult> {
  const started = Date.now();
  const acq = quota.tryAcquire();
  if (!acq.ok) {
    return {
      ok: false,
      role: opts.role,
      error: acq.error,
      skipped: acq.skipped,
      latency_ms: Date.now() - started,
    };
  }

  try {
    let modelId = specialistModel(env, opts.role);
    const requested = (opts.model || "").trim();
    if (requested && !isUrlModelId(requested)) {
      modelId = resolveRequestedModel(env, requested);
    }

    const { model, providerOptions } = resolveChatModel(env, {
      model: modelId,
    });
    const tools = toolsForRole(env, opts.role);
    const userContent = [
      opts.task.trim(),
      opts.context?.trim() ? `\n## Context\n${opts.context.trim().slice(0, 24_000)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await generateText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      system: specialistSystemPrompt(opts.role),
      messages: [{ role: "user", content: userContent }],
      // Role subsets differ; AI SDK ToolSet is an open index signature.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      stopWhen: stepCountIs(4),
      maxOutputTokens: 2048,
      temperature: 0.2,
      providerOptions: {
        ...(providerOptions || {}),
        "workers-ai": {
          ...((providerOptions?.["workers-ai"] as object) || {}),
          reasoning_effort: "low",
        },
      },
    });

    const text = result.text || "";
    return {
      ok: true,
      role: opts.role,
      model: modelId,
      text,
      pine: extractPineBlock(text),
      latency_ms: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      role: opts.role,
      error: msg.slice(0, 400),
      latency_ms: Date.now() - started,
    };
  } finally {
    quota.release();
  }
}
