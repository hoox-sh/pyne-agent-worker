// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  activeEmbedIdentity,
  embedIdentityV1,
  embedIdentityV2,
  resolveEmbedIdentity,
  vectorizeBinding,
} from "../src/ai/routing";
import { normalizeKnowledgeKind } from "../src/lib/knowledge-kind";
import { ragCacheKey } from "../src/agent/gateway";
import { retrieve } from "../src/rag/retrieve";

describe("embed identities", () => {
  test("v1 is 768 mean by default", () => {
    const id = embedIdentityV1({} as Env);
    expect(id.id).toBe("v1");
    expect(id.dimensions).toBe(768);
    expect(id.pooling).toBe("mean");
    expect(id.binding).toBe("VECTORIZE");
  });

  test("v2 null until flag + binding", () => {
    expect(embedIdentityV2({} as Env)).toBeNull();
    expect(
      embedIdentityV2({ FEATURE_KB_384: "true" } as Env)
    ).toBeNull();
    const v2 = embedIdentityV2({
      FEATURE_KB_384: "true",
      VECTORIZE_V2: {} as VectorizeIndex,
    } as Env);
    expect(v2?.id).toBe("v2");
    expect(v2?.dimensions).toBe(384);
    expect(v2?.pooling).toBe("cls");
  });

  test("active prefers v2 when ready", () => {
    const env = {
      FEATURE_KB_384: "true",
      VECTORIZE_V2: { query: async () => ({ matches: [] }) } as unknown as VectorizeIndex,
    } as Env;
    expect(activeEmbedIdentity(env).id).toBe("v2");
  });

  test("resolveEmbedIdentity v2 throws when unbound", () => {
    expect(() => resolveEmbedIdentity({} as Env, "v2")).toThrow(/VECTORIZE_V2/);
  });

  test("vectorizeBinding never returns the wrong index", () => {
    const v1 = embedIdentityV1({} as Env);
    const env = {
      VECTORIZE: { name: "v1" } as unknown as VectorizeIndex,
      VECTORIZE_V2: { name: "v2" } as unknown as VectorizeIndex,
      FEATURE_KB_384: "true",
    } as Env;
    expect(vectorizeBinding(env, v1)).toBe(env.VECTORIZE);
    const v2 = embedIdentityV2(env)!;
    expect(vectorizeBinding(env, v2)).toBe(env.VECTORIZE_V2);
  });
});

describe("rag cache key", () => {
  test("includes identity id and model", () => {
    const key = ragCacheKey({} as Env, "rsi", 8);
    expect(key).toContain("v1:");
    expect(key).toContain("bge-base");
    expect(key).toContain(":768:");
    expect(key).toContain(":mean:");
  });
});

describe("normalizeKnowledgeKind", () => {
  test("maps AXIS legacy labels", () => {
    expect(normalizeKnowledgeKind("AXIS doc")).toBe("docs-axis");
    expect(normalizeKnowledgeKind("Product")).toBe("docs-axis");
    expect(normalizeKnowledgeKind("docs-pyne")).toBe("docs-pyne");
    expect(normalizeKnowledgeKind("corpus")).toBe("corpus");
  });
});

describe("retrieve never cross-queries dims", () => {
  test("empty V2 does not query V1 unless KB_FALLBACK_V1", async () => {
    let queried: string[] = [];
    const env = {
      AI: {} as Ai,
      FEATURE_KB_384: "true",
      KB_FALLBACK_V1: "false",
      VECTORIZE: {
        query: async () => {
          queried.push("v1");
          return { matches: [{ id: "a", score: 1, metadata: { text: "hit" } }] };
        },
      },
      VECTORIZE_V2: {
        query: async () => {
          queried.push("v2");
          return { matches: [] };
        },
      },
      KB: { get: async () => null },
    } as unknown as Env;

    // Stub embed via AI.run
    (env as { AI: { run: unknown } }).AI = {
      run: async () => ({ data: [new Array(384).fill(0.01)] }),
    };

    const chunks = await retrieve(env, { query: "rsi", topK: 4 });
    expect(queried).toEqual(["v2"]);
    expect(chunks.length).toBe(0);
  });

  test("KB_FALLBACK_V1 re-embeds and queries v1", async () => {
    let dims: number[] = [];
    let queried: string[] = [];
    const env = {
      FEATURE_KB_384: "true",
      KB_FALLBACK_V1: "true",
      VECTORIZE: {
        query: async () => {
          queried.push("v1");
          return {
            matches: [
              { id: "a", score: 1, metadata: { text: "fallback hit" } },
            ],
          };
        },
      },
      VECTORIZE_V2: {
        query: async () => {
          queried.push("v2");
          return { matches: [] };
        },
      },
      KB: { get: async () => null },
      AI: {
        run: async (_m: string, input: { text: string[] }) => {
          // first call 384, second 768 when fallback re-embeds
          const n = dims.length === 0 ? 384 : 768;
          dims.push(n);
          return { data: input.text.map(() => new Array(n).fill(0.01)) };
        },
      },
    } as unknown as Env;

    const chunks = await retrieve(env, { query: "rsi", topK: 4 });
    expect(queried).toEqual(["v2", "v1"]);
    expect(dims).toEqual([384, 768]);
    expect(chunks[0]?.text).toBe("fallback hit");
  });
});
