// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Optional client for sister pyne-worker evaluate host (POST /run).
 *
 * The agent is fully usable **without** pyne-worker / HOOX:
 * when neither PYNE_SERVICE nor PYNE_WORKER_URL is set, validation is skipped
 * and chat still returns Pine Script™ from Workers AI™ + RAG.
 *
 * Prefer service binding PYNE_SERVICE; fall back to PYNE_WORKER_URL + key.
 */

import { syntheticBars } from "./synthetic-bars";
import { pynePostJson } from "./pyne-http";

export type ValidateResult = {
  ok: boolean;
  skipped?: boolean;
  /** Which backend produced this result (`pyne-worker` | `axis-mcp` | …). */
  backend?: string;
  /** Stage that failed or completed: parse | lint | eval */
  stage?: string;
  reason?: string;
  status?: number;
  error?: string;
  error_kind?: string;
  error_type?: string;
  error_bar?: number;
  line?: number;
  column?: number;
  mode?: string;
  bars?: number;
  latency_ms: number;
  /** When false, the generate→validate loop must not retry (infra / auth / timeout). */
  retryable?: boolean;
  /** Raw subset for debugging (no full plots) */
  raw?: Record<string, unknown>;
};

export type ValidateOpts = {
  script: string;
  mode?: "interpret" | "compile" | "auto";
  symbol?: string;
  /** Inject custom bars; default synthetic fixture */
  ohlcv?: ReturnType<typeof syntheticBars>;
};

function workerConfigured(env: Env): boolean {
  return Boolean(env.PYNE_SERVICE || (env.PYNE_WORKER_URL || "").trim());
}

export function isValidateAvailable(env: Env): boolean {
  return workerConfigured(env);
}

async function postRun(
  env: Env,
  body: Record<string, unknown>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  const key = (env.PYNE_WORKER_API_KEY || env.API_KEY || "").trim();
  if (key) headers["X-API-Key"] = key;
  const base = (env.PYNE_WORKER_URL || "").replace(/\/$/, "");
  return pynePostJson({
    env,
    service: env.PYNE_SERVICE,
    url: env.PYNE_SERVICE ? undefined : `${base}/run`,
    body,
    headers,
  });
}

/**
 * Validate Pine Script™ by running it on pyne-worker with synthetic bars.
 * Returns skipped if no binding/URL is configured.
 */
export async function validateOnPyneWorker(
  env: Env,
  opts: ValidateOpts
): Promise<ValidateResult> {
  const started = Date.now();
  if (!workerConfigured(env)) {
    return {
      ok: false,
      skipped: true,
      backend: "pyne-worker",
      reason: "pyne-worker not configured (set PYNE_SERVICE or PYNE_WORKER_URL)",
      latency_ms: Date.now() - started,
    };
  }

  const script = opts.script.trim();
  if (!script) {
    return {
      ok: false,
      backend: "pyne-worker",
      error: "empty script",
      latency_ms: Date.now() - started,
    };
  }

  const mode = opts.mode || "interpret";
  const ohlcv = opts.ohlcv || syntheticBars(64);

  try {
    const { status, data } = await postRun(env, {
      script,
      ohlcv,
      mode,
      symbol: opts.symbol || "SYNTH",
      timeframe: "1m",
    });

    const latency_ms = Date.now() - started;
    if (status >= 200 && status < 300 && !data.error) {
      return {
        ok: true,
        backend: "pyne-worker",
        status,
        mode: data.mode != null ? String(data.mode) : mode,
        bars: typeof data.bars === "number" ? data.bars : ohlcv.length,
        latency_ms,
        raw: {
          script_id: data.script_id,
          run_id: data.run_id,
          events: Array.isArray(data.events) ? data.events.length : 0,
        },
      };
    }

    const errorKind =
      data.error_kind != null ? String(data.error_kind) : undefined;
    const errorType =
      data.error_type != null ? String(data.error_type) : undefined;
    const scriptError = Boolean(errorKind || errorType || data.error_bar != null);
    const infra =
      (status === 401 || status === 403 || status >= 500) && !scriptError;

    return {
      ok: false,
      backend: "pyne-worker",
      skipped: infra,
      retryable: infra ? false : undefined,
      status,
      error: String(data.error || `pyne-worker HTTP ${status}`),
      reason: infra ? `pyne-worker HTTP ${status} (not a script error)` : undefined,
      error_kind: errorKind,
      error_type: errorType,
      error_bar:
        typeof data.error_bar === "number" ? data.error_bar : undefined,
      mode,
      latency_ms,
      raw: {
        error_kind: data.error_kind,
        error_type: data.error_type,
        error_bar: data.error_bar,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timeout = /abort|timeout/i.test(msg);
    return {
      ok: false,
      skipped: true,
      retryable: false,
      backend: "pyne-worker",
      error: msg,
      reason: timeout
        ? `pyne-worker timeout`
        : `pyne-worker transport: ${msg}`,
      latency_ms: Date.now() - started,
    };
  }
}

/** Compact error string for the model fix prompt. */
export function formatValidateError(v: ValidateResult): string {
  if (v.skipped) return v.reason || "validation skipped";
  if (v.ok) return "ok";
  const parts = [v.error || "unknown error"];
  if (v.error_kind) parts.push(`kind=${v.error_kind}`);
  if (v.error_type) parts.push(`type=${v.error_type}`);
  if (v.error_bar != null) parts.push(`bar=${v.error_bar}`);
  if (v.status) parts.push(`http=${v.status}`);
  return parts.join(" | ");
}
