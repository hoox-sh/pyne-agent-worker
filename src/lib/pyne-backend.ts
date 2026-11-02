// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Named PYNE evaluate hosts. The client sends a kind, never a URL.
 *
 * Dialects:
 * - worker: `{ script, ohlcv, symbol, timeframe }` (pyne-worker)
 * - flask: `{ script, data }` (Pro / local / container) — RUN_SCHEMA rejects extras
 */

import { syntheticBars } from "./synthetic-bars";
import { pynePostJson } from "./pyne-http";
import type { ValidateOpts, ValidateResult } from "./pyne-worker";

export const PYNE_BACKEND_KINDS = [
  "auto",
  "pro",
  "local",
  "worker",
  "container",
  "none",
] as const;

export type PyneBackendKind = (typeof PYNE_BACKEND_KINDS)[number];

export type PyneDialect = "flask" | "worker";

export type PyneLanguageSurface = "ast" | "lsp" | "none";

export type ResolvedPyneBackend = {
  kind: Exclude<PyneBackendKind, "auto">;
  dialect: PyneDialect | "none";
  /** Full POST /run URL, or null when using the service binding. */
  url: string | null;
  /** Origin without /run (for /ast/* or /lsp/*). */
  origin: string | null;
  useService: boolean;
  auth: { header: string; value: string } | null;
  eval: boolean;
  /** Language ops: worker /ast/* (flagged) or Flask /lsp/diagnostics. */
  language: PyneLanguageSurface;
  reason?: string;
};

const BACKEND_LABEL: Record<Exclude<PyneBackendKind, "auto">, string> = {
  pro: "pyne-pro",
  local: "pyne-local",
  worker: "pyne-worker",
  container: "pyne-container",
  none: "none",
};

export function parsePyneBackend(raw: unknown): PyneBackendKind | null {
  if (raw == null || raw === "") return "auto";
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return (PYNE_BACKEND_KINDS as readonly string[]).includes(s)
    ? (s as PyneBackendKind)
    : null;
}

export function envPyneBackend(env: Env): PyneBackendKind {
  return parsePyneBackend(env.PYNE_BACKEND) || "auto";
}

function trimUrl(raw: unknown): string {
  return String(raw || "").trim().replace(/\/+$/, "");
}

export function allowPrivatePyneUrls(env: Env): boolean {
  return String(env.PYNE_ALLOW_PRIVATE_URLS || "").toLowerCase() === "true";
}

export function isPrivatePyneHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".local")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function originOk(env: Env, origin: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return { ok: false, reason: "invalid PYNE backend URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "PYNE backend URL must be http(s)" };
  }
  if (isPrivatePyneHost(u.hostname) && !allowPrivatePyneUrls(env)) {
    return {
      ok: false,
      reason: "local backend not reachable from this isolate",
    };
  }
  return { ok: true };
}

function workerKey(env: Env): string {
  return String(env.PYNE_WORKER_API_KEY || env.API_KEY || "").trim();
}

function flaskAuth(
  env: Env,
  kind: "pro" | "local" | "container"
): { header: string; value: string } | null {
  const raw =
    kind === "pro"
      ? env.PYNE_PRO_API_KEY
      : kind === "local"
        ? env.PYNE_LOCAL_API_KEY
        : env.PYNE_CONTAINER_API_KEY;
  const key = String(raw || "").trim();
  if (!key) return null;
  return { header: "Authorization", value: `Bearer ${key}` };
}

function joinRunUrl(origin: string, instance?: string): string {
  const u = new URL(origin.includes("://") ? origin : `https://${origin}`);
  const path = u.pathname.replace(/\/+$/, "");
  u.pathname = path.endsWith("/run") ? path : `${path}/run`;
  if (instance && !u.searchParams.has("instance")) {
    u.searchParams.set("instance", instance);
  }
  return u.toString();
}

export function workerHostConfigured(env: Env): boolean {
  return Boolean(env.PYNE_SERVICE || trimUrl(env.PYNE_WORKER_URL));
}

export function flaskHostConfigured(env: Env, kind: "pro" | "local" | "container"): boolean {
  if (kind === "pro") return Boolean(trimUrl(env.PYNE_PRO_API_KEY));
  if (kind === "local") return allowPrivatePyneUrls(env) || Boolean(trimUrl(env.PYNE_LOCAL_URL));
  return Boolean(trimUrl(env.PYNE_CONTAINER_URL));
}

/** Pro/local have defaults; container and worker need an explicit URL/binding. */
function defaultProUrl(env: Env): string {
  return trimUrl(env.PYNE_PRO_URL) || "https://pynescript.online";
}

function defaultLocalUrl(env: Env): string {
  return trimUrl(env.PYNE_LOCAL_URL) || "http://127.0.0.1:5002";
}

