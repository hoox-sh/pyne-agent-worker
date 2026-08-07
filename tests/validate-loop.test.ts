// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { syntheticBars } from "../src/lib/synthetic-bars";
import {
  formatValidateError,
  isValidateAvailable,
  validateOnPyneWorker,
} from "../src/lib/pyne-worker";
import { generateValidateRetry } from "../src/rag/validate-loop";

describe("syntheticBars", () => {
  test("produces required OHLCV shape", () => {
    const bars = syntheticBars(40);
    expect(bars.length).toBe(40);
    expect(bars[0]).toHaveProperty("open");
    expect(bars[0]).toHaveProperty("time");
    expect(bars[0].high).toBeGreaterThanOrEqual(bars[0].low);
  });
});

describe("pyne-worker client", () => {
  test("isValidateAvailable false without config", () => {
    expect(isValidateAvailable({} as Env)).toBe(false);
  });

  test("isValidateAvailable with URL", () => {
    expect(
      isValidateAvailable({ PYNE_WORKER_URL: "https://pyne.example" } as Env)
    ).toBe(true);
  });

  test("validate skipped when unconfigured", async () => {
    const r = await validateOnPyneWorker({} as Env, {
      script: "//@version=6\nindicator('x')\nplot(close)",
    });
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(false);
  });

  test("formatValidateError", () => {
    expect(
      formatValidateError({
        ok: false,
        error: "boom",
        error_kind: "parse",
        status: 500,
        latency_ms: 1,
      })
    ).toContain("boom");
  });

  test("validateOnPyneWorker success via fetch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ bars: 64, mode: "interpret", events: [] }), {
        status: 200,
      })) as unknown as typeof fetch;

    try {
      const r = await validateOnPyneWorker(
        { PYNE_WORKER_URL: "https://pyne.example", API_KEY: "k" } as Env,
        { script: "//@version=6\nindicator('t')\nplot(close)" }
      );
      expect(r.ok).toBe(true);
      expect(r.bars).toBe(64);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("validateOnPyneWorker surfaces error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: "Syntax error", error_kind: "parse" }),
        { status: 500 }
      )) as unknown as typeof fetch;

    try {
      const r = await validateOnPyneWorker(
        { PYNE_WORKER_URL: "https://pyne.example" } as Env,
        { script: "not pine" }
      );
      expect(r.ok).toBe(false);
      expect(r.error).toContain("Syntax");
      expect(r.error_kind).toBe("parse");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("generateValidateRetry", () => {
  test("retries until pyne-worker ok", async () => {
    let calls = 0;
    const result = await generateValidateRetry({
      env: {} as Env,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "make rsi" },
      ],
      maxRetries: 2,
      validate: true,
      chatFn: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            text: "bad\n```pine\nbad script\n```",
            model: "test-model",
            latencyMs: 5,
          };
        }
        return {
          text: "fixed\n```pine\n//@version=6\nindicator('ok')\nplot(close)\n```",
          model: "test-model",
          latencyMs: 5,
        };
      },
      validateFn: async (_env, opts) => {
        if (opts.script.includes("bad")) {
          return {
            ok: false,
            error: "parse fail",
            error_kind: "parse",
            status: 500,
            latency_ms: 2,
          };
        }
        return { ok: true, bars: 64, mode: "interpret", latency_ms: 2 };
      },
    });

    expect(result.validated).toBe(true);
    expect(result.retries).toBe(1);
    expect(result.attempts.length).toBe(2);
    expect(result.pine).toContain("//@version=6");
    expect(calls).toBe(2);
  });

  test("skips validate when disabled", async () => {
    const result = await generateValidateRetry({
      env: { PYNE_WORKER_URL: "https://pyne.example" } as Env,
      messages: [{ role: "user", content: "x" }],
      validate: false,
      chatFn: async () => ({
        text: "```pine\n//@version=6\nindicator('x')\nplot(close)\n```",
        model: "m",
        latencyMs: 1,
      }),
    });
    expect(result.attempts.length).toBe(1);
    expect(result.validated).toBe(false);
    expect(result.validation).toBeNull();
  });

  test("standalone: works without pyne-worker config", async () => {
    const result = await generateValidateRetry({
      env: {} as Env, // no PYNE_SERVICE, no PYNE_WORKER_URL
      messages: [{ role: "user", content: "sma cross" }],
      validate: true, // requested, but unavailable → single pass
      chatFn: async () => ({
        text: "plan\n```pine\n//@version=6\nindicator('SMA')\nplot(ta.sma(close, 14))\n```",
        model: "standalone-model",
        latencyMs: 3,
      }),
    });
    expect(result.attempts.length).toBe(1);
    expect(result.retries).toBe(0);
    expect(result.validated).toBe(false);
    expect(result.pine).toContain("ta.sma");
    expect(result.validation).toBeNull();
  });

  test("retries when pine block missing then succeeds", async () => {
    let calls = 0;
    const result = await generateValidateRetry({
      env: {} as Env,
      messages: [{ role: "user", content: "x" }],
      maxRetries: 1,
      validate: true,
      chatFn: async () => {
        calls += 1;
        if (calls === 1) {
          return { text: "sorry no code", model: "m", latencyMs: 1 };
        }
        return {
          text: "```pine\n//@version=6\nindicator('x')\nplot(close)\n```",
          model: "m",
          latencyMs: 1,
        };
      },
      validateFn: async () => ({
        ok: true,
        latency_ms: 1,
      }),
    });
    expect(result.validated).toBe(true);
    expect(result.retries).toBe(1);
  });
});
