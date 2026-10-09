// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, test } from "bun:test";
import {
  BILLING_UPGRADE_URL,
  clearVerifyCache,
  sha256Hex,
  verifyCacheKey,
  verifyTenant,
  type VerifyFetchFn,
} from "../src/lib/verify";
import { authorizeRequest, scopeForPath } from "../src/lib/auth";

type KVStore = Map<string, { value: string; expSec?: number }>;

function mockKV(store: KVStore = new Map()) {
  return {
    store,
    async get(key: string, _type: "json"): Promise<unknown> {
      const e = store.get(key);
      if (!e) return null;
      if (e.expSec !== undefined && e.expSec * 1000 <= Date.now()) {
        store.delete(key);
        return null;
      }
      return JSON.parse(e.value) as unknown;
    },
    async put(
      key: string,
      value: string,
      opts?: { expirationTtl?: number }
    ): Promise<void> {
      const ttl = opts?.expirationTtl ?? 60;
      store.set(key, { value, expSec: Math.floor(Date.now() / 1000) + ttl });
    },
  };
}

function mockEnv(
  fetchFn: VerifyFetchFn,
  extra?: Record<string, unknown>
): { env: Env; kv: ReturnType<typeof mockKV>; calls: Array<{ url: string; init?: RequestInit }>; via: VerifyFetchFn } {
  const kv = mockKV();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const via: VerifyFetchFn = async (url, init) => {
    calls.push({ url, init });
    return fetchFn(url, init);
  };
  const env = {
    CONSOLE_URL: "https://console.hoox.sh",
    TENANT_KEYS: kv,
    API_KEY: "good",
    ...extra,
  } as unknown as Env;
  return { env, kv, calls, via };
}

const okJson = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  clearVerifyCache();
});

describe("sha256Hex", () => {
  test("matches known vector (Workers/node parity)", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("scopeForPath", () => {
  test("billable REST routes require agent:chat", () => {
    expect(scopeForPath("/v1/chat")).toBe("agent:chat");
    expect(scopeForPath("/v1/search")).toBe("agent:chat");
    expect(scopeForPath("/v1/kb/search")).toBe("agent:chat");
    expect(scopeForPath("/v1/sessions")).toBe("agent:chat");
    expect(scopeForPath("/v1/sessions/abc")).toBe("agent:chat");
  });
});

describe("verifyTenant", () => {
  test("hash on wire: Authorization is hex hash, never the raw key", async () => {
    const raw = "hx_live_wiretest001";
    const t = mockEnv(async () =>
      okJson({ valid: true, tid: "t_1", plan: "pro", scopes: ["agent:chat"], limits: {} })
    );
    const res = await verifyTenant(t.env, raw, "agent:chat", {
      fetchFn: t.via,
    });
    expect(res.ok).toBe(true);
    expect(t.calls).toHaveLength(1);
    const auth = (t.calls[0]?.init?.headers as Record<string, string>)?.Authorization;
    const expected = await sha256Hex(raw);
    expect(auth).toBe(`Bearer ${expected}`);
    expect(auth).toMatch(/^Bearer [0-9a-f]{64}$/);
    expect(auth).not.toContain("hx_live_");
    expect(t.calls[0]?.url).toContain("/api/v1/verify?scope=agent%3Achat");
  });

  test("cache hit skips fetch (L1)", async () => {
    let n = 0;
    const t = mockEnv(async () => {
      n++;
      return okJson({ tid: "t_1", plan: "pro", scopes: ["agent:chat"], limits: null });
    });
    const raw = "hx_live_cachehit001";
    const first = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    const second = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(n).toBe(1);
    expect(t.calls).toHaveLength(1);
    if (second.ok) expect(second.cached).toBe(true);
  });

  test("KV L2 hit skips fetch", async () => {
    const raw = "hx_live_kvhit001";
    const hash = await sha256Hex(raw);
    const t = mockEnv(async () => {
      throw new Error("must not fetch");
    });
    const entry = {
      tid: "t_kv",
      plan: "edge",
      scopes: ["agent:chat"],
      limits: null,
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    t.kv.store.set(verifyCacheKey(hash), { value: JSON.stringify(entry) });
    const res = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tid).toBe("t_kv");
      expect(res.cached).toBe(true);
    }
    expect(t.calls).toHaveLength(0);
  });

  test("negative cache: 401 twice, fetch once", async () => {
    let n = 0;
    const t = mockEnv(async () => {
      n++;
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    });
    const raw = "hx_live_negative001";
    const a = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    const b = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("INVALID_KEY");
    if (!b.ok) {
      expect(b.code).toBe("INVALID_KEY");
      expect(b.status).toBe(401);
    }
    expect(n).toBe(1);
  });

  test("unavailable negative cache: transport outage fetches once (2nd skips fetch)", async () => {
    let n = 0;
    const t = mockEnv(async () => {
      n++;
      throw new Error("boom");
    });
    const raw = "hx_live_outageneg001";
    const a = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    const b = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) {
      expect(a.code).toBe("VERIFY_UNAVAILABLE");
      expect(a.status).toBe(503);
    }
    if (!b.ok) {
      expect(b.code).toBe("VERIFY_UNAVAILABLE");
      expect(b.status).toBe(503);
    }
    expect(n).toBe(1);
    expect(t.calls).toHaveLength(1);
  });

  test("unavailable negative cache: console 500 fetches once", async () => {
    let n = 0;
    const t = mockEnv(async () => {
      n++;
      return new Response(JSON.stringify({ error: "oops" }), { status: 500 });
    });
    const raw = "hx_live_outageneg500";
    const a = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    const b = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.code).toBe("VERIFY_UNAVAILABLE");
      expect(b.status).toBe(503);
    }
    expect(n).toBe(1);
  });

  test("unavailable negative cache: bad JSON fetches once", async () => {
    let n = 0;
    const t = mockEnv(async () => {
      n++;
      return new Response("not-json{{{", { status: 200 });
    });
    const raw = "hx_live_outagenegjson";
    const a = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    const b = await verifyTenant(t.env, raw, "agent:chat", { fetchFn: t.via });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe("VERIFY_UNAVAILABLE");
    expect(n).toBe(1);
  });

  test("client-side scope check rejects even when console says 200", async () => {
    const t = mockEnv(async () =>
      okJson({ valid: true, tid: "t_1", plan: "free", scopes: ["trade"], limits: null })
    );
    const res = await verifyTenant(t.env, "hx_live_scopemismatch001", "agent:chat", {
      fetchFn: t.via,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("ENTITLEMENT_REQUIRED");
      expect(res.status).toBe(402);
    }
  });
});

