// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * API auth: X-API-Key or Authorization: Bearer <key>.
 * When API_KEY secret is unset, local/open mode is allowed (dev only).
 *
 * Phase 2: console-issued `hx_live_…` tenant keys verify live against
 * `{CONSOLE_URL}/api/v1/verify` (hash on wire, never the raw key) with a
 * KV + L1 cache (`src/lib/verify.ts`). Use `authorizeRequest` for the
 * scope-aware async path; `requireAuth` stays sync for classification and
 * legacy/open callers. Raw keys are never logged.
 */

import {
  BILLING_UPGRADE_URL,
  verifyTenant,
  type VerifyFetchFn,
} from "./verify";

export type ExtractApiKeyOpts = {
  /** Browser WebSocket cannot set Authorization; allow ?api_key= / ?key= only then. */
  allowQuery?: boolean;
};

/** Prefix for console-issued tenant keys (`hx_live_…`). */
export const TENANT_KEY_PREFIX = "hx_live_";

/** True for console-issued `hx_live_…` tenant keys (live verify). */
export function isTenantKey(
  key: string | null | undefined
): key is string {
  return (
    typeof key === "string" &&
    key.length > TENANT_KEY_PREFIX.length &&
    key.startsWith(TENANT_KEY_PREFIX)
  );
}

/** Classify an extracted key: tenant passthrough vs legacy shared secret. */
export function classifyApiKey(
  key: string | null | undefined
): "tenant" | "legacy" | null {
  if (!key) return null;
  return isTenantKey(key) ? "tenant" : "legacy";
}

export type AuthSuccess = {
  ok: true;
  tenantPassthrough: boolean;
  degraded?: boolean;
  tenant?: { tid: string; plan: string; scopes: string[] };
};
export type AuthFailure = {
  ok: false;
  status: number;
  error: string;
  code?: string;
  retryAfter?: number;
  upgrade?: string;
};
export type AuthResult = AuthSuccess | AuthFailure;

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.byteLength !== bb.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(aa, bb);
  }
  // Bun/Node tests: constant-time XOR (Workers runtime has subtle.timingSafeEqual).
  let out = 0;
  for (let i = 0; i < aa.byteLength; i++) out |= aa[i]! ^ bb[i]!;
  return out === 0;
}

export function extractApiKey(
  request: Request,
  opts?: ExtractApiKeyOpts
): string | null {
  const header = request.headers.get("X-API-Key");
  if (header && header.trim()) return header.trim();

  const auth = request.headers.get("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token || null;
  }

  if (opts?.allowQuery) {
    try {
      const url = new URL(request.url);
      const q = url.searchParams.get("api_key") || url.searchParams.get("key");
      if (q && q.trim()) return q.trim();
    } catch {
      /* ignore malformed URL */
    }
  }
  return null;
}

export function requireAuth(
  request: Request,
  env: Env,
  opts?: ExtractApiKeyOpts
): AuthResult {
  const got = extractApiKey(request, opts);
  if (isTenantKey(got)) {
    // Sync classification only: tenant keys MUST go through the async
    // `authorizeRequest` live-verify path. This branch is kept so legacy
    // sync callers (MCP / Agents gates) retain passthrough behavior.
    return { ok: true, tenantPassthrough: true };
  }
  const expected = (env.API_KEY || "").trim();
  if (!expected) {
    // Open mode for local `wrangler dev` without secrets.
    return { ok: true, tenantPassthrough: false };
  }
  if (!got || !timingSafeEqualUtf8(got, expected)) {
    return { ok: false, status: 401, error: "Unauthorized: missing or invalid API key" };
  }
  return { ok: true, tenantPassthrough: false };
}

/** Required scope per REST route (Phase 2: all billable REST uses agent:chat). */
const SCOPE_BY_ROUTE: Array<[RegExp, string]> = [
  [/^\/v1\/chat$/, "agent:chat"],
  [/^\/v1\/search$/, "agent:chat"],
  [/^\/v1\/kb\/search$/, "agent:chat"],
  [/^\/v1\/sessions(\/.*)?$/, "agent:chat"],
];

export function scopeForPath(path: string): string {
  const p = path.replace(/\/+$/, "") || "/";
  for (const [re, scope] of SCOPE_BY_ROUTE) {
    if (re.test(p)) return scope;
  }
  return "agent:chat";
}

export type AuthorizeOpts = ExtractApiKeyOpts & {
  scope?: string;
  fetchFn?: VerifyFetchFn;
};

/**
 * Async auth: tenant `hx_live_…` keys verify live (KV + L1 cache, hash on
 * wire); legacy keys and open mode fall through to `requireAuth` unchanged.
 * Failures: 401 INVALID_KEY / 402 ENTITLEMENT_REQUIRED / 429 RATE_LIMITED /
 * 503 VERIFY_UNAVAILABLE. Raw keys are never logged.
 */
export async function authorizeRequest(
  request: Request,
  env: Env,
  opts?: AuthorizeOpts
): Promise<AuthResult> {
  const got = extractApiKey(request, opts);
  if (isTenantKey(got)) {
    const scope = opts?.scope ?? "agent:chat";
    const v = await verifyTenant(env, got, scope, { fetchFn: opts?.fetchFn });
    if (v.ok) {
      return {
        ok: true,
        tenantPassthrough: true,
        degraded: v.degraded,
        tenant: { tid: v.tid, plan: v.plan, scopes: v.scopes },
      };
    }
    if (v.code === "ENTITLEMENT_REQUIRED") {
      return {
        ok: false,
        status: 402,
        error: v.error,
        code: v.code,
        upgrade: BILLING_UPGRADE_URL,
      };
    }
    if (v.code === "RATE_LIMITED") {
      return {
        ok: false,
        status: 429,
        error: v.error,
        code: v.code,
        retryAfter: v.retryAfter,
      };
    }
    if (v.code === "VERIFY_UNAVAILABLE") {
      return { ok: false, status: 503, error: v.error, code: v.code };
    }
    return { ok: false, status: 401, error: v.error, code: v.code };
  }
  return requireAuth(request, env, opts);
}
