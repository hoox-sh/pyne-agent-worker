// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AXIS MCP client — lets the PYNE agent **control** AXIS, not just write scripts.
 *
 * AXIS exposes a stateless JSON-RPC 2.0 endpoint (`POST /mcp`, see
 * `axis/worker/src/mcp/handler.ts`):
 * - Worker plane (no PWA needed): `axis_health`, `axis_request`, `axis_run`,
 *   `axis_scripts_*`, `axis_keys_*`, `axis_usage`, `axis_onchain`, `axis_market`
 * - App plane (needs a connected PWA tab via the MCP bridge):
 *   `app_session_status`, `app_capabilities`, `app_invoke`, `app_get`, `app_set`
 *
 * No `initialize` handshake is required — the AXIS handler is stateless and
 * serves `tools/call` directly. If AXIS ever requires MCP sessions, revisit
 * {@link axisRpc} to persist `Mcp-Session-Id`.
 *
 * Config (wrangler vars / secrets):
 * - `AXIS_MCP_URL` — e.g. `https://worker.axis.hoox.sh/mcp` (default prod)
 * - `AXIS_MCP_KEY` — `pn_…` Bearer for the AXIS Worker (falls back to API_KEY)
 *
 * Standalone-first is preserved: every helper degrades to a clear
 * "not configured" result when `AXIS_MCP_URL` is unset — never throws.
 */

import { syntheticBars } from "../lib/synthetic-bars";

export const AXIS_MCP_PROTOCOL_VERSION = "2025-03-26";

/** Upper bound for model-facing text (tool results are truncated past this). */
export const AXIS_TEXT_BUDGET = 6000;

const TOOLS_CACHE_TTL_MS = 5 * 60_000;

export type AxisMcpConfig = {
  url: string;
  key: string;
};

/** Normalized AXIS MCP endpoint + key, or null when not configured. */
export function axisMcpConfig(env: Env): AxisMcpConfig | null {
  const url = String(env.AXIS_MCP_URL || "").trim().replace(/\/+$/, "");
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const key = String(env.AXIS_MCP_KEY || env.API_KEY || "").trim();
  return { url, key };
}

export function isAxisMcpConfigured(env: Env): boolean {
  return axisMcpConfig(env) !== null;
}

export type AxisRawOk = { ok: true; result: unknown; status: number };
export type AxisRawFail = { ok: false; error: string; code?: number };
export type AxisRawResult = AxisRawOk | AxisRawFail;

/**
 * Raw JSON-RPC call — parsed `result` without model shaping.
 * Prefer {@link axisRpc} for model-facing calls; use this when the caller
 * needs the full payload (e.g. `tools/list`, which exceeds the text budget).
 */
export async function axisRpcRaw(
  env: Env,
  method: string,
  params: Record<string, unknown> = {},
  opts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRawResult> {
  const cfg = axisMcpConfig(env);
  if (!cfg) {
    return {
      ok: false,
      error:
        "AXIS MCP not configured (set AXIS_MCP_URL, e.g. https://worker.axis.hoox.sh/mcp)",
    };
  }
  const fetchImpl = opts?.fetchImpl || fetch;
  const timeoutMs = opts?.timeoutMs || 20_000;
  try {
    const { status, body } = await postRpc(cfg, method, params, fetchImpl, timeoutMs);
    if (status < 200 || status >= 300) {
      return { ok: false, error: `AXIS MCP HTTP ${status}`, code: status };
    }
    const rpc = asRecord(body);
    if (rpc.error != null) {
      const err = asRecord(rpc.error);
      const msg =
        typeof err.message === "string" && err.message
          ? err.message
          : `AXIS MCP error (HTTP ${status})`;
      return {
        ok: false,
        error: msg.length > 1200 ? `${msg.slice(0, 1200)}…` : msg,
        code: typeof err.code === "number" ? err.code : status,
      };
    }
    return { ok: true, result: rpc.result ?? null, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /abort|timeout/i.test(msg)
        ? `AXIS MCP timeout after ${timeoutMs}ms`
        : `AXIS MCP transport: ${msg}`,
    };
  }
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= AXIS_TEXT_BUDGET) return { text, truncated: false };
  return {
    text: `${text.slice(0, AXIS_TEXT_BUDGET)}\n…[truncated ${text.length - AXIS_TEXT_BUDGET} chars]`,
    truncated: true,
  };
}

