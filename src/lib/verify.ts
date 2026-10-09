// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Live tenant verify with KV + in-memory cache.
 *
 * Contract (Phase 2 thin slice):
 * - KV key `hx:{sha256hex(rawKey).slice(0, 16)}` →
 *   `{tid, plan, scopes, limits, exp}` (positive TTL 60s, negative 10s).
 * - L1 in-memory Map (30s, max 512 entries) in front of KV.
 * - Miss → `GET {CONSOLE_URL}/api/v1/verify?scope=<required>` with
 *   `Authorization: Bearer <sha256hex(rawKey)>`.
 *   NEVER the raw key on wire — console looks up by hash (matching
 *   `tenant-api.ts` `authenticateApiKey` hash comparison).
 * - Scope is enforced client-side too (console may ignore `?scope=`).
 * - No metering / usage flush here (next task). No change to chat/RAG/validate.
 * - Raw keys are never logged — hash prefix (`sha256[:8]`) only.
 * - Console outages (transport error / non-200 / bad JSON) are
 *   negative-cached in L1 for 10s (per key-hash + scope) so one outage does
 *   not hammer the console (or logs) on every request. Degraded self-host
 *   fail-open (`HX_ALLOW_SELFHOST` == `API_KEY`) is re-evaluated on every
 *   call, including negative-cache hits.
 */

export const VERIFY_POSITIVE_TTL_S = 60;
export const VERIFY_NEGATIVE_TTL_S = 10;

const L1_TTL_MS = 30_000;
const L1_MAX_ENTRIES = 512;

export const BILLING_UPGRADE_URL = "https://console.hoox.sh/billing";

export type VerifyLimits = Record<string, unknown> | null;

export type VerifySuccess = {
  ok: true;
  tid: string;
  plan: string;
  scopes: string[];
  limits: VerifyLimits;
  degraded?: boolean;
  cached?: boolean;
};

export type VerifyFailureCode =
  | "INVALID_KEY"
  | "ENTITLEMENT_REQUIRED"
  | "RATE_LIMITED"
  | "VERIFY_UNAVAILABLE";

export type VerifyFailure = {
  ok: false;
  code: VerifyFailureCode;
  status: number;
  error: string;
  retryAfter?: number;
};

export type VerifyResult = VerifySuccess | VerifyFailure;

export type VerifyCacheEntry = {
  tid: string;
  plan: string;
  scopes: string[];
  limits: VerifyLimits;
  /** Epoch seconds when this entry expires. */
  exp: number;
  /** Negative-cache marker (key unknown at console). */
  invalid?: boolean;
  /** Negative-cache marker (console outage — transport/non-200/bad JSON). L1 only. */
  unavailable?: boolean;
  /** Scope-verdict marker (key valid, required scope missing). L1 only. */
  entitlementRequired?: boolean;
};

export type VerifyFetchFn = (
  url: string,
  init?: RequestInit
) => Promise<Response>;

export type VerifyOptions = {
  /** Override for tests (defaults to global fetch — no network in unit tests). */
  fetchFn?: VerifyFetchFn;
};

/** SHA-256 hex via Workers `crypto.subtle`, `node:crypto` fallback (tests). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  try {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(input).digest("hex");
  }
}

/** Safe log reference: hash prefix only — never the raw key. */
export function keyRef(hashHex: string): string {
  return `hx:${hashHex.slice(0, 8)}`;
}

/** KV cache key: `hx:{sha256hex[:16]}`. */
export function verifyCacheKey(hashHex: string): string {
  return `hx:${hashHex.slice(0, 16)}`;
}

// L1: process-local Map with TTL + simple LRU eviction.
const l1 = new Map<string, VerifyCacheEntry>();

function l1Get(key: string, nowMs: number): VerifyCacheEntry | null {
  const v = l1.get(key);
  if (!v) return null;
  if (v.exp * 1000 <= nowMs) {
    l1.delete(key);
    return null;
  }
  l1.delete(key);
  l1.set(key, v);
  return v;
}

function l1Set(key: string, value: VerifyCacheEntry): void {
  // Cap L1 residency at L1_TTL_MS regardless of the KV TTL carried by exp.
  const capSec = Math.floor(Date.now() / 1000) + Math.floor(L1_TTL_MS / 1000);
  const capped: VerifyCacheEntry =
    value.exp > capSec ? { ...value, exp: capSec } : value;
  if (l1.has(key)) l1.delete(key);
  l1.set(key, capped);
  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next();
    if (oldest.done) break;
    l1.delete(oldest.value);
  }
}

/** Test hook: clear the in-memory verify cache. */
export function clearVerifyCache(): void {
  l1.clear();
}

