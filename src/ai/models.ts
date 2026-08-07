// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Default Cloudflare® Workers AI™ models for code chat + embeddings. */
export const DEFAULT_CHAT_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
export const DEFAULT_EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

/** bge-base-en-v1.5 produces 768-dim vectors (must match Vectorize index). */
export const EMBED_DIMENSIONS = 768;

export function chatModel(env: Env): string {
  return (env.CHAT_MODEL || DEFAULT_CHAT_MODEL).trim() || DEFAULT_CHAT_MODEL;
}

export function embedModel(env: Env): string {
  return (env.EMBED_MODEL || DEFAULT_EMBED_MODEL).trim() || DEFAULT_EMBED_MODEL;
}

export function ragTopK(env: Env): number {
  const n = Number(env.RAG_TOP_K || "8");
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.min(Math.floor(n), 24);
}
