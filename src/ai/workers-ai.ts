// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chatModel, embedModel } from "./models";

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

export async function chatComplete(
  env: Env,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<ChatResult> {
  const model = (opts?.model || chatModel(env)).trim();
  const started = Date.now();

  const raw = (await env.AI.run(model as Parameters<Ai["run"]>[0], {
    messages,
    temperature: opts?.temperature ?? 0.2,
    max_tokens: opts?.maxTokens ?? 4096,
  })) as WorkersChatResponse;

  const text =
    raw.response ??
    raw.result?.response ??
    (typeof raw === "string" ? raw : "");

  if (!text || typeof text !== "string") {
    throw new Error(`Chat model ${model} returned empty response`);
  }

  return {
    text,
    model,
    latencyMs: Date.now() - started,
  };
}