export function inventoryPyneBackends(env: Env): {
  selected: PyneBackendKind;
  configured: Exclude<PyneBackendKind, "auto" | "none">[];
  pro: { url: string; key: boolean };
  local: { url: string; reachable_hint: "dev_only" | "ok" };
  worker: { bound: "service" | "http" | false };
  container: { url: string | null };
} {
  const configured: Exclude<PyneBackendKind, "auto" | "none">[] = [];
  if (workerHostConfigured(env)) configured.push("worker");
  if (trimUrl(env.PYNE_CONTAINER_URL)) configured.push("container");
  if (trimUrl(env.PYNE_PRO_API_KEY) || trimUrl(env.PYNE_PRO_URL)) configured.push("pro");
  // local is always "has a default URL" but only listed when allowed or URL overridden
  if (trimUrl(env.PYNE_LOCAL_URL) || allowPrivatePyneUrls(env)) configured.push("local");
  return {
    selected: envPyneBackend(env),
    configured,
    pro: {
      url: defaultProUrl(env),
      key: Boolean(trimUrl(env.PYNE_PRO_API_KEY)),
    },
    local: {
      url: defaultLocalUrl(env),
      reachable_hint: allowPrivatePyneUrls(env) ? "ok" : "dev_only",
    },
    worker: {
      bound: env.PYNE_SERVICE
        ? "service"
        : trimUrl(env.PYNE_WORKER_URL)
          ? "http"
          : false,
    },
    container: { url: trimUrl(env.PYNE_CONTAINER_URL) || null },
  };
}

function skip(kind: Exclude<PyneBackendKind, "auto">, reason: string): ResolvedPyneBackend {
  return {
    kind,
    dialect: "none",
    url: null,
    origin: null,
    useService: false,
    auth: null,
    eval: false,
    language: "none",
    reason,
  };
}

function featurePyneAst(env: Env): boolean {
  return String(env.FEATURE_PYNE_AST || "").trim().toLowerCase() === "true";
}

/** Strip a trailing /run path for language-op origins. */
export function originFromRunUrl(runUrl: string | null): string | null {
  if (!runUrl) return null;
  try {
    const u = new URL(runUrl);
    u.pathname = u.pathname.replace(/\/run\/?$/, "") || "/";
    return u.toString().replace(/\/+$/, "") || u.origin;
  } catch {
    return null;
  }
}

function resolveExplicit(
  env: Env,
  kind: Exclude<PyneBackendKind, "auto">
): ResolvedPyneBackend {
  if (kind === "none") {
    return skip("none", "pyne backend none");
  }
  if (kind === "worker") {
    if (!workerHostConfigured(env)) {
      return skip("worker", "pyne-worker not configured (set PYNE_SERVICE or PYNE_WORKER_URL)");
    }
    const key = workerKey(env);
    const runUrl = env.PYNE_SERVICE ? null : `${trimUrl(env.PYNE_WORKER_URL)}/run`;
    return {
      kind: "worker",
      dialect: "worker",
      url: runUrl,
      origin: originFromRunUrl(runUrl),
      useService: Boolean(env.PYNE_SERVICE),
      auth: key ? { header: "X-API-Key", value: key } : null,
      eval: true,
      language: featurePyneAst(env) ? "ast" : "none",
    };
  }
  if (kind === "pro") {
    const origin = defaultProUrl(env);
    const gate = originOk(env, origin);
    if (!gate.ok) return skip("pro", gate.reason);
    const auth = flaskAuth(env, "pro");
    if (!auth) {
      return skip("pro", "pro key not configured");
    }
    return {
      kind: "pro",
      dialect: "flask",
      url: joinRunUrl(origin),
      origin,
      useService: false,
      auth,
      eval: true,
      language: "lsp",
    };
  }
  if (kind === "local") {
    const origin = defaultLocalUrl(env);
    const gate = originOk(env, origin);
    if (!gate.ok) return skip("local", gate.reason);
    return {
      kind: "local",
      dialect: "flask",
      url: joinRunUrl(origin),
      origin,
      useService: false,
      auth: flaskAuth(env, "local"),
      eval: true,
      language: "lsp",
    };
  }
  const origin = trimUrl(env.PYNE_CONTAINER_URL);
  if (!origin) return skip("container", "container backend not configured (set PYNE_CONTAINER_URL)");
  const gate = originOk(env, origin);
  if (!gate.ok) return skip("container", gate.reason);
  const instance = String(env.PYNE_CONTAINER_INSTANCE || "api").trim() || "api";
  return {
    kind: "container",
    dialect: "flask",
    url: joinRunUrl(origin, instance),
    origin,
    useService: false,
    auth: flaskAuth(env, "container"),
    eval: true,
    language: "lsp",
  };
}

/** auto: worker → container → pro (needs key) → local (if reachable). */
export function resolvePyneBackend(
  env: Env,
  requested: PyneBackendKind = "auto"
): ResolvedPyneBackend {
  if (requested !== "auto") return resolveExplicit(env, requested);
  const order: Exclude<PyneBackendKind, "auto" | "none">[] = [
    "worker",
    "container",
    "pro",
    "local",
  ];
  for (const kind of order) {
    const r = resolveExplicit(env, kind);
    if (r.eval) return r;
  }
  return skip("none", "no PYNE backend configured");
}

