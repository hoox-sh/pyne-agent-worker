// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AXIS MCP client: config, JSON-RPC transport, tools, run/app helpers,
 * and validate-loop backend selection. fetch is stubbed per test.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetAxisToolsCache,
  axisApp,
  axisMcpCallTool,
  axisMcpListTools,
  axisMcpStatus,
  axisRpc,
  isAxisMcpConfigured,
  isCallableAxisTool,
  validateOnAxisMcp,
} from "../src/axis/mcp-client";
import { generateValidateRetry } from "../src/rag/validate-loop";

const ENV = { AXIS_MCP_URL: "https://axis.test/mcp" } as Env;

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    return handler(String(url), init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function rpcOk(result: unknown, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result }, { status });
}

function rpcErr(message: string, code = -32602): Response {
  return Response.json(
    { jsonrpc: "2.0", id: 1, error: { code, message } },
    { status: 200 }
  );
}

beforeEach(() => {
  _resetAxisToolsCache();
});

describe("config", () => {
  test("unconfigured without URL", () => {
    expect(isAxisMcpConfigured({} as Env)).toBe(false);
  });

  test("rejects non-http schemes", () => {
    expect(isAxisMcpConfigured({ AXIS_MCP_URL: "ftp://x" } as Env)).toBe(false);
  });

  test("accepts https URL", () => {
    expect(isAxisMcpConfigured(ENV)).toBe(true);
  });

  test("unconfigured RPC names the fix", async () => {
    const r = await axisRpc({} as Env, "tools/call", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/AXIS_MCP_URL/);
  });
});

describe("transport", () => {
  test("tools/call joins text parts", async () => {
    const restore = mockFetch(() =>
      rpcOk({
        content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }],
        structuredContent: { ok: true },
      })
    );
    try {
      const r = await axisMcpCallTool(ENV, "axis_health", {});
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.text).toBe("hello\nworld");
        expect(r.structured).toEqual({ ok: true });
      }
    } finally {
      restore();
    }
  });

  test("JSON-RPC error maps to ok:false with code", async () => {
    const restore = mockFetch(() => rpcErr("Unknown tool: nope", -32601));
    try {
      const r = await axisMcpCallTool(ENV, "nope", {});
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/Unknown tool/);
        expect(r.code).toBe(-32601);
      }
    } finally {
      restore();
    }
  });

  test("HTTP errors surface status", async () => {
    const restore = mockFetch(() => new Response("nope", { status: 500 }));
    try {
      const r = await axisMcpCallTool(ENV, "axis_health", {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(500);
    } finally {
      restore();
    }
  });

  test("transport throw becomes ok:false", async () => {
    const restore = mockFetch(() => {
      throw new Error("boom");
    });
    try {
      const r = await axisMcpCallTool(ENV, "axis_health", {});
      expect(r.ok).toBe(false);
    } finally {
      restore();
    }
  });

  test("long text is truncated with marker", async () => {
    const restore = mockFetch(() =>
      rpcOk({ content: [{ type: "text", text: "x".repeat(7000) }] })
    );
    try {
      const r = await axisMcpCallTool(ENV, "axis_health", {});
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.truncated).toBe(true);
        expect(r.text).toMatch(/truncated/);
      }
    } finally {
      restore();
    }
  });

  test("suspicious tool names are refused client-side", async () => {
    let called = 0;
    const restore = mockFetch(() => {
      called += 1;
      return rpcOk({});
    });
    try {
      expect(isCallableAxisTool("../evil")).toBe(false);
      expect(isCallableAxisTool("has space")).toBe(false);
      const r = await axisMcpCallTool(ENV, "../evil", {});
      expect(r.ok).toBe(false);
      expect(called).toBe(0);
    } finally {
      restore();
    }
  });
});

describe("tools/list", () => {
  test("returns names and caches", async () => {
    let calls = 0;
    const restore = mockFetch(() => {
      calls += 1;
      return rpcOk({
        tools: [
          { name: "axis_run", description: "Run pine" },
          { name: "app_invoke", description: "Drive PWA" },
        ],
      });
    });
    try {
      const first = await axisMcpListTools(ENV);
      const second = await axisMcpListTools(ENV);
      expect(first.map((t) => t.name)).toEqual(["axis_run", "app_invoke"]);
      expect(second).toEqual(first);
      expect(calls).toBe(1);
    } finally {
      restore();
    }
  });

  test("empty when unreachable", async () => {
    const restore = mockFetch(() => new Response("down", { status: 503 }));
    try {
      expect(await axisMcpListTools(ENV)).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe("app plane", () => {
  test("invalid capability rejected client-side", async () => {
    const r = await axisApp(ENV, { capability: "nope" });
    expect(r.ok).toBe(false);
  });

  test("status reports unconfigured clearly", async () => {
    const s = await axisMcpStatus({} as Env);
    expect(s.configured).toBe(false);
    expect(s.reachable).toBe(false);
    expect(s.error).toMatch(/AXIS_MCP_URL/);
  });

  test("status reachable with tool count + bridge", async () => {
    const restore = mockFetch((_url, init) => {
      const body = JSON.parse(String((init?.body as string) || "{}")) as {
        method?: string;
        params?: { name?: string };
      };
      if (body.method === "initialize") {
        return rpcOk({ serverInfo: { name: "axis" }, protocolVersion: "2025-03-26" });
      }
      if (body.method === "tools/list") {
        return rpcOk({ tools: [{ name: "axis_run", description: "x" }] });
      }
      return rpcOk({
        content: [{ type: "text", text: JSON.stringify({ connected: 2 }) }],
      });
    });
    try {
      const s = await axisMcpStatus(ENV);
      expect(s.configured).toBe(true);
      expect(s.reachable).toBe(true);
      expect(s.server).toBe("axis");
      expect(s.tools).toBe(1);
      expect(s.bridge_connected).toBe(2);
    } finally {
      restore();
    }
  });
});

describe("validate via AXIS", () => {
  test("skipped when unconfigured", async () => {
    const r = await validateOnAxisMcp({} as Env, { script: "indicator('x')" });
    expect(r.skipped).toBe(true);
    expect(r.backend).toBe("axis-mcp");
  });

  test("ok on clean engine result", async () => {
    const restore = mockFetch(() =>
      rpcOk({
        content: [{ type: "text", text: '{"plots": 2, "events": 0}' }],
        structuredContent: { ok: true, plots: 2 },
      })
    );
    try {
      const r = await validateOnAxisMcp(ENV, {
        script: "//@version=6\nindicator('x')\nplot(close)",
      });
      expect(r.ok).toBe(true);
      expect(r.backend).toBe("axis-mcp");
    } finally {
      restore();
    }
  });

  test("retry loop uses AXIS backend when pyne-worker absent", async () => {
    const restore = mockFetch(() =>
      rpcOk({
        content: [{ type: "text", text: '{"plots": 1}' }],
        structuredContent: { ok: true },
      })
    );
    try {
      const out = await generateValidateRetry({
        env: ENV,
        messages: [{ role: "user", content: "rsi indicator" }],
        chatFn: async () => ({
          text: "Here:\n```pine\n//@version=6\nindicator('RSI')\nplot(ta.rsi(close, 14))\n```",
          model: "test",
          latencyMs: 1,
        }),
      });
      expect(out.validated).toBe(true);
      expect(out.validation?.backend).toBe("axis-mcp");
      expect(out.retries).toBe(0);
    } finally {
      restore();
    }
  });
});
