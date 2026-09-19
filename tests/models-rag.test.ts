// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clampMaxTokens,
  clampTemperature,
  ragTopK,
  resolveRequestedModel,
} from "../src/ai/models";
import { SERVICE_VERSION } from "../src/lib/version";
import { buildAgentSystemPrompt } from "../src/agent/prompts-v6";
import { buildSystemPrompt } from "../src/rag/prompts";
import { handleHealth } from "../src/routes/health";

describe("model allowlist / clamps", () => {
  const env = {
    CHAT_MODEL: "@cf/qwen/qwen2.5-coder-32b-instruct",
    CHAT_MODEL_FALLBACK: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    RAG_TOP_K: "8",
  } as Env;

  test("rejects unknown client model", () => {
    expect(resolveRequestedModel(env, "@cf/evil/huge")).toBe(env.CHAT_MODEL);
  });

  test("accepts primary and fallback", () => {
    expect(resolveRequestedModel(env, env.CHAT_MODEL)).toBe(env.CHAT_MODEL);
    const fallback = env.CHAT_MODEL_FALLBACK!;
    expect(resolveRequestedModel(env, fallback)).toBe(fallback);
  });

  test("clamps tokens and temperature", () => {
    expect(clampMaxTokens(12)).toBe(256);
    expect(clampMaxTokens(99_000)).toBe(8192);
    expect(clampTemperature(-1)).toBe(0);
    expect(clampTemperature(9)).toBe(1.5);
  });

  test("clamps search top_k", () => {
    expect(ragTopK(env, 999)).toBe(24);
    expect(ragTopK(env, 0)).toBe(8);
  });
});

describe("prompt lockstep", () => {
  test("REST and Agents both include v6 hard rules", () => {
    const rest = buildSystemPrompt({ pineVersion: "v6" });
    const agent = buildAgentSystemPrompt({ pineVersion: "v6" });
    for (const s of [rest, agent]) {
      expect(s).toContain("Pine Script™ v6 hard rules");
      expect(s).toContain("request.security");
      expect(s).toMatch(/when=/);
    }
  });
});

describe("version", () => {
  test("SERVICE_VERSION is 0.3.0", () => {
    expect(SERVICE_VERSION).toBe("0.3.0");
  });

  test("health fallback is 0.3.0", async () => {
    const res = await handleHealth({} as Env);
    const body = (await res.json()) as { version: string };
    expect(body.version).toBe("0.3.0");
  });
});

describe("plugin asset", () => {
  test("plugin/ and public/plugin/ stay identical", () => {
    const a = readFileSync(
      join(import.meta.dir, "..", "plugin", "axis-pine-agent.js"),
      "utf8"
    );
    const b = readFileSync(
      join(import.meta.dir, "..", "public", "plugin", "axis-pine-agent.js"),
      "utf8"
    );
    expect(a).toBe(b);
  });
});
