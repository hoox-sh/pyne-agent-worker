// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Model routing: feature flags, gated paid allowlist, BYOM (env URL only).
 * Git default stays Qwen 32B until FEATURE_GLM53 / CHAT_MODEL overlay.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  DEFAULT_CHAT_FALLBACK,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  chatFallbackModel as envChatFallback,
  chatModel as envChatModel,
  embedModel as envEmbedModel,
} from "./models";

export const MODEL_GLM53 = "@cf/zai-org/glm-5.3";
export const MODEL_GLM53_FLASH = "@cf/zai-org/glm-5.3-flash";
export const MODEL_KIMI_K27 = "@cf/moonshotai/kimi-k2.7-code";
export const MODEL_QWEN3_30B = "@cf/qwen/qwen3-30b-a3b-fp8";
export const MODEL_CUSTOM = "custom";

export const PAID_CHAT_MODELS = [
  MODEL_GLM53,
  MODEL_GLM53_FLASH,
  MODEL_KIMI_K27,
] as const;

export type EmbedIdentity = {
  id: "v1" | "v2";
  binding: "VECTORIZE" | "VECTORIZE_V2";
  model: string;
  dimensions: number;
  pooling: "mean" | "cls";
};

export type ReasoningEffort = "low" | "high" | "max";

export function featureFlag(env: Env, name: keyof Env | string): boolean {
  const bag = env as unknown as Record<string, unknown>;
  return String(bag[name] || "")
    .trim()
    .toLowerCase() === "true";
}

export function featureGlm53(env: Env): boolean {
  return featureFlag(env, "FEATURE_GLM53");
}

export function featureSubagents(env: Env): boolean {
  return featureFlag(env, "FEATURE_SUBAGENTS");
}

export function featurePyneAst(env: Env): boolean {
  return featureFlag(env, "FEATURE_PYNE_AST");
}

export function featureKb384(env: Env): boolean {
  return featureFlag(env, "FEATURE_KB_384");
}

export function isUrlModelId(id: string): boolean {
  return /^https?:\/\//i.test(id.trim());
}

export function isGlmFamily(modelId: string): boolean {
  return /@cf\/zai-org\/glm-5/i.test(modelId);
}

export function isKimiFamily(modelId: string): boolean {
  return /@cf\/moonshotai\/kimi/i.test(modelId);
}

export function isHighTokenFamily(modelId: string): boolean {
  return isGlmFamily(modelId) || isKimiFamily(modelId);
}

/** Effective primary: FEATURE_GLM53 promotes default Qwen → GLM-5.3. */
export function effectiveChatModel(env: Env): string {
  const configured = envChatModel(env);
  if (featureGlm53(env) && configured === DEFAULT_CHAT_MODEL) {
    return MODEL_GLM53;
  }
  return configured;
}

/** Effective fallback: FEATURE_GLM53 promotes default Llama → Kimi. */
export function effectiveChatFallback(env: Env): string {
  const configured = envChatFallback(env);
  if (featureGlm53(env) && configured === DEFAULT_CHAT_FALLBACK) {
    return MODEL_KIMI_K27;
  }
  return configured;
}

function extraChatModels(env: Env): string[] {
  return String(env.CHAT_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !isUrlModelId(s));
}

export function allowedChatModels(env: Env): Set<string> {
  const set = new Set<string>([
    effectiveChatModel(env),
    effectiveChatFallback(env),
    DEFAULT_CHAT_MODEL,
    DEFAULT_CHAT_FALLBACK,
    ...extraChatModels(env),
  ]);
  if (featureGlm53(env)) {
    for (const id of PAID_CHAT_MODELS) set.add(id);
  }
  if (featureSubagents(env)) {
    set.add(MODEL_GLM53_FLASH);
    set.add(MODEL_QWEN3_30B);
  }
  if (customModelEndpoint(env)) {
    set.add(MODEL_CUSTOM);
  }
  return set;
}

/** Client model id: allowlist only. Reject https:// even if CSV was polluted. */
export function resolveRequestedModel(env: Env, requested?: string): string {
  const primary = effectiveChatModel(env);
  const id = (requested || "").trim();
  if (!id) return primary;
  if (isUrlModelId(id)) return primary;
  return allowedChatModels(env).has(id) ? id : primary;
}

export function clampMaxTokens(n?: number, modelId?: string): number {
  const cap = modelId && isHighTokenFamily(modelId) ? 32_768 : 8_192;
  if (n == null || !Number.isFinite(n)) return Math.min(4096, cap);
  return Math.max(256, Math.min(cap, Math.floor(n)));
}

export function clampTemperature(n?: number): number {
  if (n == null || !Number.isFinite(n)) return 0.2;
  return Math.max(0, Math.min(1.5, n));
}

export function envReasoningEffort(env: Env): ReasoningEffort {
  const raw = String(env.REASONING_EFFORT || "high").trim().toLowerCase();
  if (raw === "low" || raw === "max" || raw === "high") return raw;
  return "high";
}

/**
 * REST may pass max; SDK clamps max → high (workers-ai-provider types).
 * Omit for non-GLM families.
 */