function isSchemaError(data: Record<string, unknown>): boolean {
  const code = String(data.code || data.error_kind || "");
  const msg = String(data.error || data.message || "");
  return (
    /UNKNOWN_FIELDS|MISSING_FIELD|INVALID_FIELD|INVALID_BODY/i.test(code) ||
    /unexpected field/i.test(msg)
  );
}

function flaskOk(status: number, data: Record<string, unknown>): boolean {
  if (status < 200 || status >= 300) return false;
  if (data.status === "success") return true;
  if (data.error || data.status === "error") return false;
  return true;
}

function mapHttpResult(
  resolved: ResolvedPyneBackend,
  status: number,
  data: Record<string, unknown>,
  mode: string,
  bars: number,
  latency_ms: number
): ValidateResult {
  const backend = BACKEND_LABEL[resolved.kind];
  const msg = String(data.error || data.message || `PYNE host HTTP ${status}`);
  const errorKind =
    data.error_kind != null ? String(data.error_kind) : undefined;
  const errorType =
    data.error_type != null ? String(data.error_type) : undefined;
  const errorBar =
    typeof data.error_bar === "number" ? data.error_bar : undefined;

  if (resolved.dialect === "flask" ? flaskOk(status, data) : status >= 200 && status < 300 && !data.error) {
    return {
      ok: true,
      backend,
      status,
      mode: data.mode != null ? String(data.mode) : mode,
      bars: typeof data.bars === "number" ? data.bars : typeof data.count === "number" ? data.count : bars,
      latency_ms,
      raw: {
        script_id: data.script_id,
        run_id: data.run_id,
        events: Array.isArray(data.events) ? data.events.length : 0,
      },
    };
  }

  if (isSchemaError(data)) {
    return {
      ok: false,
      skipped: true,
      retryable: false,
      backend,
      status,
      error: msg,
      reason: msg,
      latency_ms,
    };
  }

  const scriptError = Boolean(errorKind || errorType || errorBar != null || data.code === "EXECUTION_ERROR");
  const infra = (status === 401 || status === 403 || status >= 500) && !scriptError;
  return {
    ok: false,
    backend,
    skipped: infra,
    retryable: infra ? false : undefined,
    status,
    error: msg,
    reason: infra ? `${backend} HTTP ${status} (not a script error)` : undefined,
    error_kind: errorKind,
    error_type: errorType,
    error_bar: errorBar,
    mode,
    latency_ms,
    raw: { error_kind: data.error_kind, error_type: data.error_type, error_bar: data.error_bar },
  };
}

export async function validateOnSelectedBackend(
  env: Env,
  opts: ValidateOpts,
  requested: PyneBackendKind = "auto"
): Promise<ValidateResult> {
  const started = Date.now();
  const resolved = resolvePyneBackend(env, requested);
  if (!resolved.eval) {
    return {
      ok: false,
      skipped: true,
      retryable: false,
      backend: BACKEND_LABEL[resolved.kind],
      reason: resolved.reason || "pyne backend not configured",
      latency_ms: Date.now() - started,
    };
  }

  const script = opts.script.trim();
  if (!script) {
    return {
      ok: false,
      backend: BACKEND_LABEL[resolved.kind],
      error: "empty script",
      latency_ms: Date.now() - started,
    };
  }

  const mode = opts.mode || "interpret";
  const ohlcv = opts.ohlcv || syntheticBars(64);
  const headers: Record<string, string> = {};
  if (resolved.auth) headers[resolved.auth.header] = resolved.auth.value;

  const body =
    resolved.dialect === "flask"
      ? {
          script,
          data: ohlcv,
          mode,
          symbol: opts.symbol || "SYNTH",
        }
      : {
          script,
          ohlcv,
          mode,
          symbol: opts.symbol || "SYNTH",
          timeframe: "1m",
        };

  try {
    const { status, data } = await pynePostJson({
      env,
      url: resolved.url || undefined,
      service: resolved.useService ? env.PYNE_SERVICE : undefined,
      body,
      headers,
    });
    return mapHttpResult(resolved, status, data, mode, ohlcv.length, Date.now() - started);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timeout = /abort|timeout/i.test(msg);
    return {
      ok: false,
      skipped: true,
      retryable: false,
      backend: BACKEND_LABEL[resolved.kind],
      error: msg,
      reason: timeout
        ? `${BACKEND_LABEL[resolved.kind]} timeout`
        : `${BACKEND_LABEL[resolved.kind]} transport: ${msg}`,
      latency_ms: Date.now() - started,
    };
  }
}

export function anyPyneEvalConfigured(env: Env, requested: PyneBackendKind = "auto"): boolean {
  if (requested === "none") return false;
  return resolvePyneBackend(env, requested).eval;
}
