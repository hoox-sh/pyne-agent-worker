// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChatMessage } from "../ai/workers-ai";
import { ragTopK } from "../ai/models";
import {
  clampMaxTokens,
  clampTemperature,
  resolveRequestedModel,
} from "../ai/routing";
import { errorJson, json, readJson } from "../lib/json";
import { DISCLAIMER_SHORT, MARKS } from "../lib/legal";
import {
  flushUsageQueue,
  queueUsageEvent,
  USAGE_SCOPE,
} from "../lib/usage";
import {
  buildSystemPrompt,
  buildUserAugmentedMessage,
  wantsPineScript,
} from "../rag/prompts";
import type { RagChunk } from "../rag/retrieve";
import {
  appendMessage,
  createSession,
  getSession,
  listMessages,
} from "../rag/sessions";
import { generateValidateRetry, isAnyValidateAvailable } from "../rag/validate-loop";
import { runAgenticChat, type AgenticAction } from "../rag/agentic";
import { searchKnowledge } from "../agent/knowledge";
import { detectPersona, looksActionable, normalizePersona } from "../agent/personas";
import { isAxisMcpConfigured } from "../axis/mcp-client";
import {
  anyPyneEvalConfigured,
  envPyneBackend,
  parsePyneBackend,
  type PyneBackendKind,
} from "../lib/pyne-backend";
import { createOrchestratorTools } from "../agent/orchestrator";
import {
  featureGlm53,
  featureKb384,
  featurePyneAst,
  featureSubagents,
} from "../ai/routing";
import { maxSpecialistsFromEnv } from "../agent/subagents/quota";

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
  /** Persona stance: auto (detect) | pine | axis | trader */
  persona?: "auto" | "pine" | "axis" | "trader";
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
  /**
   * Full tool loop (plugin 0.1.8 always sends true). Missing = cheap REST.
   */
  orchestrate?: boolean;
  /** Named PYNE host. Kind only — never a URL. */
  pyne_backend?: PyneBackendKind;
  /** Max specialists this turn (0..5). Ignored unless orchestrate + FEATURE_SUBAGENTS. */
  max_subagents?: number;
};

function parseOrchestrate(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === 1;
}

function parseMaxSubagents(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.max(0, Math.min(5, Math.floor(raw)));
}

function parseMaxRetries(raw: unknown, envDefault: string | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(5, Math.floor(raw)));
  }
  const fromEnv = Number(envDefault ?? "2");
  if (Number.isFinite(fromEnv)) return Math.max(0, Math.min(5, Math.floor(fromEnv)));
  return 2;
}

/**
 * Metering context threaded from `authorizeRequest` (additive, optional).
 * `tid` is the verified tenant id; `authToken` is `USAGE_SERVICE_KEY` or the
 * per-request tenant hash (hash-on-wire, never the raw key). `ctx` enables
 * `waitUntil` background flush; without it the flush runs inline with a 2s
 * budget. `fetchFn` is a test injectable for the console POST.
 */
export type ChatMeter = {
  tid?: string;
  keyHash16?: string;
  authToken?: string;
  ctx?: Pick<ExecutionContext, "waitUntil"> | null;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
};

