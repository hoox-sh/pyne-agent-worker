// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from "../lib/json";
import { DISCLAIMER_SHORT, MARKS } from "../lib/legal";
import { SERVICE_VERSION } from "../lib/version";
import { embedModel } from "../ai/models";
import {
  activeEmbedIdentity,
  effectiveChatFallback,
  effectiveChatModel,
  embedIdentityV1,
  envReasoningEffort,
  featureFlag,
  featureGlm53,
  featureKb384,
  featurePyneAst,
  featureSubagents,
} from "../ai/routing";
import { isValidateAvailable } from "../lib/pyne-worker";
import { isAxisMcpConfigured } from "../axis/mcp-client";
import {
  isAnyValidateAvailable,
  parseValidateStages,
} from "../rag/validate-loop";
import {
  anyPyneEvalConfigured,
  inventoryPyneBackends,
  workerHostConfigured,
} from "../lib/pyne-backend";
import {
  concurrencyFromEnv,
  maxSpecialistsFromEnv,
} from "../agent/subagents/quota";

/**
 * Health for standalone + HOOX modes.
 *
 * Minimum for ok=true: Workers AI™ only.
 * Vectorize / R2 / D1 / pyne-worker are optional enhancements.
 */
export async function handleHealth(env: Env): Promise<Response> {
  const checks: Record<string, string> = {
    ai: env.AI ? "ok" : "missing",
    vectorize: env.VECTORIZE ? "ok" : "optional_missing",
    vectorize_v2: env.VECTORIZE_V2 ? "ok" : "optional_not_configured",
    ai_search: env.AI_SEARCH ? "ok" : "optional_missing",
    r2: env.KB ? "ok" : "optional_missing",
    d1: env.DB ? "ok" : "optional_missing",
    agents_do: env.PyneAgent ? "ok" : "optional_missing",
    mcp_do: env.PyneMcp ? "ok" : "optional_missing",
    pyne_worker: isValidateAvailable(env)
      ? env.PYNE_SERVICE
        ? "service_binding"
        : "http"
      : "optional_not_configured",
    axis_mcp: isAxisMcpConfigured(env) ? "configured" : "optional_not_configured",
  };

  // Lightweight D1 ping (non-fatal)
  if (env.DB) {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      checks.d1 = "ok";
    } catch {
      checks.d1 = "error";
    }
  }

  const pyneBackends = inventoryPyneBackends(env);
  const mode = anyPyneEvalConfigured(env)
    ? "hoox"
    : isAxisMcpConfigured(env)
      ? "axis"
      : "standalone";
  // Standalone: AI is enough. RAG/sessions degrade gracefully.
  const healthy = checks.ai === "ok";

  return json(
    {
      ok: healthy,
      mode,
      service: env.SERVICE_NAME || "pyne-agent-worker",
      version: env.SERVICE_VERSION || SERVICE_VERSION,
      checks,
      surfaces: {
        rest_chat: "POST /v1/chat",
        agents_sdk: "WS /agents/pyne-agent/:session",
        mcp: "POST /mcp",
        plugin: "GET /plugin/axis-pine-agent.js",
      },
      models: {
        chat: effectiveChatModel(env),
        fallback: effectiveChatFallback(env),
        embed: embedModel(env),
        reasoning_effort: envReasoningEffort(env),
        ai_gateway: (env.AI_GATEWAY_ID || "").trim() || null,
      },
      features: {
        glm53: featureGlm53(env),
        subagents: featureSubagents(env),
        pyne_ast: {
          flag: featurePyneAst(env),
          worker_bound: workerHostConfigured(env),
        },
        kb_384: featureKb384(env),
        kb_fallback_v1: featureFlag(env, "KB_FALLBACK_V1"),
      },
      indexes: {
        // Binding presence for v2 dims (feature flag gates *use*, not inventory).
        v1: embedIdentityV1(env).dimensions,
        v2: env.VECTORIZE_V2 ? 384 : "unbound",
        active: activeEmbedIdentity(env).id,
        active_model: activeEmbedIdentity(env).model,
        active_pooling: activeEmbedIdentity(env).pooling,
      },
      subagents: {
        enabled: featureSubagents(env),
        max_specialists: maxSpecialistsFromEnv(env),
        concurrency: concurrencyFromEnv(env),
        note: "MCP never exposes subagent_spawn in 0.4.0",
      },
      pyne_backends: pyneBackends,
      validation: {
        // Requested by default, but auto-skipped when no backend is present.
        default: (env.VALIDATE_DEFAULT || "true").toLowerCase() !== "false",
        max_retries: Number(env.VALIDATE_MAX_RETRIES || "2"),
        stages: parseValidateStages(env),
        available: isAnyValidateAvailable(env),
        pyne_worker: checks.pyne_worker,
        axis_mcp: checks.axis_mcp,
        // No synchronous /ast/* probe — would block health on PYNE timeouts.
        note: anyPyneEvalConfigured(env)
          ? "generate → staged parse/lint/eval → retry enabled"
          : isAxisMcpConfigured(env)
            ? "generate → AXIS MCP axis_run validate → retry enabled"
            : "standalone: no validation backend configured; chat works without validate loop",
      },
      marks: {
        pine: MARKS.pine,
        tradingView: MARKS.tradingView,
        cloudflare: MARKS.cloudflare,
      },
      disclaimer: DISCLAIMER_SHORT,
    },
    { status: healthy ? 200 : 503 }
  );
}
