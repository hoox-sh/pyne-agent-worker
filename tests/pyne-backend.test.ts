// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  isPrivatePyneHost,
  parsePyneBackend,
  resolvePyneBackend,
  validateOnSelectedBackend,
} from "../src/lib/pyne-backend";
import { handleHealth } from "../src/routes/health";

describe("parsePyneBackend", () => {
  test("defaults empty to auto and rejects junk", () => {
    expect(parsePyneBackend(undefined)).toBe("auto");
    expect(parsePyneBackend("")).toBe("auto");
    expect(parsePyneBackend("WORKER")).toBe("worker");
    expect(parsePyneBackend("ftp")).toBeNull();
    expect(parsePyneBackend(1)).toBeNull();
  });
});

describe("private hosts", () => {
  test("loopback and RFC1918", () => {
    expect(isPrivatePyneHost("127.0.0.1")).toBe(true);
    expect(isPrivatePyneHost("localhost")).toBe(true);
    expect(isPrivatePyneHost("192.168.1.9")).toBe(true);
    expect(isPrivatePyneHost("10.0.0.2")).toBe(true);
    expect(isPrivatePyneHost("pynescript.online")).toBe(false);
  });
});

describe("resolvePyneBackend", () => {
  test("auto prefers worker over flask", () => {
    const r = resolvePyneBackend(
      {
        PYNE_WORKER_URL: "https://pyne.example",
        PYNE_PRO_URL: "https://pynescript.online",
        PYNE_PRO_API_KEY: "pyn_x",
      } as Env,
      "auto"
    );
    expect(r.kind).toBe("worker");
    expect(r.eval).toBe(true);
    expect(r.dialect).toBe("worker");
  });

  test("explicit pro without key skips", () => {
    const r = resolvePyneBackend({} as Env, "pro");
    expect(r.eval).toBe(false);
    expect(r.reason).toMatch(/pro key/i);
  });

  test("local loopback skips unless allowed", () => {
    const blocked = resolvePyneBackend({} as Env, "local");
    expect(blocked.eval).toBe(false);
    expect(blocked.reason).toMatch(/not reachable/i);
    const ok = resolvePyneBackend(
      { PYNE_ALLOW_PRIVATE_URLS: "true" } as Env,
      "local"
    );
    expect(ok.eval).toBe(true);
    expect(ok.dialect).toBe("flask");
    expect(ok.url).toContain("/run");
  });
});

describe("validateOnSelectedBackend dialects", () => {
  test("flask POST uses data and never timeframe", async () => {
    const cap = { url: "", body: {} as Record<string, unknown> };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      cap.url = String(input);
      cap.body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ status: "success", count: 64 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    try {
      const r = await validateOnSelectedBackend(
        {
          PYNE_PRO_URL: "https://pynescript.online",
          PYNE_PRO_API_KEY: "pyn_test",
        } as Env,
        { script: "//@version=6\nindicator('x')\nplot(close)" },
        "pro"
      );
      expect(r.ok).toBe(true);
      expect(r.backend).toBe("pyne-pro");
      expect(cap.url).toBe("https://pynescript.online/run");
      expect(cap.body).toHaveProperty("data");
      expect(cap.body).not.toHaveProperty("ohlcv");
      expect(cap.body).not.toHaveProperty("timeframe");
      expect(cap.body).not.toHaveProperty("ticker");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("worker POST keeps ohlcv + timeframe", async () => {
    const cap = { body: {} as Record<string, unknown> };
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      cap.body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ bars: 64, mode: "interpret" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    try {
      const r = await validateOnSelectedBackend(
        { PYNE_WORKER_URL: "https://pyne.example" } as Env,
        { script: "//@version=6\nindicator('x')\nplot(close)" },
        "worker"
      );
      expect(r.ok).toBe(true);
      expect(r.backend).toBe("pyne-worker");
      expect(cap.body).toHaveProperty("ohlcv");
      expect(cap.body.timeframe).toBe("1m");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("flask UNKNOWN_FIELDS is skipped", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: "UNKNOWN_FIELDS",
          message: "Unexpected field(s): timeframe",
        }),
        { status: 400 }
      )) as unknown as typeof fetch;
    try {
      const r = await validateOnSelectedBackend(
        {
          PYNE_PRO_URL: "https://pynescript.online",
          PYNE_PRO_API_KEY: "pyn_test",
        } as Env,
        { script: "//@version=6\nindicator('x')\nplot(close)" },
        "pro"
      );
      expect(r.skipped).toBe(true);
      expect(r.retryable).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("health inventory", () => {
  test("reports pyne_backends without probing", async () => {
    const res = await handleHealth({
      SERVICE_NAME: "pyne-agent-worker",
      SERVICE_VERSION: "0.4.0",
      CHAT_MODEL: "m",
      EMBED_MODEL: "e",
      PYNE_BACKEND: "auto",
    } as Env);
    const body = (await res.json()) as {
      pyne_backends: { selected: string; worker: { bound: false } };
    };
    expect(body.pyne_backends.selected).toBe("auto");
    expect(body.pyne_backends.worker.bound).toBe(false);
  });
});