export async function handleChat(
  request: Request,
  env: Env,
  meter?: ChatMeter
): Promise<Response> {
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
  const rawKind = (body as { pyne_backend?: unknown }).pyne_backend;
  const pyneBackend = parsePyneBackend(
    rawKind == null || rawKind === "" ? envPyneBackend(env) : rawKind
  );
  if (!pyneBackend) {
    return errorJson(400, "invalid pyne_backend", { code: "INVALID_FIELD" });
  }
  const orchestrate = parseOrchestrate(body.orchestrate);

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

  const degraded: string[] = [];
  let chunks: RagChunk[] = [];
  let ragBackend = "none";
  if (!body.no_rag) {
    try {
      const kn = await searchKnowledge(env, userText, ragTopK(env));
      ragBackend = kn.backend;
      chunks = kn.hits.map((h) => ({
        id: h.id,
        text: h.text,
        title: h.title,
        source: h.source,
        score: h.score,
        kind: "other",
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(JSON.stringify({ type: "rag_failed", error: msg }));
      degraded.push("rag");
    }
  }

  // Compute actionable / orchestrate *before* the system prompt so Grandmaster
  // tools mode and AXIS control prose match the tool loop we will run.
  const persona = detectPersona(userText, body.persona);
  const actionable =
    isAxisMcpConfigured(env) && looksActionable(userText, persona);
  // Plugin 0.1.8 always sends orchestrate:true. Missing field stays cheap REST.
  // orchestrate wins over looksActionable (full tools, 8 steps vs AXIS ≤4).
  const runTools = orchestrate || actionable;
  const toolsMode = orchestrate ? "full" : actionable ? "axis" : "none";

  const system = buildSystemPrompt({
    pineVersion: body.pine_version,
    style: body.style,
    persona: normalizePersona(body.persona),
    userText,
    tools: toolsMode,
  });
  const augmented = buildUserAugmentedMessage(userText, chunks);

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.filter((m) => m.role !== "system").slice(-20),
    { role: "user", content: augmented },
  ];

  // Operator path: let the model ACT first (bounded tool loop), then feed
  // its output through the normal generate→validate→retry loop as attempt 1.
  // Any agentic failure falls back to the single-shot loop below.
  let seedResult: { text: string; model: string; latencyMs: number } | null = null;
  let mcpActions: AgenticAction[] = [];
  let subagents: Array<{
    role: string;
    model?: string;
    ok: boolean;
    latency_ms: number;
    error?: string;
    skipped?: boolean;
  }> = [];
  const model = resolveRequestedModel(env, body.model);
  const temperature = clampTemperature(body.temperature);
  const maxTokens = clampMaxTokens(body.max_tokens, model); // family cap (Qwen 8k / GLM 32k)
  const maxSubagents = maxSpecialistsFromEnv(
    env,
    parseMaxSubagents(body.max_subagents)
  );
  if (runTools) {
    try {
      const bundle = createOrchestratorTools(env, {
        catalog: orchestrate ? "full" : "axis",
        allowSpawn: orchestrate && featureSubagents(env),
        maxSubagents,
      });
      const agentic = await runAgenticChat(env, {
        system,
        messages,
        maxSteps: orchestrate ? (bundle.allowSpawn ? 12 : 8) : 4,
        temperature,
        maxTokens,
        model,
        catalog: bundle.catalog,
        allowSpawn: bundle.allowSpawn,
        quota: bundle.quota ?? undefined,
      });
      seedResult = {
        text: agentic.text,
        model: agentic.model,
        latencyMs: agentic.latencyMs,
      };
      mcpActions = agentic.actions;
      subagents = agentic.subagents || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(JSON.stringify({ type: "agentic_failed", error: msg }));
      degraded.push("agentic");
      seedResult = null;
      subagents = [];
    }
  }

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
      temperature,
      maxTokens,
      model,
      validate,
      maxRetries,
      validateMode: body.validate_mode || "interpret",
      requirePine: wantsPineScript(userText),
      seedResult,
      pyneBackend,
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

  const validateAvailable = isAnyValidateAvailable(env, pyneBackend);
  const axisWired = isAxisMcpConfigured(env);

  // Usage metering (Phase 3, additive): only on successful completion with a
  // verified tid. Failures are swallowed — metering never fails the chat.
  // Vectorize KB bytes are included when retrieval ran; otherwise omitted.
  try {
    const tid = (meter?.tid ?? "").trim();
    if (tid && tid !== "unknown" && tid !== "selfhost") {
      let kbBytes: number | undefined;
      if (ragBackend !== "none" && chunks.length > 0) {
        const enc = new TextEncoder();
        let total = 0;
        for (const c of chunks) total += enc.encode(c.text || "").length;
        if (total > 0) kbBytes = total;
      }
      const queued = queueUsageEvent({
        tid,
        scope: USAGE_SCOPE,
        units:
          kbBytes !== undefined
            ? { generations: 1, kbBytes }
            : { generations: 1 },
        keyHash16: meter?.keyHash16,
      });
      if (queued) {
        const auth = (meter?.authToken ?? "").trim() || undefined;
        const flushOpts = { fetchFn: meter?.fetchFn, timeoutMs: 2000 };
        if (meter?.ctx && typeof meter.ctx.waitUntil === "function") {
          meter.ctx.waitUntil(
            flushUsageQueue(env, auth, flushOpts).catch(() => 0)
          );
        } else {
          await flushUsageQueue(env, auth, flushOpts).catch(() => 0);
        }
      }
    }
  } catch {
    /* metering never fails chat */
  }

  const featureList = [
    featureSubagents(env) ? "subagents" : null,
    featureGlm53(env) ? "glm53" : null,
    featurePyneAst(env) ? "pyne_ast" : null,
    featureKb384(env) ? "kb_384" : null,
    orchestrate ? "orchestrate" : null,
    toolsMode !== "none" ? `tools:${toolsMode}` : null,
  ].filter((x): x is string => Boolean(x));

  return json({
    ok: true,
    mode: anyPyneEvalConfigured(env, pyneBackend) ? "hoox" : axisWired ? "axis" : "standalone",
    axis_mcp: axisWired,
    persona,
    pyne_backend: pyneBackend,
    orchestrate,
    features: featureList,
    mcp_actions: mcpActions,
    subagents,
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
            backend: loopResult.validation.backend,
            stage: loopResult.validation.stage,
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
    degraded,
    rag: {
      backend: ragBackend,
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
