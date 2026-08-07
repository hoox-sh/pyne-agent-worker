// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from "../lib/json";
import { DISCLAIMER_SHORT, MARKS } from "../lib/legal";
import { chatModel, embedModel } from "../ai/models";
import { isValidateAvailable } from "../lib/pyne-worker";

export async function handleHealth(env: Env): Promise<Response> {
  const checks: Record<string, string> = {
    ai: env.AI ? "ok" : "missing",
    vectorize: env.VECTORIZE ? "ok" : "missing",
    r2: env.KB ? "ok" : "missing",
    d1: env.DB ? "ok" : "missing",
    pyne_worker: isValidateAvailable(env)
      ? env.PYNE_SERVICE
        ? "service_binding"
        : "http"
      : "not_configured",
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

  const healthy = checks.ai === "ok" && checks.vectorize === "ok";

  return json(
    {
      ok: healthy,
      service: env.SERVICE_NAME || "pyne-agent-worker",
      version: env.SERVICE_VERSION || "0.1.0",
      checks,
      models: {
        chat: chatModel(env),
        embed: embedModel(env),
      },
      validation: {
        default: (env.VALIDATE_DEFAULT || "true").toLowerCase() !== "false",
        max_retries: Number(env.VALIDATE_MAX_RETRIES || "2"),
        pyne_worker: checks.pyne_worker,
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
