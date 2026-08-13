// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stateful PYNE chat agent — Cloudflare Agents SDK + AIChatAgent.
 *
 * - SQLite-backed message persistence (new_sqlite_classes)
 * - WebSocket streaming via AIChatAgent protocol
 * - Tools: knowledge search, pine lint, AXIS chart layout
 * - Per-instance isolation: route by session name so users do not share state
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type GenerateTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { createAgentTools } from "./tools";
import { buildAgentSystemPrompt, looksOffTopic } from "./prompts-v6";
import { resolveChatModel } from "./gateway";

export type PyneAgentState = {
  pineVersion: "v5" | "v6" | "auto";
  style: "indicator" | "strategy" | "library" | "auto";
  turnCount: number;
};

export class PyneAgent extends AIChatAgent<Env, PyneAgentState> {
  /** Cap stored turns to keep SQLite rows small. */
  override maxPersistedMessages = 80;

  /** Queue concurrent user messages (safe for single-writer DO). */
  override messageConcurrency = "queue" as const;

  initialState: PyneAgentState = {
    pineVersion: "auto",
    style: "auto",
    turnCount: 0,
  };

  /**
   * Optional: validate client-driven state patches.
   */
  override validateStateChange(
    next: PyneAgentState,
    _source: unknown
  ): void {
    const allowedVer = new Set(["v5", "v6", "auto"]);
    const allowedStyle = new Set(["indicator", "strategy", "library", "auto"]);
    if (!allowedVer.has(next.pineVersion)) {
      throw new Error("invalid pineVersion");
    }
    if (!allowedStyle.has(next.style)) {
      throw new Error("invalid style");
    }
    if (!Number.isFinite(next.turnCount) || next.turnCount < 0) {
      throw new Error("invalid turnCount");
    }
  }

  async onChatMessage(
    onFinish: GenerateTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ): Promise<Response | undefined> {
    const lastUser = [...this.messages]
      .reverse()
      .find((m) => m.role === "user");
    const lastText = extractText(lastUser);

    if (lastText && looksOffTopic(lastText)) {
      // Guardrail: refuse off-topic without spending GPU on tools
      const body = [
        "I only help with Pine Script™ / PYNE trading scripts, chart layout,",
        "and AXIS integration. Please rephrase as a trading-script request.",
      ].join(" ");
      return new Response(body, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    this.setState({
      ...this.state,
      turnCount: (this.state.turnCount || 0) + 1,
    });

    const tools = createAgentTools(this.env);
    const system = buildAgentSystemPrompt({
      pineVersion: this.state.pineVersion,
      style: this.state.style,
    });

    const run = async (useFallback: boolean) => {
      const { model, modelId } = resolveChatModel(this.env, {
        fallback: useFallback,
      });
      const result = streamText({
        model,
        system,
        messages: await convertToModelMessages(this.messages),
        tools,
        // Allow tool → model → tool loop for search + validate
        stopWhen: stepCountIs(6),
        abortSignal: options?.abortSignal,
        onFinish: async (event) => {
          // Attach model id for observability (Workers logs)
          console.log(
            JSON.stringify({
              type: "pyne_agent_finish",
              modelId,
              viaGateway: Boolean(this.env.AI_GATEWAY_ID),
              instance: this.name,
              finishReason: event.finishReason,
            })
          );
          await onFinish(event);
        },
      });
      return result.toUIMessageStreamResponse();
    };

    try {
      return await run(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Model timeout / overload → smaller fallback once
      if (/timeout|overloaded|capacity|503|429/i.test(msg)) {
        try {
          return await run(true);
        } catch (err2) {
          const m2 = err2 instanceof Error ? err2.message : String(err2);
          return new Response(`Agent error (fallback failed): ${m2}`, {
            status: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      }
      return new Response(`Agent error: ${msg}`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }
}

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { content?: unknown; parts?: unknown };
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.parts)) {
    return m.parts
      .map((p) => {
        if (p && typeof p === "object" && "text" in p) {
          return String((p as { text?: string }).text || "");
        }
        return "";
      })
      .join("");
  }
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "text" in p) {
          return String((p as { text?: string }).text || "");
        }
        return "";
      })
      .join("");
  }
  return "";
}
