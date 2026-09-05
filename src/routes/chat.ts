// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChatMessage } from "../ai/workers-ai";
import { errorJson, json, readJson } from "../lib/json";
import { DISCLAIMER_SHORT, MARKS } from "../lib/legal";
import { isValidateAvailable } from "../lib/pyne-worker";
import {
  buildSystemPrompt,
  buildUserAugmentedMessage,
  wantsPineScript,
} from "../rag/prompts";
import { retrieve } from "../rag/retrieve";
import {
  appendMessage,
  createSession,
  getSession,
  listMessages,
} from "../rag/sessions";
import { generateValidateRetry } from "../rag/validate-loop";

export type ChatBody = {
  /** Natural language request */
  message?: string;
  /** Alias for message */
  prompt?: string;
  /** Existing session id (D1); creates one if omitted and D1 available */
  session_id?: string;
  /** Optional prior messages when not using D1 sessions */
  history?: ChatMessage[];
  /** Prefer //@version=5|6 */
  pine_version?: "v5" | "v6" | "auto";
  /** Prefer indicator | strategy | library */
  style?: "indicator" | "strategy" | "library" | "auto";
  /** Skip Vectorize retrieval (debug) */
  no_rag?: boolean;
  temperature?: number;
  max_tokens?: number;
  model?: string;
  /** Persist turn to D1 (default true when session used) */
  persist?: boolean;
  /**
   * Run generate → pyne-worker validate → retry (default true when pyne-worker configured).
   * Set false to skip validation.
   */
  validate?: boolean;
  /** Extra fix attempts after first failure (0–5, default 2) */
  max_retries?: number;
  /** pyne-worker mode for validation (default interpret) */
  validate_mode?: "interpret" | "compile" | "auto";
};

function parseMaxRetries(raw: unknown, envDefault: string | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(5, Math.floor(raw)));
  }
  const fromEnv = Number(envDefault ?? "2");
  if (Number.isFinite(fromEnv)) return Math.max(0, Math.min(5, Math.floor(fromEnv)));
  return 2;
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const parsed = await readJson<ChatBody>(request);
  if (!parsed.ok) return errorJson(400, parsed.error);

  const body = parsed.data || {};
  const userText = String(body.message || body.prompt || "").trim();
  if (!userText) {
    return errorJson(400, "message (or prompt) is required");
  }
  if (userText.length > 32_000) {
    return errorJson(413, "message too large (max 32k chars)");
  }

  let sessionId = body.session_id?.trim() || "";
  let history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];

  // Session path (D1) — optional; ignore failures if DB not provisioned.
  let useSessions = false;
  try {
    if (sessionId) {
      const s = await getSession(env, sessionId);
      if (!s) return errorJson(404, "session not found");
      useSessions = true;
      history = await listMessages(env, sessionId);
    } else if (body.persist !== false) {
      const s = await createSession(env, userText.slice(0, 80));
      sessionId = s.id;
      useSessions = true;
    }
  } catch {
    useSessions = false;
    sessionId = sessionId || "";
  }

  const chunks = body.no_rag
    ? []
    : await retrieve(env, { query: userText }).catch(() => []);

  const system = buildSystemPrompt({
    pineVersion: body.pine_version,
    style: body.style,
  });
  const augmented = buildUserAugmentedMessage(userText, chunks);

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.filter((m) => m.role !== "system").slice(-20),
    { role: "user", content: augmented },
  ];

  const maxRetries = parseMaxRetries(body.max_retries, env.VALIDATE_MAX_RETRIES);
  const validateDefault =
    (env.VALIDATE_DEFAULT || "true").toLowerCase() !== "false";
  const validate =
    body.validate !== undefined ? Boolean(body.validate) : validateDefault;

  let loopResult;
  try {
    loopResult = await generateValidateRetry({
      env,
      messages,
      temperature: body.temperature,
      maxTokens: body.max_tokens,
      model: body.model,
      validate,
      maxRetries,
      validateMode: body.validate_mode || "interpret",
      requirePine: wantsPineScript(userText),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(502, `Workers AI™ chat failed: ${msg}`);
  }

  if (useSessions && sessionId && body.persist !== false) {
    try {
      await appendMessage(env, sessionId, "user", userText, {
        rag_ids: chunks.map((c) => c.id),
      });
      await appendMessage(env, sessionId, "assistant", loopResult.text, {
        model: loopResult.model,
        latency_ms: loopResult.latency_ms,
        validated: loopResult.validated,
        retries: loopResult.retries,
      });
    } catch {
      /* non-fatal */
    }
  }

  const validateAvailable = isValidateAvailable(env);

  return json({
    ok: true,
    mode: validateAvailable ? "hoox" : "standalone",
    session_id: sessionId || null,
    reply: loopResult.text,
    pine: loopResult.pine,
    model: loopResult.model,
    latency_ms: loopResult.latency_ms,
    validation: {
      enabled: validate,
      available: validateAvailable,
      // true only when pyne-worker accepted the script; standalone never "fails" here
      validated: loopResult.validated,
      skipped: !validateAvailable || loopResult.validation?.skipped === true,
      retries: loopResult.retries,
      last: loopResult.validation
        ? {
            ok: loopResult.validation.ok,
            skipped: loopResult.validation.skipped || false,
            error: loopResult.validation.error,
            error_kind: loopResult.validation.error_kind,
            error_type: loopResult.validation.error_type,
            error_bar: loopResult.validation.error_bar,
            status: loopResult.validation.status,
            latency_ms: loopResult.validation.latency_ms,
            reason: loopResult.validation.reason,
          }
        : null,
      attempts: loopResult.attempts.map((a) => ({
        attempt: a.attempt,
        model: a.model,
        latency_ms: a.latency_ms,
        has_pine: Boolean(a.pine),
        validation: a.validation
          ? {
              ok: a.validation.ok,
              skipped: a.validation.skipped || false,
              error: a.validation.error,
              error_kind: a.validation.error_kind,
              latency_ms: a.validation.latency_ms,
            }
          : null,
      })),
    },
    rag: {
      count: chunks.length,
      chunks: chunks.map((c) => ({
        id: c.id,
        title: c.title,
        source: c.source,
        kind: c.kind,
        score: c.score,
      })),
    },
    marks: {
      pine: MARKS.pine,
      tradingView: MARKS.tradingView,
      cloudflare: MARKS.cloudflare,
    },
    disclaimer: DISCLAIMER_SHORT,
  });
}
