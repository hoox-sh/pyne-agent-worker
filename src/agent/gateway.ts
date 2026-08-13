// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWorkersAI } from "workers-ai-provider";
import { chatModel } from "../ai/models";

/**
 * Resolve a Workers AI language model for the AI SDK.
 * When AI_GATEWAY_ID is set, traffic can be attributed/cached via AI Gateway
 * (Workers AI binding still powers inference; gateway id is recorded for ops).
 *
 * Primary model: env.CHAT_MODEL (default coder model).
 * Fallback model: env.CHAT_MODEL_FALLBACK for timeouts / overloaded GPU.
 */
export function resolveChatModel(
  env: Env,
  opts?: { fallback?: boolean }
): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  modelId: string;
  viaGateway: boolean;
} {
  const workersai = createWorkersAI({ binding: env.AI });
  const primary = chatModel(env);
  const fallbackId =
    (env.CHAT_MODEL_FALLBACK || "").trim() ||
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const modelId = opts?.fallback ? fallbackId : primary;
  const viaGateway = Boolean((env.AI_GATEWAY_ID || "").trim());

  // workers-ai-provider v4: callable provider returns a LanguageModel
  const model = workersai(modelId as Parameters<typeof workersai>[0]);

  return { model, modelId, viaGateway };
}

/** Simple in-memory edge cache key for identical RAG queries (per isolate). */
const ragCache = new Map<string, { at: number; value: string }>();
const RAG_TTL_MS = 5 * 60_000;
const RAG_MAX = 64;

export function cacheGet(key: string): string | null {
  const hit = ragCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RAG_TTL_MS) {
    ragCache.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key: string, value: string): void {
  if (ragCache.size >= RAG_MAX) {
    // drop oldest
    const first = ragCache.keys().next().value;
    if (first) ragCache.delete(first);
  }
  ragCache.set(key, { at: Date.now(), value });
}