function asCacheEntry(raw: unknown, nowSec: number): VerifyCacheEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["exp"] !== "number" || o["exp"] <= nowSec) return null;
  if (o["invalid"] === true) {
    return { tid: "", plan: "", scopes: [], limits: null, exp: o["exp"], invalid: true };
  }
  if (!Array.isArray(o["scopes"])) return null;
  const scopes = o["scopes"].filter(
    (s): s is string => typeof s === "string"
  );
  return {
    tid: typeof o["tid"] === "string" ? o["tid"] : "unknown",
    plan: typeof o["plan"] === "string" ? o["plan"] : "unknown",
    scopes,
    limits:
      o["limits"] !== null && typeof o["limits"] === "object"
        ? (o["limits"] as Record<string, unknown>)
        : null,
    exp: o["exp"],
  };
}

async function kvPut(
  env: Env,
  key: string,
  entry: VerifyCacheEntry,
  ttlSec: number
): Promise<void> {
  try {
    await env.TENANT_KEYS?.put(key, JSON.stringify(entry), {
      expirationTtl: ttlSec,
    });
  } catch {
    // Cache write-through failure must not fail auth.
  }
}

function invalidFailure(): VerifyFailure {
  return { ok: false, code: "INVALID_KEY", status: 401, error: "Invalid API key" };
}

function entitlementFailure(scope: string): VerifyFailure {
  return {
    ok: false,
    code: "ENTITLEMENT_REQUIRED",
    status: 402,
    error: `Entitlement required for scope '${scope}' — upgrade at ${BILLING_UPGRADE_URL}`,
  };
}

/**
 * Self-host fail-open opt-in: operator sets `HX_ALLOW_SELFHOST` equal to the
 * legacy `API_KEY`. Console outages then degrade instead of 503. This path is
 * NEVER available for tenant keys unless the operator explicitly opted in.
 */
