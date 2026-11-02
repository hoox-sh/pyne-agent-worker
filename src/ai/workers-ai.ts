// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  MODEL_CUSTOM,
  type EmbedIdentity,
  activeEmbedIdentity,
  clampMaxTokens,
  clampTemperature,
  customModelApiKey,
  customModelEndpoint,
  effectiveChatFallback,
  isRetryableModelError,
  reasoningEffortFor,
  resolveRequestedModel,
} from "./routing";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatResult = {
  text: string;
  model: string;
  latencyMs: number;
};

type WorkersChatResponse = {
  response?: string;
  result?: { response?: string };
};

type WorkersEmbedResponse = {
  data?: number[][];
  result?: { data?: number[][] };
};

export async function embedTexts(
  env: Env,
  texts: string[],
  opts?: { identity?: EmbedIdentity; model?: string; pooling?: "mean" | "cls" }
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ident = opts?.identity || activeEmbedIdentity(env);
  const model = opts?.model || ident.model;
  const pooling = opts?.pooling || ident.pooling;
  const started = Date.now();
  const raw = (await env.AI.run(model as Parameters<Ai["run"]>[0], {
    text: texts,
    pooling,
  })) as WorkersEmbedResponse;
  void started;

  const data = raw.data ?? raw.result?.data;
  if (!data || !Array.isArray(data)) {
    throw new Error(`Embedding model ${model} returned no vectors`);
  }
  return data;
}

export async function embedQuery(
  env: Env,
  text: string,
  identity?: EmbedIdentity
): Promise<number[]> {
  const [v] = await embedTexts(env, [text], { identity });
  if (!v) throw new Error("Empty embedding for query");
  return v;
}

async function chatCompleteByom(
  env: Env,
  messages: ChatMessage[],
  opts: { temperature: number; maxTokens: number }
): Promise<{ text: string; model: string }> {
  const base = customModelEndpoint(env);
  if (!base) throw new Error("CUSTOM_MODEL_ENDPOINT not configured");
  const url = `${base.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = customModelApiKey(env);
  if (key) headers.Authorization = `Bearer ${key}`;
  const modelName =
    String(env.CUSTOM_MODEL_NAME || "").trim() || "default";
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message || `BYOM chat HTTP ${res.status}`
    );
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error("BYOM chat returned empty response");
  }
  return { text, model: MODEL_CUSTOM };
}

export async function chatComplete(
  env: Env,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    reasoningEffort?: string;
  }
): Promise<ChatResult> {
  const primary = resolveRequestedModel(env, opts?.model);
  const fallback = effectiveChatFallback(env);
  const started = Date.now();
  const temperature = clampTemperature(opts?.temperature);

  const runOnce = async (model: string) => {
    const maxTokens = clampMaxTokens(opts?.maxTokens, model);
    if (model === MODEL_CUSTOM) {
      return chatCompleteByom(env, messages, { temperature, maxTokens });
    }
    const effort = reasoningEffortFor(
      env,
      model,
      "rest",
      opts?.reasoningEffort
    );
    const payload: Record<string, unknown> = {
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (effort) payload.reasoning_effort = effort;

    const raw = (await env.AI.run(
      model as Parameters<Ai["run"]>[0],
      payload
    )) as WorkersChatResponse;

    const text =
      raw.response ??
      raw.result?.response ??
      (typeof raw === "string" ? raw : "");

    if (!text || typeof text !== "string") {
      throw new Error(`Chat model ${model} returned empty response`);
    }
    return { text, model };
  };

  try {
    const r = await runOnce(primary);
    return { ...r, latencyMs: Date.now() - started };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      fallback &&
      fallback !== primary &&
      isRetryableModelError(msg, { source: "workers-ai" })
    ) {
      const r = await runOnce(fallback);
      return { ...r, latencyMs: Date.now() - started };
    }
    throw e;
  }
}

export { isRetryableModelError };