export function reasoningEffortFor(
  env: Env,
  modelId: string,
  path: "rest" | "sdk",
  requested?: string
): ReasoningEffort | undefined {
  if (!isGlmFamily(modelId) && !isKimiFamily(modelId)) return undefined;
  const raw = String(requested || envReasoningEffort(env))
    .trim()
    .toLowerCase();
  let effort: ReasoningEffort =
    raw === "low" || raw === "max" || raw === "high" ? raw : "high";
  if (path === "sdk" && effort === "max") effort = "high";
  return effort;
}

export function isRetryableModelError(
  msg: string,
  opts?: { source?: "workers-ai" | "pyne" | "axis" }
): boolean {
  if (/timeout|overloaded|capacity|503|429|3040/i.test(msg)) return true;
  if (
    opts?.source === "workers-ai" &&
    /403/.test(msg) &&
    /5035/.test(msg)
  ) {
    return true;
  }
  return false;
}

export function customModelEndpoint(env: Env): string {
  return String(env.CUSTOM_MODEL_ENDPOINT || "").trim().replace(/\/+$/, "");
}

export function customModelApiKey(env: Env): string {
  return String(env.CUSTOM_MODEL_API_KEY || "").trim();
}

/** BYOM LanguageModel when CUSTOM_MODEL_ENDPOINT is set (operator env only). */
export function resolveCustomLanguageModel(env: Env): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  modelId: string;
} | null {
  const baseURL = customModelEndpoint(env);
  if (!baseURL || !/^https?:\/\//i.test(baseURL)) return null;
  const provider = createOpenAICompatible({
    name: "pyne-byom",
    baseURL,
    apiKey: customModelApiKey(env) || "unused",
  });
  const modelName =
    String(env.CUSTOM_MODEL_NAME || "").trim() || "default";
  return { model: provider.chatModel(modelName), modelId: MODEL_CUSTOM };
}

export type SpecialistRole =
  | "parser"
  | "validator"
  | "optimizer"
  | "docs"
  | "axis"
  | "dynamic";

/** Specialist model only when FEATURE_SUBAGENTS. Defaults to glm-5.3-flash. */
export function specialistModel(env: Env, role: SpecialistRole): string {
  if (!featureSubagents(env)) return effectiveChatModel(env);
  const map: Record<SpecialistRole, string | undefined> = {
    parser: env.MODEL_PARSER,
    validator: env.MODEL_VALIDATOR,
    optimizer: env.MODEL_OPTIMIZER,
    docs: env.MODEL_DOCS,
    axis: env.MODEL_AXIS,
    dynamic: env.MODEL_DYNAMIC,
  };
  const id = String(map[role] || "").trim();
  if (id && !isUrlModelId(id)) return id;
  return featureGlm53(env) ? MODEL_GLM53_FLASH : MODEL_QWEN3_30B;
}

/** Current Vectorize V1 identity (768-d mean). */
export function embedIdentityV1(env: Env): EmbedIdentity {
  return {
    id: "v1",
    binding: "VECTORIZE",
    model: envEmbedModel(env) || DEFAULT_EMBED_MODEL,
    dimensions: 768,
    pooling: (String(env.EMBED_POOLING || "mean").toLowerCase() === "cls"
      ? "cls"
      : "mean") as "mean" | "cls",
  };
}

/** Optional V2 identity — null until FEATURE_KB_384 and VECTORIZE_V2. */
export function embedIdentityV2(env: Env): EmbedIdentity | null {
  if (!featureKb384(env) || !env.VECTORIZE_V2) return null;
  return {
    id: "v2",
    binding: "VECTORIZE_V2",
    model:
      String(env.EMBED_MODEL_V2 || "").trim() ||
      "@cf/baai/bge-small-en-v1.5",
    dimensions: 384,
    pooling: (String(env.EMBED_POOLING_V2 || "cls").toLowerCase() === "mean"
      ? "mean"
      : "cls") as "mean" | "cls",
  };
}

export function activeEmbedIdentity(env: Env): EmbedIdentity {
  return embedIdentityV2(env) || embedIdentityV1(env);
}

/** Resolve identity for retrieve/admin. Never mixes dims across bindings. */
export function resolveEmbedIdentity(
  env: Env,
  prefer?: "v1" | "v2" | "auto"
): EmbedIdentity {
  if (prefer === "v1") return embedIdentityV1(env);
  if (prefer === "v2") {
    const v2 = embedIdentityV2(env);
    if (!v2) {
      throw new Error(
        "index=v2 requires FEATURE_KB_384=true and VECTORIZE_V2 binding"
      );
    }
    return v2;
  }
  return activeEmbedIdentity(env);
}

export function vectorizeBinding(
  env: Env,
  ident: EmbedIdentity
): VectorizeIndex | undefined {
  return ident.binding === "VECTORIZE_V2" ? env.VECTORIZE_V2 : env.VECTORIZE;
}

export function kbFallbackV1(env: Env): boolean {
  return featureFlag(env, "KB_FALLBACK_V1");
}
