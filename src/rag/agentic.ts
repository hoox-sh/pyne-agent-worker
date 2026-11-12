// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Server-side agentic loop for the legacy REST path (`POST /v1/chat`).
 *
 * The REST path has no streaming tool protocol — but the model can still
 * ACT here: `generateText` runs the same `createAgentTools` set (AXIS MCP,
 * knowledge, lint) server-side for a bounded number of steps, so an
 * "axis operator" request (change the theme, load BTC, run this) executes
 * instead of merely describing steps.
 *
 * Budget-guarded: only entered when `looksActionable` says the user wants
 * action, max 4 model steps. Failures propagate to the caller, which falls
 * back to the single-shot loop (never fail chat because tools errored).
 */

import { generateText, stepCountIs } from "ai";
import {
  createAgentTools,
  type AgentToolsCatalog,
} from "../agent/tools";
import { resolveChatModel } from "../agent/gateway";
import { isRetryableModelError } from "../ai/routing";
import type { ChatMessage, ChatResult } from "../ai/workers-ai";
import type { SpecialistQuota } from "../agent/subagents/quota";

export type AgenticAction = {
  tool: string;
  ok: boolean;
  summary: string;
};

export type SubagentReport = {
  role: string;
  model?: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
  skipped?: boolean;
};

export type AgenticResult = ChatResult & {
  actions: AgenticAction[];
  subagents: SubagentReport[];
};

function summarizeResult(name: string, value: unknown): AgenticAction {
  const rec =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const ok = rec?.ok === true;
  let summary: string;
  if (!rec) {
    summary = String(value ?? "").slice(0, 160);
  } else if (typeof rec.error === "string" && rec.error) {
    summary = rec.error.slice(0, 160);
  } else if (typeof rec.text === "string" && rec.text) {
    summary = rec.text.slice(0, 160);
  } else if (typeof rec.summary === "string" && rec.summary) {
    summary = rec.summary.slice(0, 160);
  } else {
    summary = ok ? "ok" : "done";
  }
  return { tool: name, ok, summary };
}

export async function runAgenticChat(
  env: Env,
  opts: {
    system: string;
    messages: ChatMessage[];
    maxSteps?: number;
    temperature?: number;
    maxTokens?: number;
    model?: string;
    /** axis = looksActionable; full = orchestrate. */
    catalog?: AgentToolsCatalog;
    allowSpawn?: boolean;
    quota?: SpecialistQuota;
  }
): Promise<AgenticResult> {
  const started = Date.now();
  const catalog = opts.catalog ?? "full";
  const tools = createAgentTools(env, {
    catalog,
    allowSpawn: opts.allowSpawn === true && catalog === "full",
    quota: opts.quota,
  });
  const stepCap = catalog === "full" && opts.allowSpawn ? 12 : 8;
  const run = async (useFallback: boolean) => {
    const { model, modelId, providerOptions } = resolveChatModel(env, {
      fallback: useFallback,
      model: opts.model,
    });
    const result = await generateText({
      model,
      system: opts.system,
      messages: opts.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      tools,
      ...(providerOptions ? { providerOptions } : {}),
      stopWhen: stepCountIs(
        Math.max(1, Math.min(opts.maxSteps ?? 4, stepCap))
      ),
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
    });
    return { result, modelId };
  };

  let packed: Awaited<ReturnType<typeof run>>;
  try {
    packed = await run(false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isRetryableModelError(msg, { source: "workers-ai" })) {
      packed = await run(true);
    } else {
      throw e;
    }
  }
  const { result, modelId } = packed;
  const actions: AgenticAction[] = [];
  const subagents: SubagentReport[] = [];
  const calls = (result as { toolCalls?: unknown }).toolCalls;
  const results = (result as { toolResults?: unknown }).toolResults;
  if (Array.isArray(results)) {
    for (const tr of results) {
      const r = tr as { toolName?: unknown; result?: unknown };
      const name =
        typeof r.toolName === "string" && r.toolName ? r.toolName : "unknown";
      actions.push(summarizeResult(name, r.result));
      if (name === "subagent_spawn" && r.result && typeof r.result === "object") {
        const rec = r.result as Record<string, unknown>;
        subagents.push({
          role: String(rec.role || "dynamic"),
          model: rec.model != null ? String(rec.model) : undefined,
          ok: rec.ok === true,
          latency_ms:
            typeof rec.latency_ms === "number" ? rec.latency_ms : 0,
          error: typeof rec.error === "string" ? rec.error : undefined,
          skipped: rec.skipped === true,
        });
      }
    }
  } else if (Array.isArray(calls)) {
    for (const tc of calls) {
      const c = tc as { toolName?: unknown };
      const name =
        typeof c.toolName === "string" && c.toolName ? c.toolName : "unknown";
      actions.push({ tool: name, ok: true, summary: "called" });
    }
  }
  return {
    text: result.text,
    model: modelId,
    latencyMs: Date.now() - started,
    actions,
    subagents,
  };
}
