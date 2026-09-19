// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Default Cloudflare® Workers AI™ models for code chat + embeddings. */
export const DEFAULT_CHAT_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
export const DEFAULT_CHAT_FALLBACK = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEFAULT_EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

/** bge-base-en-v1.5 produces 768-dim vectors (must match Vectorize index). */
export const EMBED_DIMENSIONS = 768;

export function chatModel(env: Env): string {
  return (env.CHAT_MODEL || DEFAULT_CHAT_MODEL).trim() || DEFAULT_CHAT_MODEL;
}

export function chatFallbackModel(env: Env): string {
  return (
    (env.CHAT_MODEL_FALLBACK || "").trim() || DEFAULT_CHAT_FALLBACK
  );
}

export function embedModel(env: Env): string {
  return (env.EMBED_MODEL || DEFAULT_EMBED_MODEL).trim() || DEFAULT_EMBED_MODEL;
}

export function ragTopK(env: Env, requested?: number): number {
  const n =
    requested != null && Number.isFinite(requested)
      ? requested
      : Number(env.RAG_TOP_K || "8");
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.min(Math.floor(n), 24);
}

function extraChatModels(env: Env): string[] {
  return String(env.CHAT_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function allowedChatModels(env: Env): Set<string> {
  return new Set([
    chatModel(env),
    chatFallbackModel(env),
    DEFAULT_CHAT_MODEL,
    DEFAULT_CHAT_FALLBACK,
    ...extraChatModels(env),
  ]);
}

/** Honor a client model id only if it is on the allowlist. */
export function resolveRequestedModel(env: Env, requested?: string): string {
  const primary = chatModel(env);
  const id = (requested || "").trim();
  if (!id) return primary;
  return allowedChatModels(env).has(id) ? id : primary;
}

export function clampMaxTokens(n?: number): number {
  if (n == null || !Number.isFinite(n)) return 4096;
  return Math.max(256, Math.min(8192, Math.floor(n)));
}

export function clampTemperature(n?: number): number {
  if (n == null || !Number.isFinite(n)) return 0.2;
  return Math.max(0, Math.min(1.5, n));
}
