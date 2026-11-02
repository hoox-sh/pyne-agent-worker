// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { pyneAstOp, pyneLintOrHeuristic } from "../src/lib/pyne-ast";
import {
  generateValidateRetry,
  parseValidateStages,
  stagedValidate,
} from "../src/rag/validate-loop";
import { createAgentTools } from "../src/agent/tools";

describe("parseValidateStages", () => {
  test("defaults and filters", () => {
    expect(parseValidateStages({} as Env)).toEqual(["parse", "lint", "eval"]);
    expect(
      parseValidateStages({ VALIDATE_STAGES: "lint,eval" } as Env)
    ).toEqual(["lint", "eval"]);
  });
});

describe("pyneAstOp", () => {
  test("skips worker /ast when FEATURE_PYNE_AST is false", async () => {
    const r = await pyneAstOp(
      { PYNE_WORKER_URL: "https://pyne.example" } as Env,
      "parse",
      "//@version=6\nindicator('x')\nplot(close)",
      "worker"
    );
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/FEATURE_PYNE_AST/i);
  });

  test("404 /ast is skip not parse failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("gone", { status: 404 })) as unknown as typeof fetch;
    try {
      const r = await pyneAstOp(
        {
          PYNE_WORKER_URL: "https://pyne.example",
          FEATURE_PYNE_AST: "true",
        } as Env,
        "parse",
        "//@version=6\nindicator('x')\nplot(close)",
        "worker"
      );
      expect(r.skipped).toBe(true);
      expect(r.retryable).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("flask /lsp/diagnostics maps errors", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/lsp/diagnostics");
      return new Response(
        JSON.stringify({
          status: "success",
          ok: false,
          diagnostics: [
            {
              line: 2,
              character: 0,
              message: "bad",
              severity: "error",
            },
          ],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    try {
      const r = await pyneAstOp(
        {
          PYNE_PRO_URL: "https://pynescript.online",
          PYNE_PRO_API_KEY: "pyn_x",
        } as Env,
        "parse",
        "indicator('x')",
        "pro"
      );
      expect(r.ok).toBe(false);
      expect(r.skipped).toBeFalsy();
      expect(r.backend).toBe("pyne-pro");
      expect(r.error).toBe("bad");
      expect(r.line).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("pyne_compile never requests emit", async () => {
    const cap = { body: {} as Record<string, unknown> };
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      _i: RequestInfo | URL,
      init?: RequestInit
    ) => {
      cap.body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, mode: "compile" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    try {
      await pyneAstOp(
        {
          PYNE_WORKER_URL: "https://pyne.example",
          FEATURE_PYNE_AST: "true",
        } as Env,
        "compile",
        "//@version=6\nindicator('x')\nplot(close)",
        "worker"
      );
      expect(cap.body).toHaveProperty("script");
      expect(cap.body).not.toHaveProperty("emit");
      expect(cap.body).not.toHaveProperty("python");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("pyneLintOrHeuristic", () => {
  test("falls back to heuristic without language host", async () => {
    const r = await pyneLintOrHeuristic({} as Env, "plot(close)");
    expect(r.backend).toBe("heuristic");
    expect(r.ok).toBe(false);
  });
});

describe("stagedValidate", () => {
  test("lint stage fails before eval when heuristic catches errors", async () => {
    const r = await stagedValidate(
      { VALIDATE_STAGES: "lint,eval" } as Env,
      { script: "plot(close)" },
      "none"
    );
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("lint");
    expect(r.backend).toBe("heuristic");
  });

  test("parse skip then lint then eval on worker", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ast/")) {
        return new Response("missing", { status: 404 });
      }
      return new Response(
        JSON.stringify({ bars: 64, mode: "interpret" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    try {
      const r = await stagedValidate(
        {
          PYNE_WORKER_URL: "https://pyne.example",
          FEATURE_PYNE_AST: "true",
          VALIDATE_STAGES: "parse,lint,eval",
        } as Env,
        {
          script: "//@version=6\nindicator('Ok')\nplot(close)",
        },
        "worker"
      );
      expect(r.ok).toBe(true);
      expect(r.stage).toBe("eval");
      expect(r.backend).toBe("pyne-worker");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("generateValidateRetry structured fix", () => {
  test("fix prompt includes JSON error block", async () => {
    let fixUser = "";
    let calls = 0;
    const result = await generateValidateRetry({
      env: {} as Env,
      messages: [{ role: "user", content: "x" }],
      maxRetries: 1,
      validate: true,
      chatFn: async (_e, messages) => {
        calls += 1;
        if (calls === 2) {
          const last = messages[messages.length - 1];
          fixUser = last?.content || "";
        }
        if (calls === 1) {
          return {
            text: "```pine\nbad\n```",
            model: "m",
            latencyMs: 1,
          };
        }
        return {
          text: "```pine\n//@version=6\nindicator('x')\nplot(close)\n```",
          model: "m",
          latencyMs: 1,
        };
      },
      validateFn: async (_e, opts) => {
        if (opts.script.includes("bad")) {
          return {
            ok: false,
            stage: "lint",
            backend: "heuristic",
            error: "missing //@version",
            error_kind: "lint",
            retryable: true,
            latency_ms: 1,
          };
        }
        return { ok: true, stage: "eval", backend: "test", latency_ms: 1 };
      },
    });
    expect(result.validated).toBe(true);
    expect(fixUser).toContain("```json");
    expect(fixUser).toContain('"stage": "lint"');
  });
});

describe("agent tools catalog", () => {
  test("includes pyne_* language tools", () => {
    const tools = createAgentTools({} as Env);
    expect(tools).toHaveProperty("pyne_parse");
    expect(tools).toHaveProperty("pyne_eval");
    expect(tools).toHaveProperty("pyne_compile");
    expect(tools).toHaveProperty("pyne_lint");
  });
});
