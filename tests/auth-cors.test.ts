// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { extractApiKey, requireAuth } from "../src/lib/auth";
import { corsHeaders, parseOrigins } from "../src/lib/cors";

describe("auth", () => {
  test("extracts X-API-Key", () => {
    const r = new Request("https://x", {
      headers: { "X-API-Key": " secret " },
    });
    expect(extractApiKey(r)).toBe("secret");
  });

  test("extracts Bearer", () => {
    const r = new Request("https://x", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(extractApiKey(r)).toBe("tok");
  });

  test("open mode when no API_KEY", () => {
    const env = { API_KEY: "" } as Env;
    expect(requireAuth(new Request("https://x"), env).ok).toBe(true);
  });

  test("rejects bad key", () => {
    const env = { API_KEY: "good" } as Env;
    const r = new Request("https://x", { headers: { "X-API-Key": "bad" } });
    const res = requireAuth(r, env);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });
});

describe("cors", () => {
  test("parseOrigins merges defaults", () => {
    const o = parseOrigins("https://custom.example");
    expect(o).toContain("https://custom.example");
    expect(o).toContain("https://axis.hoox.sh");
  });

  test("reflects allowlisted origin", () => {
    const req = new Request("https://x", {
      headers: { Origin: "https://axis.hoox.sh" },
    });
    const h = corsHeaders(req, ["https://axis.hoox.sh", "http://localhost:8081"]);
    expect(h["Access-Control-Allow-Origin"]).toBe("https://axis.hoox.sh");
  });

  test("plugin CORS is wildcard for dynamic import", async () => {
    const { pluginCorsHeaders } = await import("../src/lib/cors");
    expect(pluginCorsHeaders()["Access-Control-Allow-Origin"]).toBe("*");
  });
});