describe("authorizeRequest", () => {
  test("console 403 → 402 shape with upgrade URL", async () => {
    const t = mockEnv(async () =>
      new Response(JSON.stringify({ error: "Missing required scope" }), { status: 403 })
    );
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { Authorization: "Bearer hx_live_entitle001" },
    });
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      fetchFn: t.via,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(402);
      expect(res.code).toBe("ENTITLEMENT_REQUIRED");
      expect(res.upgrade).toBe(BILLING_UPGRADE_URL);
      expect(res.upgrade).toContain("console.hoox.sh/billing");
    }
  });

  test("console 429 passes through with Retry-After", async () => {
    const t = mockEnv(async () =>
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "Retry-After": "7" },
      })
    );
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { Authorization: "Bearer hx_live_limited001" },
    });
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      fetchFn: t.via,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(429);
      expect(res.code).toBe("RATE_LIMITED");
      expect(res.retryAfter).toBe(7);
    }
  });

  test("legacy single-key path unchanged (no fetch)", async () => {
    const t = mockEnv(async () => {
      throw new Error("must not fetch");
    });
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { "X-API-Key": "good" },
    });
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      fetchFn: t.via,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.tenantPassthrough).toBe(false);
    expect(t.calls).toHaveLength(0);
  });

  test("open mode unchanged (no API_KEY, no key, no fetch)", async () => {
    const t = mockEnv(
      async () => {
        throw new Error("must not fetch");
      },
      { API_KEY: "" }
    );
    const res = await authorizeRequest(new Request("https://x/v1/chat"), t.env, {
      scope: "agent:chat",
      fetchFn: t.via,
    });
    expect(res.ok).toBe(true);
    expect(t.calls).toHaveLength(0);
  });

  test("console unreachable + HX_ALLOW_SELFHOST match → degraded allow", async () => {
    const t = mockEnv(
      async () => {
        throw new Error("boom");
      },
      { HX_ALLOW_SELFHOST: "good" }
    );
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { Authorization: "Bearer hx_live_degraded001" },
    });
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      fetchFn: t.via,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.degraded).toBe(true);
      expect(res.tenantPassthrough).toBe(true);
    }
  });

  test("console unreachable without opt-in → 503, never fail-open", async () => {
    const t = mockEnv(async () => {
      throw new Error("boom");
    });
    const req = new Request("https://x/v1/chat", {
      method: "POST",
      headers: { Authorization: "Bearer hx_live_outage001" },
    });
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      fetchFn: t.via,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.code).toBe("VERIFY_UNAVAILABLE");
    }
  });

  test("MCP gate: forged hx_live_… with console 401 → 401 INVALID_KEY", async () => {
    // Regression: /mcp + /agents/* used the sync requireAuth passthrough,
    // which accepted ANY hx_live_… shape without live verify. Both gates now
    // run the same async authorizeRequest(scope agent:chat) as REST.
    const t = mockEnv(async () => {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    });
    const req = new Request("https://x/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer hx_live_fake" },
    });
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      fetchFn: t.via,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.code).toBe("INVALID_KEY");
    }
    expect(t.calls).toHaveLength(1);
  });

  test("agents WS gate: ?api_key= query key verifies live (valid → ok)", async () => {
    const t = mockEnv(async () =>
      okJson({ valid: true, tid: "t_ws", plan: "pro", scopes: ["agent:chat"], limits: null })
    );
    const req = new Request(
      "https://x/agents/pyne-agent/sess123?api_key=hx_live_wsquery001",
      { headers: { Upgrade: "websocket" } }
    );
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      allowQuery: true,
      fetchFn: t.via,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tenantPassthrough).toBe(true);
      expect(res.tenant?.tid).toBe("t_ws");
    }
    expect(t.calls).toHaveLength(1);
    // Hash on wire even for query-provided keys — never the raw key.
    const auth = (t.calls[0]?.init?.headers as Record<string, string>)
      ?.Authorization;
    expect(auth).toMatch(/^Bearer [0-9a-f]{64}$/);
    expect(auth).not.toContain("hx_live_");
  });

  test("agents WS gate: forged ?api_key= query key → 401", async () => {
    const t = mockEnv(async () => {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    });
    const req = new Request(
      "https://x/agents/pyne-agent/sess123?api_key=hx_live_wsfake002",
      { headers: { Upgrade: "websocket" } }
    );
    const res = await authorizeRequest(req, t.env, {
      scope: "agent:chat",
      allowQuery: true,
      fetchFn: t.via,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.code).toBe("INVALID_KEY");
    }
  });
});
