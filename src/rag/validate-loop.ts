// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * generate → (optional) validate → retry loop for Pine Script™ chat.
 *
 * Validation backends, in preference order:
 * 1. pyne-worker (`PYNE_SERVICE` / `PYNE_WORKER_URL`) — dedicated evaluator
 * 2. AXIS MCP (`AXIS_MCP_URL` → `axis_run`) — runs on the AXIS Worker
 * Without either, this is a single generate pass (standalone mode).
 */

import {
  chatComplete,
  type ChatMessage,
  type ChatResult,
} from "../ai/workers-ai";
import {
  formatValidateError,
  isValidateAvailable,
  validateOnPyneWorker,
  type ValidateResult,
} from "../lib/pyne-worker";
import { isAxisMcpConfigured, validateOnAxisMcp } from "../axis/mcp-client";
import { extractPineBlock } from "./prompts";

export type AttemptRecord = {
  attempt: number;
  model: string;
  latency_ms: number;
  pine: string | null;
  validation: ValidateResult | null;
};

export type ChatFn = (
  env: Env,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; model?: string }
) => Promise<ChatResult>;

export type ValidateFn = (
  env: Env,
  opts: { script: string; mode?: "interpret" | "compile" | "auto" }
) => Promise<ValidateResult>;

export type ValidateLoopOpts = {
  env: Env;
  /** Initial messages including system + user (RAG-augmented) */
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /** When false, single generate only */
  validate?: boolean;
  /** When false, a reply without a ```pine fence is not a validation failure (AXIS how-tos). */
  requirePine?: boolean;
  /** Extra retries after first failure (default 2 → up to 3 generates) */
  maxRetries?: number;
  validateMode?: "interpret" | "compile" | "auto";
  /**
   * Prefetched first attempt (e.g. from the agentic tool loop). Counts as
   * attempt 1: pine is extracted and validated, retries continue via chatFn.
   */
  seedResult?: ChatResult | null;
  /** Test injectables */
  chatFn?: ChatFn;
  validateFn?: ValidateFn;
};

export type ValidateLoopResult = {
  text: string;
  pine: string | null;
  model: string;
  latency_ms: number;
  attempts: AttemptRecord[];
  validation: ValidateResult | null;
  validated: boolean;
  retries: number;
};

function backendLabel(v: ValidateResult | null): string {
  return v?.backend || "pyne-worker";
}

function buildFixUserMessage(
  previousPine: string,
  validation: ValidateResult
): string {
  const backend = backendLabel(validation);
  const err = formatValidateError(validation);
  return [
    `The previous Pine Script™ failed validation on ${backend}.`,
    "Fix the script so it parses and runs. Keep the same intent.",
    "",
    `## ${backend} error`,
    err,
    "",
    "## Previous script",
    "```pine",
    previousPine,
    "```",
    "",
    "Return a short note plus one complete fixed ```pine block.",
    "Do not claim TradingView® platform parity. Prefer PYNE/AXIS-safe APIs.",
  ].join("\n");
}

function appendValidationNote(
  text: string,
  validation: ValidateResult | null,
  attempts: number
): string {
  if (!validation) return text;
  // Quiet skip when no backend is configured at all (normal standalone).
  // But a *misconfigured* backend (present yet incapable) must surface once,
  // or the operator never learns why nothing validates.
  if (validation.skipped) {
    const reason = validation.reason || "";
    const quiet = /not configured/i.test(reason);
    if (!quiet && reason && !text.includes(reason.slice(0, 48))) {
      return `${text.trim()}\n\n_Note: ${reason}_`;
    }
    return text;
  }
  const backend = backendLabel(validation);
  const status = validation.ok
    ? `validated OK on ${backend} after ${attempts} attempt(s)`
    : `still failing ${backend} after ${attempts} attempt(s): ${formatValidateError(validation)}`;
  if (text.includes(backend)) return text;
  return `${text.trim()}\n\n_Validation: ${status}._`;
}

/** True when any validation backend (pyne-worker or AXIS MCP) is available. */
export function isAnyValidateAvailable(env: Env): boolean {
  return isValidateAvailable(env) || isAxisMcpConfigured(env);
}

/** Default validator: pyne-worker first, AXIS MCP second, skip-record last. */
function defaultValidateFn(env: Env): ValidateFn {
  if (isValidateAvailable(env)) return validateOnPyneWorker;
  if (isAxisMcpConfigured(env)) return validateOnAxisMcp;
  return validateOnPyneWorker; // returns skipped when unconfigured
}

/**
 * Generate Pine, optionally validate via pyne-worker, retry with fix prompts.
 */
export async function generateValidateRetry(
  opts: ValidateLoopOpts
): Promise<ValidateLoopResult> {
  const maxRetries = Math.max(
    0,
    Math.min(opts.maxRetries ?? 2, 5)
  );
  const chatFn = opts.chatFn || chatComplete;
  const validateFn = opts.validateFn || defaultValidateFn(opts.env);
  const wantValidate =
    opts.validate !== false &&
    (opts.validateFn
      ? true
      : isAnyValidateAvailable(opts.env));

  const messages: ChatMessage[] = [...opts.messages];
  const attempts: AttemptRecord[] = [];
  let last: ChatResult | null = null;
  let lastPine: string | null = null;
  let lastValidation: ValidateResult | null = null;
  let totalLatency = 0;

  const maxAttempts = wantValidate ? maxRetries + 1 : 1;

  for (let i = 0; i < maxAttempts; i++) {
    let result: ChatResult;
    if (i === 0 && opts.seedResult) {
      result = {
        text: opts.seedResult.text,
        model: opts.seedResult.model,
        latencyMs: opts.seedResult.latencyMs,
      };
    } else {
      result = await chatFn(opts.env, messages, {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        model: opts.model,
      });
    }
    last = result;
    totalLatency += result.latencyMs;
    const pine = extractPineBlock(result.text);
    lastPine = pine;

    let validation: ValidateResult | null = null;
    if (wantValidate && pine) {
      validation = await validateFn(opts.env, {
        script: pine,
        mode: opts.validateMode || "interpret",
      });
      lastValidation = validation;
    } else if (wantValidate && !pine && opts.requirePine !== false) {
      validation = {
        ok: false,
        error: "model reply contained no ```pine block",
        latency_ms: 0,
      };
      lastValidation = validation;
    }

    attempts.push({
      attempt: i + 1,
      model: result.model,
      latency_ms: result.latencyMs,
      pine,
      validation,
    });

    // Success / non-retryable (infra, auth, timeout, skipped backend)
    if (!wantValidate) break;
    if (validation?.ok) break;
    if (validation?.skipped) break;
    if (validation?.retryable === false) break;

    // Prepare retry
    if (i < maxAttempts - 1) {
      messages.push({ role: "assistant", content: result.text });
      const fixSource =
        pine ||
        "(no pine block — emit a full script this time)";
      messages.push({
        role: "user",
        content: pine
          ? buildFixUserMessage(fixSource, validation!)
          : [
              "Your reply had no fenced ```pine block.",
              "Output a complete Pine Script™ in one ```pine fence that satisfies the original request.",
            ].join("\n"),
      });
    }
  }

  const text = appendValidationNote(
    last?.text || "",
    lastValidation,
    attempts.length
  );

  return {
    text,
    pine: lastPine,
    model: last?.model || "",
    latency_ms: totalLatency,
    attempts,
    validation: lastValidation,
    validated: Boolean(lastValidation?.ok),
    retries: Math.max(0, attempts.length - 1),
  };
}
