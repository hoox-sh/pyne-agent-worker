// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, test } from "bun:test";
import { handleChat } from "../src/routes/chat";
import {
  clearUsageQueue,
  flushUsageQueue,
  peekUsageQueue,
  queueUsageEvent,
  usageQueueDepth,
  USAGE_BATCH_MAX,
} from "../src/lib/usage";
import { sha256Hex } from "../src/lib/verify";

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(
  calls: FetchCall[],
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return responder(url, init);
  };
}

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function usageEnv(extra?: Record<string, unknown>): Env {
  return {
    CONSOLE_URL: "https://console.hoox.sh",
    ...extra,
  } as unknown as Env;
}

function chatEnv(): { env: Env } {
  const env = {
    CONSOLE_URL: "https://console.hoox.sh",
    AI: {
      run: async () => ({
        response:
          "here you go\n```pine\n//@version=6\nindicator('t')\nplot(close)\n```",
      }),
    },
  } as unknown as Env;
  return { env };
}

beforeEach(() => {
  clearUsageQueue();
});

describe("queueUsageEvent", () => {
  test("queues agent:chat generation event with idem format", () => {
    const ev = queueUsageEvent({
      tid: "t_123",
      scope: "agent:chat",
      units: { generations: 1 },
      keyHash16: "9f2ac4110be3d4e5",
    });
    expect(ev).not.toBeNull();
    expect(ev?.tid).toBe("t_123");
    expect(ev?.scope).toBe("agent:chat");
    expect(ev?.units).toEqual({ generations: 1 });
    expect(ev?.idem).toMatch(/^\d{4}-\d{2}-\d{2}:[0-9a-f]{16}:\d+$/);
    expect(ev?.idem).toContain("9f2ac4110be3d4e5");
    expect(usageQueueDepth()).toBe(1);
  });

  test("counter increments so idems never collide", () => {
    const a = queueUsageEvent({ tid: "t_1", keyHash16: "aaaaaaaaaaaaaaaa" });
    const b = queueUsageEvent({ tid: "t_1", keyHash16: "aaaaaaaaaaaaaaaa" });
    expect(a?.idem).not.toBe(b?.idem);
  });

  test("kbBytes passes through when retrieval ran", () => {
    const ev = queueUsageEvent({
      tid: "t_kb",
      units: { generations: 1, kbBytes: 1234 },
      keyHash16: "bbbbbbbbbbbbbbbb",
    });
    expect(ev?.units).toEqual({ generations: 1, kbBytes: 1234 });
  });

  test("tid mismatch dropped: empty and unknown never queue", () => {
    expect(queueUsageEvent({ tid: "", keyHash16: "cccccccccccccccc" })).toBeNull();
    expect(queueUsageEvent({ tid: "   ", keyHash16: "cccccccccccccccc" })).toBeNull();
    expect(queueUsageEvent({ tid: "unknown", keyHash16: "cccccccccccccccc" })).toBeNull();
    expect(usageQueueDepth()).toBe(0);
  });
});

