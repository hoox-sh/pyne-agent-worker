// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal Env typings for pyne-agent-worker.
// Prefer regenerating with `npx wrangler types` after binding changes.

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  KB: R2Bucket;
  DB: D1Database;
  ASSETS?: Fetcher;

  /** Optional service binding to sister pyne-worker (POST /run). */
  PYNE_SERVICE?: Fetcher;

  /** Shared API secret (wrangler secret). Empty = open local mode. */
  API_KEY?: string;
  /** API key for HTTP pyne-worker when not using service binding. */
  PYNE_WORKER_API_KEY?: string;

  SERVICE_NAME: string;
  SERVICE_VERSION: string;
  CHAT_MODEL: string;
  EMBED_MODEL: string;
  RAG_TOP_K: string;
  CORPUS_MAX_SCRIPTS: string;
  ALLOWED_ORIGINS: string;
  /** HTTPS origin of pyne-worker when service binding is unavailable. */
  PYNE_WORKER_URL?: string;
  /** Default true — run generate→validate→retry when pyne-worker is configured. */
  VALIDATE_DEFAULT?: string;
  /** Extra fix attempts after first validation failure (default 2). */
  VALIDATE_MAX_RETRIES?: string;
}