function isSelfHostDegraded(env: Env): boolean {
  const allow = (env.HX_ALLOW_SELFHOST || "").trim();
  const expected = (env.API_KEY || "").trim();
  if (!allow || !expected || allow.length !== expected.length) return false;
  let out = 0;
  for (let i = 0; i < allow.length; i++) {
    out |= allow.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return out === 0;
}

function unavailable(
  env: Env,
  ref: string,
  scope: string,
  detail: string,
  cache?: { scopedKey: string; nowSec: number }
): VerifyResult {
  if (isSelfHostDegraded(env)) {
    console.warn(
      JSON.stringify({ type: "tenant_verify_degraded", key: ref, scope })
    );
    return {
      ok: true,
      tid: "selfhost",
      plan: "selfhost",
      scopes: [scope],
      limits: null,
      degraded: true,
    };
  }
  if (cache) {
    // Negative L1 entry (same 10s TTL as invalid keys): a console outage
    // must not trigger a live fetch (or warn log) on every request.
    // Keyed per key-hash + scope; degraded fail-open is re-evaluated on
    // hits, so operator opt-in still applies within the window.
    l1Set(cache.scopedKey, {
      tid: "",
      plan: "",
      scopes: [],
      limits: null,
      exp: cache.nowSec + VERIFY_NEGATIVE_TTL_S,
      unavailable: true,
    });
  }
  return {
    ok: false,
    code: "VERIFY_UNAVAILABLE",
    status: 503,
    error: `Tenant verify unavailable (${ref}): ${detail}`,
  };
}

/**
 * Verify a console-issued `hx_live_…` key for `requiredScope`.
 * L1 (30s) → KV `TENANT_KEYS` → live `GET {CONSOLE_URL}/api/v1/verify`.
 * Wire format sends the SHA-256 hex of the key, never the raw key.
 */
export async function verifyTenant(
  env: Env,
  rawKey: string,
  requiredScope: string,
  opts?: VerifyOptions
): Promise<VerifyResult> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const scope = requiredScope.trim() || "agent:chat";
  const hash = await sha256Hex(rawKey);
  const ref = keyRef(hash);
  const cacheKey = verifyCacheKey(hash);
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  // L1: per-scope verdicts — entitlement (key valid, scope missing) and
  // outage (console unreachable/non-200/bad JSON, 10s negative cache).
  // The outage hit re-runs unavailable() so degraded self-host fail-open
  // is re-evaluated instead of serving a stale 503.
  const scopedKey = `${cacheKey}|scope:${scope}`;
  const scoped = l1Get(scopedKey, nowMs);
  if (scoped && scoped.exp > nowSec) {
    if (scoped.entitlementRequired) return entitlementFailure(scope);
    if (scoped.unavailable) {
      return unavailable(env, ref, scope, "cached: console unavailable");
    }
  }

  // L1: positive / negative entry.
  const hit = l1Get(cacheKey, nowMs);
  if (hit && hit.exp > nowSec) {
    if (hit.invalid) return invalidFailure();
    if (!hit.scopes.includes(scope)) return entitlementFailure(scope);
    return {
      ok: true,
      tid: hit.tid,
      plan: hit.plan,
      scopes: hit.scopes,
      limits: hit.limits,
      cached: true,
    };
  }

  // L2: KV.
  try {
    const raw = env.TENANT_KEYS
      ? await env.TENANT_KEYS.get(cacheKey, "json")
      : null;
    const entry = asCacheEntry(raw, nowSec);
    if (entry) {
      l1Set(cacheKey, entry);
      if (entry.invalid) return invalidFailure();
      if (!entry.scopes.includes(scope)) return entitlementFailure(scope);
      return {
        ok: true,
        tid: entry.tid,
        plan: entry.plan,
        scopes: entry.scopes,
        limits: entry.limits,
        cached: true,
      };
    }
  } catch {
    // KV read failure falls through to live verify.
  }

  const base = (env.CONSOLE_URL || "").trim().replace(/\/+$/, "");
  if (!base) {
    console.warn(
      JSON.stringify({ type: "tenant_verify_no_console", key: ref, scope })
    );
    return unavailable(env, ref, scope, "CONSOLE_URL is not configured", {
      scopedKey,
      nowSec,
    });
  }

  const url = `${base}/api/v1/verify?scope=${encodeURIComponent(scope)}`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "GET",
      headers: {
        // Hash on wire only — console looks up by hash.
        Authorization: `Bearer ${hash}`,
        Accept: "application/json",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      JSON.stringify({
        type: "tenant_verify_unreachable",
        key: ref,
        scope,
        error: msg,
      })
    );
    return unavailable(env, ref, scope, "console unreachable", {
      scopedKey,
      nowSec,
    });
  }

  if (res.status === 401) {
    const entry: VerifyCacheEntry = {
      tid: "",
      plan: "",
      scopes: [],
      limits: null,
      exp: nowSec + VERIFY_NEGATIVE_TTL_S,
      invalid: true,
    };
    l1Set(cacheKey, entry);
    await kvPut(env, cacheKey, entry, VERIFY_NEGATIVE_TTL_S);
    return invalidFailure();
  }

  if (res.status === 403) {
    // Key valid, required scope missing. Cache the verdict in L1 only
    // (the key itself is valid for other scopes — never KV-negative it).
    l1Set(scopedKey, {
      tid: "",
      plan: "",
      scopes: [],
      limits: null,
      exp: nowSec + VERIFY_POSITIVE_TTL_S,
      entitlementRequired: true,
    });
    return entitlementFailure(scope);
  }

  if (res.status === 429) {
    const rawRetry = res.headers.get("Retry-After");
    const parsed = rawRetry !== null ? Number(rawRetry) : NaN;
    return {
      ok: false,
      code: "RATE_LIMITED",
      status: 429,
      error: "Rate limited — retry shortly",
      retryAfter: Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined,
    };
  }

  if (res.status !== 200) {
    console.warn(
      JSON.stringify({
        type: "tenant_verify_bad_status",
        key: ref,
        scope,
        status: res.status,
      })
    );
    return unavailable(env, ref, scope, `console status ${res.status}`, {
      scopedKey,
      nowSec,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    console.warn(
      JSON.stringify({ type: "tenant_verify_bad_json", key: ref, scope })
    );
    return unavailable(env, ref, scope, "console returned invalid JSON", {
      scopedKey,
      nowSec,
    });
  }

  // Tolerant parse: future full shape {tid, plan, scopes, limits} and the
  // current console shape {valid: true, scopes}.
  const scopesRaw = body["scopes"];
  const scopes = Array.isArray(scopesRaw)
    ? scopesRaw.filter((s): s is string => typeof s === "string")
    : [];
  const tid =
    typeof body["tid"] === "string"
      ? body["tid"]
      : typeof body["user_id"] === "string"
        ? body["user_id"]
        : "unknown";
  const plan = typeof body["plan"] === "string" ? body["plan"] : "unknown";
  const limits =
    body["limits"] !== null &&
    body["limits"] !== undefined &&
    typeof body["limits"] === "object"
      ? (body["limits"] as Record<string, unknown>)
      : null;

  // Client-side scope enforcement (console may ignore `?scope=`).
  if (!scopes.includes(scope)) {
    l1Set(scopedKey, {
      tid,
      plan,
      scopes,
      limits,
      exp: nowSec + VERIFY_POSITIVE_TTL_S,
      entitlementRequired: true,
    });
    return entitlementFailure(scope);
  }

  const entry: VerifyCacheEntry = {
    tid,
    plan,
    scopes,
    limits,
    exp: nowSec + VERIFY_POSITIVE_TTL_S,
  };
  l1Set(cacheKey, entry);
  await kvPut(env, cacheKey, entry, VERIFY_POSITIVE_TTL_S);
  return { ok: true, tid, plan, scopes, limits };
}
