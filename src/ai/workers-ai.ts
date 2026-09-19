// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  chatFallbackModel,
  clampMaxTokens,
  clampTemperature,
  embedModel,
  resolveRequestedModel,
} from "./models";

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
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = embedModel(env);
  const started = Date.now();
  const raw = (await env.AI.run(model as Parameters<Ai["run"]>[0], {
    text: texts,
  })) as WorkersEmbedResponse;
  void started;

  const data = raw.data ?? raw.result?.data;
  if (!data || !Array.isArray(data)) {
    throw new Error(`Embedding model ${model} returned no vectors`);
  }
  return data;
}

export async function embedQuery(env: Env, text: string): Promise<number[]> {
  const [v] = await embedTexts(env, [text]);
  if (!v) throw new Error("Empty embedding for query");
  return v;
}

function isRetryableModelError(msg: string): boolean {
  return /timeout|overloaded|capacity|503|429/i.test(msg);
}

export async function chatComplete(
  env: Env,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<ChatResult> {
  const primary = resolveRequestedModel(env, opts?.model);
  const fallback = chatFallbackModel(env);
  const started = Date.now();
  const temperature = clampTemperature(opts?.temperature);
  const maxTokens = clampMaxTokens(opts?.maxTokens);

  const runOnce = async (model: string) => {
    const raw = (await env.AI.run(model as Parameters<Ai["run"]>[0], {
      messages,
      temperature,
      max_tokens: maxTokens,
    })) as WorkersChatResponse;

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
    if (fallback && fallback !== primary && isRetryableModelError(msg)) {
      const r = await runOnce(fallback);
      return { ...r, latencyMs: Date.now() - started };
    }
    throw e;
  }
}