describe("flushUsageQueue", () => {
  test("payload shape: POST {CONSOLE_URL}/api/v1/usage {events:[...]} with Bearer", async () => {
    const calls: FetchCall[] = [];
    queueUsageEvent({ tid: "t_1", units: { generations: 1 }, keyHash16: "dddddddddddddddd" });
    const n = await flushUsageQueue(usageEnv(), "svc-key-123", {
      fetchFn: mockFetch(calls, () => okJson({ ok: true })),
    });
    expect(n).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://console.hoox.sh/api/v1/usage");
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer svc-key-123");
    const body = JSON.parse(String(init?.body)) as {
      events: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.["tid"]).toBe("t_1");
    expect(body.events[0]?.["scope"]).toBe("agent:chat");
    expect(body.events[0]?.["units"]).toEqual({ generations: 1 });
    expect(body.events[0]?.["idem"]).toMatch(/^\d{4}-\d{2}-\d{2}:/);
    expect(usageQueueDepth()).toBe(0);
  });

  test("hash-on-wire: Authorization is hex hash, raw key never sent", async () => {
    const raw = "hx_live_usagewire001";
    const hash = await sha256Hex(raw);
    const calls: FetchCall[] = [];
    queueUsageEvent({ tid: "t_wire", keyHash16: hash.slice(0, 16) });
    await flushUsageQueue(usageEnv(), hash, {
      fetchFn: mockFetch(calls, () => okJson({ ok: true })),
    });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${hash}`);
    expect(headers["Authorization"]).toMatch(/^Bearer [0-9a-f]{64}$/);
    const wire = `${calls[0]?.url} ${headers["Authorization"]} ${String(calls[0]?.init?.body)}`;
    expect(wire).not.toContain(raw);
    expect(wire).not.toContain("hx_live_");
  });

  test("USAGE_SERVICE_KEY env fallback when no explicit auth", async () => {
    const calls: FetchCall[] = [];
    queueUsageEvent({ tid: "t_svc" });
    const n = await flushUsageQueue(
      usageEnv({ USAGE_SERVICE_KEY: "env-service-key" }),
      undefined,
      { fetchFn: mockFetch(calls, () => okJson({ ok: true })) }
    );
    expect(n).toBe(1);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer env-service-key");
  });

  test("failure swallowed: console 500 drops lossy, returns 0, never throws", async () => {
    const calls: FetchCall[] = [];
    queueUsageEvent({ tid: "t_fail" });
    const n = await flushUsageQueue(usageEnv(), "k", {
      fetchFn: mockFetch(calls, () => new Response("boom", { status: 500 })),
    });
    expect(n).toBe(0);
    expect(calls).toHaveLength(1);
    expect(usageQueueDepth()).toBe(0);
  });

  test("transport failure swallowed, never throws", async () => {
    queueUsageEvent({ tid: "t_net" });
    const n = await flushUsageQueue(usageEnv(), "k", {
      fetchFn: async () => {
        throw new Error("network down");
      },
    });
    expect(n).toBe(0);
    expect(usageQueueDepth()).toBe(0);
  });

  test("batch cap: 60 queued flushes 50, retains 10", async () => {
    const calls: FetchCall[] = [];
    for (let i = 0; i < 60; i++) {
      queueUsageEvent({ tid: `t_${i}`, keyHash16: "eeeeeeeeeeeeeeee" });
    }
    expect(USAGE_BATCH_MAX).toBe(50);
    const fetchFn = mockFetch(calls, () => okJson({ ok: true }));
    const first = await flushUsageQueue(usageEnv(), "k", { fetchFn });
    expect(first).toBe(50);
    expect(calls).toHaveLength(1);
    const firstBody = JSON.parse(String(calls[0]?.init?.body)) as {
      events: unknown[];
    };
    expect(firstBody.events).toHaveLength(50);
    expect(usageQueueDepth()).toBe(10);
    const second = await flushUsageQueue(usageEnv(), "k", { fetchFn });
    expect(second).toBe(10);
    expect(usageQueueDepth()).toBe(0);
  });

  test("207 multi-status: ok counted, quota_exceeded dropped with warn (no requeue)", async () => {
    const calls: FetchCall[] = [];
    queueUsageEvent({ tid: "t_a", keyHash16: "ffffffffffffffff" });
    queueUsageEvent({ tid: "t_b", keyHash16: "ffffffffffffffff" });
    const n = await flushUsageQueue(usageEnv(), "k", {
      fetchFn: mockFetch(calls, () =>
        okJson({ results: [{ ok: true }, { ok: false, code: "quota_exceeded" }] }, 207)
      ),
    });
    expect(calls[0]?.url).toContain("/api/v1/usage");
    expect(n).toBe(1);
    // Lossy: nothing requeued even though one event was rejected.
    expect(usageQueueDepth()).toBe(0);
    expect(peekUsageQueue()).toHaveLength(0);
  });

  test("no CONSOLE_URL retains queue (no network attempted)", async () => {
    let called = 0;
    queueUsageEvent({ tid: "t_noconsole" });
    const n = await flushUsageQueue({} as Env, "k", {
      fetchFn: async () => {
        called++;
        return okJson({});
      },
    });
    expect(n).toBe(0);
    expect(called).toBe(0);
    expect(usageQueueDepth()).toBe(1);
  });
});

describe("chat metering wire", () => {
  test("chat still 200 when console 500 (metering never fails chat)", async () => {
    const { env } = chatEnv();
    const usageCalls: FetchCall[] = [];
    const usageFetch = mockFetch(usageCalls, () => new Response("boom", { status: 500 }));
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "rsi indicator", no_rag: true, validate: false, persist: false }),
    });
    const res = await handleChat(req, env, {
      tid: "t_chat",
      keyHash16: "1234567890abcdef",
      authToken: "tenant-hash-wire",
      fetchFn: usageFetch,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    // Usage was attempted exactly once and dropped lossy.
    expect(usageCalls).toHaveLength(1);
    expect(usageQueueDepth()).toBe(0);
  });

  test("chat without tid never touches console", async () => {
    const { env } = chatEnv();
    const usageCalls: FetchCall[] = [];
    const usageFetch = mockFetch(usageCalls, () => okJson({ ok: true }));
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "rsi indicator", no_rag: true, validate: false, persist: false }),
    });
    const res = await handleChat(req, env, { fetchFn: usageFetch });
    expect(res.status).toBe(200);
    expect(usageCalls).toHaveLength(0);
    expect(usageQueueDepth()).toBe(0);
  });

  test("chat queues generations:1 without kbBytes when RAG skipped", async () => {
    const { env } = chatEnv();
    const usageCalls: FetchCall[] = [];
    const usageFetch = mockFetch(usageCalls, () => okJson({ ok: true }));
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "rsi indicator", no_rag: true, validate: false, persist: false }),
    });
    await handleChat(req, env, {
      tid: "t_norag",
      keyHash16: "abcdef1234567890",
      authToken: "h",
      fetchFn: usageFetch,
    });
    expect(usageCalls).toHaveLength(1);
    const body = JSON.parse(String(usageCalls[0]?.init?.body)) as {
      events: Array<{ tid: string; scope: string; units: Record<string, unknown>; idem: string }>;
    };
    expect(body.events[0]?.tid).toBe("t_norag");
    expect(body.events[0]?.scope).toBe("agent:chat");
    expect(body.events[0]?.units["generations"]).toBe(1);
    expect("kbBytes" in (body.events[0]?.units ?? {})).toBe(false);
  });

  test("chat uses ctx.waitUntil when available (non-blocking)", async () => {
    const { env } = chatEnv();
    const usageCalls: FetchCall[] = [];
    const usageFetch = mockFetch(usageCalls, () => okJson({ ok: true }));
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p) } as unknown as ExecutionContext;
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "rsi indicator", no_rag: true, validate: false, persist: false }),
    });
    const res = await handleChat(req, env, {
      tid: "t_bg",
      keyHash16: "1234567890abcdef",
      authToken: "h",
      ctx,
      fetchFn: usageFetch,
    });
    expect(res.status).toBe(200);
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(usageCalls).toHaveLength(1);
  });
});
