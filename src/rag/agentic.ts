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
import { createAgentTools } from "../agent/tools";
import { resolveChatModel } from "../agent/gateway";
import type { ChatMessage, ChatResult } from "../ai/workers-ai";

export type AgenticAction = {
  tool: string;
  ok: boolean;
  summary: string;
};

export type AgenticResult = ChatResult & {
  actions: AgenticAction[];
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
  }
): Promise<AgenticResult> {
  const started = Date.now();
  const tools = createAgentTools(env);
  const { model, modelId } = resolveChatModel(env, { fallback: false });
  void modelId;
  const result = await generateText({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    system: opts.system,
    messages: opts.messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    tools,
    stopWhen: stepCountIs(Math.max(1, Math.min(opts.maxSteps ?? 4, 6))),
    temperature: opts.temperature,
    maxOutputTokens: opts.maxTokens,
  });
  const actions: AgenticAction[] = [];
  const calls = (result as { toolCalls?: unknown }).toolCalls;
  const results = (result as { toolResults?: unknown }).toolResults;
  if (Array.isArray(results)) {
    for (const tr of results) {
      const r = tr as { toolName?: unknown; result?: unknown };
      const name =
        typeof r.toolName === "string" && r.toolName ? r.toolName : "unknown";
      actions.push(summarizeResult(name, r.result));
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
  };
}
