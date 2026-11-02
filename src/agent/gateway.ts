// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWorkersAI } from "workers-ai-provider";
import {
  MODEL_CUSTOM,
  activeEmbedIdentity,
  effectiveChatFallback,
  reasoningEffortFor,
  resolveCustomLanguageModel,
  resolveRequestedModel,
} from "../ai/routing";

/**
 * Resolve a Workers AI (or BYOM) language model for the AI SDK.
 * Primary: env.CHAT_MODEL (FEATURE_GLM53 may promote default Qwen → GLM-5.3).
 * Fallback: env.CHAT_MODEL_FALLBACK for timeouts / overloaded GPU.
 */
export function resolveChatModel(
  env: Env,
  opts?: { fallback?: boolean; model?: string }
): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  modelId: string;
  viaGateway: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerOptions?: Record<string, any>;
} {
  const primary = resolveRequestedModel(env, opts?.model);
  const fallbackId = effectiveChatFallback(env);
  const modelId = opts?.fallback ? fallbackId : primary;
  const viaGateway = Boolean((env.AI_GATEWAY_ID || "").trim());

  if (modelId === MODEL_CUSTOM) {
    const custom = resolveCustomLanguageModel(env);
    if (!custom) {
      // Fall through to Workers AI primary if BYOM misconfigured.
      const workersai = createWorkersAI({ binding: env.AI });
      const id = resolveRequestedModel(env, undefined);
      return {
        model: workersai(id as Parameters<typeof workersai>[0]),
        modelId: id,
        viaGateway,
      };
    }
    return {
      model: custom.model,
      modelId: custom.modelId,
      viaGateway: false,
    };
  }

  const workersai = createWorkersAI({ binding: env.AI });
  const model = workersai(modelId as Parameters<typeof workersai>[0]);
  const effort = reasoningEffortFor(env, modelId, "sdk");
  const providerOptions = effort
    ? { "workers-ai": { reasoning_effort: effort } }
    : undefined;

  return { model, modelId, viaGateway, providerOptions };
}

/** Simple in-memory edge cache for identical RAG queries (per isolate). */
const ragCache = new Map<string, { at: number; value: string }>();
const RAG_TTL_MS = 5 * 60_000;
const RAG_MAX = 64;

/** Cache key must include embed identity so 384-d / 768-d never collide. */
export function ragCacheKey(env: Env, query: string, topK: number): string {
  const id = activeEmbedIdentity(env);
  return `rag:${id.id}:${id.model}:${id.dimensions}:${id.pooling}:${topK}:${query.toLowerCase()}`;
}

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
    const first = ragCache.keys().next().value;
    if (first) ragCache.delete(first);
  }
  ragCache.set(key, { at: Date.now(), value });
}
