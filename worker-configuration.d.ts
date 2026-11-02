// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal Env typings for pyne-agent-worker.
// Prefer regenerating with `npx wrangler types` after binding changes.

/** AI Search instance surface used by knowledge search (subset). */
interface AiSearchInstance {
  search(opts: {
    messages: Array<{ role: string; content: string }>;
    max_num_results?: number;
  }): Promise<unknown>;
}

interface AiSearchNamespace {
  get(id: string): AiSearchInstance;
  create?(opts: { id: string; [k: string]: unknown }): Promise<AiSearchInstance>;
}

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  KB: R2Bucket;
  DB: D1Database;
  ASSETS?: Fetcher;

  /** Managed hybrid RAG (optional; Vectorize is the fallback). */
  AI_SEARCH?: AiSearchNamespace;

  /** Agents SDK Durable Object namespaces */
  PyneAgent: DurableObjectNamespace;
  PyneMcp: DurableObjectNamespace;

  /** Optional service binding to sister pyne-worker (POST /run). */
  PYNE_SERVICE?: Fetcher;

  /** Shared API secret (wrangler secret). Empty = open local mode. */
  API_KEY?: string;
  /** API key for HTTP pyne-worker when not using service binding. */
  PYNE_WORKER_API_KEY?: string;

  SERVICE_NAME: string;
  SERVICE_VERSION: string;
  CHAT_MODEL: string;
  /** Optional smaller/faster model when primary fails. */
  CHAT_MODEL_FALLBACK?: string;
  EMBED_MODEL: string;
  RAG_TOP_K: string;
  CORPUS_MAX_SCRIPTS: string;
  ALLOWED_ORIGINS: string;
  /** Optional Cloudflare AI Gateway id for attribution / caching. */
  AI_GATEWAY_ID?: string;
  /** HTTPS origin of pyne-worker when service binding is unavailable. */
  PYNE_WORKER_URL?: string;
  /** Named PYNE host: auto | pro | local | worker | container | none */
  PYNE_BACKEND?: string;
  PYNE_PRO_URL?: string;
  PYNE_PRO_API_KEY?: string;
  PYNE_LOCAL_URL?: string;
  PYNE_LOCAL_API_KEY?: string;
  PYNE_CONTAINER_URL?: string;
  PYNE_CONTAINER_API_KEY?: string;
  PYNE_CONTAINER_INSTANCE?: string;
  /** Allow loopback/RFC1918 PYNE URLs (wrangler dev). Default false. */
  PYNE_ALLOW_PRIVATE_URLS?: string;
  /** AXIS MCP endpoint for deep app control, e.g. https://worker.axis.hoox.sh/mcp */
  AXIS_MCP_URL?: string;
  /** SaaS console base URL for the tenant verify / usage path. */
  CONSOLE_URL?: string;
  /**
   * Optional service Bearer for `POST {CONSOLE_URL}/api/v1/usage`.
   * Falls back to the per-request tenant key hash (hash-on-wire either way).
   */
  USAGE_SERVICE_KEY?: string;
  /** KV cache for live tenant verify (key hash → plan/scopes/limits, 60s TTL). */
  TENANT_KEYS?: KVNamespace;
  /**
   * Self-host fail-open opt-in: when set equal to API_KEY, console outages
   * degrade (X-Hoox-Verify: degraded) instead of 503. Never for tenant keys
   * unless the operator explicitly opted in.
   */
  HX_ALLOW_SELFHOST?: string;
  /** Bearer for the AXIS MCP endpoint (falls back to API_KEY). Set via secret. */
  AXIS_MCP_KEY?: string;
  /** Default true — run generate→validate→retry when pyne-worker is configured. */
  VALIDATE_DEFAULT?: string;
  /** Extra fix attempts after first validation failure (default 2). */
  VALIDATE_MAX_RETRIES?: string;
  /** Optional extra Workers AI™ model ids allowed on POST /v1/chat (comma-separated). */
  CHAT_MODELS?: string;
  /** pyne-worker validate timeout in ms (default 20000, max 60000). */
  PYNE_VALIDATE_TIMEOUT_MS?: string;

  FEATURE_GLM53?: string;
  FEATURE_SUBAGENTS?: string;
  FEATURE_PYNE_AST?: string;
  FEATURE_KB_384?: string;
  KB_FALLBACK_V1?: string;
  FEATURE_RERANK?: string;
  REASONING_EFFORT?: string;
  /** Comma list: parse,lint,eval */
  VALIDATE_STAGES?: string;
  /** Total agents including orchestrator (default 6 → max 5 specialists). */
  MAX_SUBAGENTS?: string;
  /** In-flight specialist generateText cap (default 3). */
  SUBAGENT_CONCURRENCY?: string;
  CUSTOM_MODEL_ENDPOINT?: string;
  CUSTOM_MODEL_API_KEY?: string;
  CUSTOM_MODEL_NAME?: string;
  MODEL_PARSER?: string;
  MODEL_VALIDATOR?: string;
  MODEL_OPTIMIZER?: string;
  MODEL_DOCS?: string;
  MODEL_AXIS?: string;
  MODEL_DYNAMIC?: string;
  EMBED_MODEL_V2?: string;
  EMBED_POOLING?: string;
  EMBED_POOLING_V2?: string;
  /** Optional 384-d Vectorize binding (PR 7). */
  VECTORIZE_V2?: VectorizeIndex;
}
