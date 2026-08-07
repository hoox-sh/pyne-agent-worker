// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from "../lib/json";
import { DISCLAIMER_SHORT, MARKS } from "../lib/legal";
import { chatModel, embedModel } from "../ai/models";
import { isValidateAvailable } from "../lib/pyne-worker";

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
    r2: env.KB ? "ok" : "optional_missing",
    d1: env.DB ? "ok" : "optional_missing",
    pyne_worker: isValidateAvailable(env)
      ? env.PYNE_SERVICE
        ? "service_binding"
        : "http"
      : "optional_not_configured",
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

  const mode = isValidateAvailable(env) ? "hoox" : "standalone";
  // Standalone: AI is enough. RAG/sessions degrade gracefully.
  const healthy = checks.ai === "ok";

  return json(
    {
      ok: healthy,
      mode,
      service: env.SERVICE_NAME || "pyne-agent-worker",
      version: env.SERVICE_VERSION || "0.1.2",
      checks,
      models: {
        chat: chatModel(env),
        embed: embedModel(env),
      },
      validation: {
        // Requested by default, but auto-skipped when pyne-worker is absent.
        default: (env.VALIDATE_DEFAULT || "true").toLowerCase() !== "false",
        max_retries: Number(env.VALIDATE_MAX_RETRIES || "2"),
        available: isValidateAvailable(env),
        pyne_worker: checks.pyne_worker,
        note: isValidateAvailable(env)
          ? "generate → pyne-worker validate → retry enabled"
          : "standalone: pyne-worker not configured; chat works without validate loop",
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
