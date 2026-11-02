// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { handleHealth } from "../src/routes/health";
import { createAgentTools } from "../src/agent/tools";

describe("health polish", () => {
  test("exposes stages, subagents inventory, and indexes without probing /ast", async () => {
    const res = await handleHealth({
      SERVICE_NAME: "pyne-agent-worker",
      SERVICE_VERSION: "0.4.0",
      CHAT_MODEL: "m",
      EMBED_MODEL: "e",
      VALIDATE_STAGES: "parse,lint,eval",
      FEATURE_SUBAGENTS: "false",
      MAX_SUBAGENTS: "6",
      SUBAGENT_CONCURRENCY: "3",
    } as Env);
    const body = (await res.json()) as {
      features: { pyne_ast: { flag: boolean; worker_bound: boolean } };
      indexes: { v1: number; v2: string | number; active: string };
      subagents: { enabled: boolean; max_specialists: number; concurrency: number };
      validation: { stages: string[]; note: string };
    };
    expect(body.features.pyne_ast.flag).toBe(false);
    expect(body.features.pyne_ast.worker_bound).toBe(false);
    expect(body.indexes.v1).toBe(768);
    expect(body.indexes.v2).toBe("unbound");
    expect(body.indexes.active).toBe("v1");
    expect(body.subagents.enabled).toBe(false);
    expect(body.subagents.max_specialists).toBe(5);
    expect(body.subagents.concurrency).toBe(3);
    expect(body.validation.stages).toEqual(["parse", "lint", "eval"]);
    expect(body.validation.note).not.toMatch(/\/ast\//);
  });

  test("indexes.v2 is 384 when VECTORIZE_V2 is bound even if flag off", async () => {
    const res = await handleHealth({
      VECTORIZE_V2: {} as VectorizeIndex,
      FEATURE_KB_384: "false",
    } as Env);
    const body = (await res.json()) as { indexes: { v2: number | string } };
    expect(body.indexes.v2).toBe(384);
  });
});

describe("rag_search alias", () => {
  test("agent tools expose rag_search alongside search_knowledge_base", () => {
    const tools = createAgentTools({} as Env);
    expect(tools).toHaveProperty("search_knowledge_base");
    expect(tools).toHaveProperty("rag_search");
    expect(tools.rag_search).toBe(tools.search_knowledge_base);
  });
});
