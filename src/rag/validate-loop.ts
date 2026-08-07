// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * generate → pyne-worker validate → retry loop for Pine Script™ chat.
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
  /** Extra retries after first failure (default 2 → up to 3 generates) */
  maxRetries?: number;
  validateMode?: "interpret" | "compile" | "auto";
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

function buildFixUserMessage(
  previousPine: string,
  validation: ValidateResult
): string {
  const err = formatValidateError(validation);
  return [
    "The previous Pine Script™ failed validation on the PYNE edge host (pyne-worker).",
    "Fix the script so it parses and runs. Keep the same intent.",
    "",
    "## pyne-worker error",
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
  if (!validation || validation.skipped) return text;
  const status = validation.ok
    ? `validated OK on pyne-worker after ${attempts} attempt(s)`
    : `still failing pyne-worker after ${attempts} attempt(s): ${formatValidateError(validation)}`;
  if (text.includes("pyne-worker")) return text;
  return `${text.trim()}\n\n_Validation: ${status}._`;
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
  const validateFn = opts.validateFn || validateOnPyneWorker;
  const wantValidate =
    opts.validate !== false &&
    (opts.validateFn
      ? true
      : isValidateAvailable(opts.env));

  const messages: ChatMessage[] = [...opts.messages];
  const attempts: AttemptRecord[] = [];
  let last: ChatResult | null = null;
  let lastPine: string | null = null;
  let lastValidation: ValidateResult | null = null;
  let totalLatency = 0;

  const maxAttempts = wantValidate ? maxRetries + 1 : 1;

  for (let i = 0; i < maxAttempts; i++) {
    const result = await chatFn(opts.env, messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      model: opts.model,
    });
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
    } else if (wantValidate && !pine) {
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

    // Success paths
    if (!wantValidate) break;
    if (validation?.ok) break;
    if (validation?.skipped) break;

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