type FetchImpl = typeof fetch;

async function postRpc(
  cfg: AxisMcpConfig,
  method: string,
  params: Record<string, unknown>,
  fetchImpl: FetchImpl,
  timeoutMs: number
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "MCP-Protocol-Version": AXIS_MCP_PROTOCOL_VERSION,
  };
  if (cfg.key) headers["Authorization"] = `Bearer ${cfg.key}`;
  const res = await fetchImpl(cfg.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export type AxisRpcOk = {
  ok: true;
  /** Joined `content[].text` parts (truncated to budget). */
  text: string;
  /** Raw `structuredContent` when the server returned one. */
  structured?: unknown;
  truncated: boolean;
};

export type AxisRpcFail = {
  ok: false;
  error: string;
  /** JSON-RPC error code or HTTP status when known. */
  code?: number;
};

export type AxisRpcResult = AxisRpcOk | AxisRpcFail;

/**
 * Model-facing JSON-RPC call — same transport as {@link axisRpcRaw} with
 * `tools/call` shaping + text budget applied.
 * Returns `{ ok:false }` (never throws) on transport / protocol errors.
 */
export async function axisRpc(
  env: Env,
  method: string,
  params: Record<string, unknown> = {},
  opts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRpcResult> {
  const raw = await axisRpcRaw(env, method, params, opts);
  if (!raw.ok) return raw;
  const result = asRecord(raw.result);
  // tools/call shape: { content: [{type:'text',text}], structuredContent }
  const content = Array.isArray(result.content) ? result.content : [];
  const texts: string[] = [];
  for (const part of content) {
    const p = asRecord(part);
    if (p.type === "text" && typeof p.text === "string") texts.push(p.text);
  }
  const joined = texts.length
    ? texts.join("\n")
    : JSON.stringify(result).slice(0, AXIS_TEXT_BUDGET * 2);
  const t = truncate(joined);
  return {
    ok: true,
    text: t.text,
    structured: result.structuredContent,
    truncated: t.truncated,
  };
}

export type AxisToolInfo = { name: string; description: string };

let toolsCache: { at: number; tools: AxisToolInfo[] } | null = null;

/** Test hook — drop the cached tools/list snapshot. */
export function _resetAxisToolsCache(): void {
  toolsCache = null;
}

/**
 * Cached `tools/list` (name + description only — schemas stay server-side).
 * Empty array when unconfigured or unreachable (never throws).
 */
export async function axisMcpListTools(
  env: Env,
  opts?: { refresh?: boolean; fetchImpl?: FetchImpl }
): Promise<AxisToolInfo[]> {
  if (!opts?.refresh && toolsCache && Date.now() - toolsCache.at < TOOLS_CACHE_TTL_MS) {
    return toolsCache.tools;
  }
  const res = await axisRpcRaw(env, "tools/list", {}, { fetchImpl: opts?.fetchImpl });
  if (!res.ok) return toolsCache?.tools || [];
  const payload = asRecord(res.result);
  const tools = payload.tools;
  const list = Array.isArray(tools)
    ? tools
        .map((t) => {
          const r = asRecord(t);
          return {
            name: typeof r.name === "string" ? r.name : "",
            description: typeof r.description === "string" ? r.description : "",
          };
        })
        .filter((t) => t.name)
    : [];
  const finalList = list.length ? list : toolsCache?.tools || [];
  toolsCache = { at: Date.now(), tools: finalList };
  return finalList;
}

/** Tool-name guardrail: allow AXIS worker/app tools, block path-like names. */
export function isCallableAxisTool(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(name);
}

/**
 * Generic `tools/call` with a name guardrail. Prefer the composed helpers
 * (`axisRunPine`, `axisApp`) when they fit — this is the escape hatch for
 * the rest of the catalog (scripts, market, on-chain, settings…).
 */
export async function axisMcpCallTool(
  env: Env,
  name: string,
  args: Record<string, unknown> = {},
  opts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRpcResult> {
  const tool = String(name || "").trim();
  if (!isCallableAxisTool(tool)) {
    return { ok: false, error: `refusing to call suspicious AXIS tool name: ${name}` };
  }
  return axisRpc(env, "tools/call", { name: tool, arguments: args }, opts);
}

export type AxisRunOpts = {
  script: string;
  symbol?: string;
  timeframe?: string;
  /** Synthetic bars when the caller has no real OHLCV (default 128). */
  bars?: number;
};

/**
 * Execute Pine on AXIS (`axis_run`, worker plane — no PWA tab needed).
 * Returns the raw RPC result; use {@link validateOnAxisMcp} for the
 * generate→validate→retry loop shape.
 */
export async function axisRunPine(
  env: Env,
  opts: AxisRunOpts,
  rpcOpts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRpcResult> {
  const script = String(opts.script || "").trim();
  if (!script) return { ok: false, error: "empty script" };
  const bars = Math.max(16, Math.min(500, Math.floor(opts.bars || 128)));
  const args: Record<string, unknown> = {
    script,
    data: syntheticBars(bars),
    ticker: (opts.symbol || "SYNTH").toUpperCase(),
    timeframe: opts.timeframe || "1m",
  };
  return axisMcpCallTool(env, "axis_run", args, rpcOpts);
}

/**
 * Validate Pine via AXIS (`axis_run` on synthetic bars) in the
 * {@link ValidateResult} shape so the retry loop can consume it.
 * Skipped (never failed) when AXIS MCP is not configured.
 */
export async function validateOnAxisMcp(
  env: Env,
  opts: { script: string; mode?: "interpret" | "compile" | "auto"; symbol?: string },
  rpcOpts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<import("../lib/pyne-worker").ValidateResult> {
  const started = Date.now();
  const latency = () => Date.now() - started;
  if (!isAxisMcpConfigured(env)) {
    return {
      ok: false,
      skipped: true,
      backend: "axis-mcp",
      reason: "AXIS MCP not configured (set AXIS_MCP_URL)",
      latency_ms: latency(),
    };
  }
  const res = await axisRunPine(
    env,
    { script: opts.script, symbol: opts.symbol, bars: 128 },
    rpcOpts
  );
  if (!res.ok) {
    return {
      ok: false,
      backend: "axis-mcp",
      error: res.error,
      latency_ms: latency(),
    };
  }
  // axis_run surfaces engine errors as result text / structured error fields.
  const structured = asRecord(res.structured);
  const body = asRecord(structured.body);
  const text = res.text || "";
  // The AXIS worker itself has no evaluation backend (no EXTERNAL_BACKEND,
  // no Pyodide) — retrying is pointless. Surface as skipped with the fix so
  // the loop stops after one attempt instead of burning retries + GPU.
  if (body.code === "NO_BACKEND" || text.includes("NO_BACKEND")) {
    return {
      ok: false,
      skipped: true,
      backend: "axis-mcp",
      reason:
        "AXIS worker has no evaluation backend (NO_BACKEND): set EXTERNAL_BACKEND=<pyne-url> " +
        "or enable PYODIDE_IN_WORKER on the AXIS worker. Scripts are still returned unvalidated.",
      latency_ms: latency(),
    };
  }
  const errText =
    (typeof structured.error === "string" && structured.error) ||
    (/error/i.test(text) ? text.slice(0, 800) : "");
  if (errText) {
    return {
      ok: false,
      backend: "axis-mcp",
      error: errText,
      latency_ms: latency(),
      raw: { truncated: res.truncated },
    };
  }
  return {
    ok: true,
    backend: "axis-mcp",
    mode: opts.mode || "interpret",
    bars: 128,
    latency_ms: latency(),
    raw: { truncated: res.truncated },
  };
}

export type AxisAppOpts = {
  /** e.g. `editor.set`, `chart.load`, `results.get`, `workspace.export` … */
  capability: string;
  payload?: Record<string, unknown>;
  /** Bridge session (defaults to the key-partition session server-side). */
  session?: string;
};

/**
 * Invoke an AXIS app-plane capability on the connected PWA
 * (`app_invoke` — editor, chart, results, workspace, alerts, …).
 * Fails clearly when no PWA tab is bridged (the result names the fix:
 * open AXIS → Settings → MCP).
 */
export async function axisApp(
  env: Env,
  opts: AxisAppOpts,
  rpcOpts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRpcResult> {
  const capability = String(opts.capability || "").trim();
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/i.test(capability)) {
    return { ok: false, error: `invalid AXIS capability: ${opts.capability}` };
  }
  const args: Record<string, unknown> = {
    capability,
    payload: opts.payload || {},
  };
  if (opts.session) args.session = opts.session;
  return axisMcpCallTool(env, "app_invoke", args, rpcOpts);
}

/** Read AXIS app state (`app_get`, e.g. `editor.content`, `results.summary`). */
export async function axisAppGet(
  env: Env,
  path?: string,
  rpcOpts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRpcResult> {
  const args: Record<string, unknown> = {};
  if (path) args.path = path;
  return axisMcpCallTool(env, "app_get", args, rpcOpts);
}

/** Patch AXIS app state (`app_set`). Secret-bearing paths are rejected server-side. */
export async function axisAppSet(
  env: Env,
  path: string,
  value: unknown,
  rpcOpts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRpcResult> {
  if (!String(path || "").trim()) return { ok: false, error: "path is required" };
  return axisMcpCallTool(env, "app_set", { path, value }, rpcOpts);
}

/**
 * Bridge presence probe: is a PWA tab connected for this key?
 * Backs the "can I touch the live chart?" decision before app_* calls.
 */
export async function axisAppSession(
  env: Env,
  session?: string,
  rpcOpts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<AxisRpcResult> {
  const args: Record<string, unknown> = {};
  if (session) args.session = session;
  return axisMcpCallTool(env, "app_session_status", args, rpcOpts);
}

/**
 * One-shot operator status: configured, reachable, tool count, bridge.
 * Powers `axis_mcp_status` (agent tool + MCP tool) and `/health`.
 */
export async function axisMcpStatus(
  env: Env,
  opts?: { fetchImpl?: FetchImpl; timeoutMs?: number }
): Promise<{
  configured: boolean;
  url: string | null;
  reachable: boolean;
  latency_ms: number;
  server?: string;
  tools?: number;
  bridge_connected?: number;
  error?: string;
}> {
  const started = Date.now();
  const cfg = axisMcpConfig(env);
  if (!cfg) {
    return {
      configured: false,
      url: null,
      reachable: false,
      latency_ms: 0,
      error: "set AXIS_MCP_URL (e.g. https://worker.axis.hoox.sh/mcp)",
    };
  }
  const init = await axisRpc(env, "initialize", {
    protocolVersion: AXIS_MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "pyne-agent-worker", version: "0.3.0" },
  }, opts);
  if (!init.ok) {
    return {
      configured: true,
      url: cfg.url,
      reachable: false,
      latency_ms: Date.now() - started,
      error: init.error,
    };
  }
  const server = (() => {
    try {
      const s = asRecord(asRecord(JSON.parse(init.text) as unknown).serverInfo);
      return typeof s.name === "string" ? s.name : undefined;
    } catch {
      return undefined;
    }
  })();
  const tools = await axisMcpListTools(env, { fetchImpl: opts?.fetchImpl });
  let bridge: number | undefined;
  const session = await axisAppSession(env, undefined, opts);
  if (session.ok) {
    try {
      const parsed = asRecord(JSON.parse(session.text) as unknown);
      const inner = asRecord(parsed.result);
      const n = inner.connected ?? parsed.connected;
      if (typeof n === "number") bridge = n;
    } catch {
      /* text-only shape — leave undefined */
    }
  }
  return {
    configured: true,
    url: cfg.url,
    reachable: true,
    latency_ms: Date.now() - started,
    server,
    tools: tools.length || undefined,
    bridge_connected: bridge,
  };
}
