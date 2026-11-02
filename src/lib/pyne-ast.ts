// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PYNE language ops over HTTP.
 * Worker dialect: POST /ast/<op> (FEATURE_PYNE_AST).
 * Flask dialect: POST /lsp/diagnostics for parse+lint.
 */

import { featurePyneAst } from "../ai/routing";
import {
  type PyneBackendKind,
  resolvePyneBackend,
  type ResolvedPyneBackend,
} from "./pyne-backend";
import { pynePostJson } from "./pyne-http";
import { lintPine } from "../agent/lint";

const LABEL: Record<string, string> = {
  pro: "pyne-pro",
  local: "pyne-local",
  worker: "pyne-worker",
  container: "pyne-container",
  none: "none",
  heuristic: "heuristic",
};

export type AstOp =
  | "parse"
  | "dump"
  | "unparse"
  | "format"
  | "lint"
  | "diagnostics"
  | "compile";

export type AstResult = {
  ok: boolean;
  skipped?: boolean;
  retryable?: boolean;
  backend?: string;
  stage?: string;
  reason?: string;
  status?: number;
  error?: string;
  error_kind?: string;
  line?: number;
  column?: number;
  partial?: boolean;
  version?: string;
  kind?: string;
  title?: string;
  errors?: unknown[];
  findings?: unknown[];
  diagnostics?: unknown[];
  error_count?: number;
  warning_count?: number;
  dump?: string;
  tree?: unknown;
  source?: string;
  changed?: boolean;
  mode?: string;
  plots?: unknown;
  elapsed_ms?: number;
  latency_ms: number;
  raw?: Record<string, unknown>;
};

function label(kind: string): string {
  return LABEL[kind] || kind;
}

function isMissingRoute(status: number, data: Record<string, unknown>): boolean {
  if (status === 404 || status === 501) return true;
  const code = String(data.code || data.error_kind || "");
  return /UNKNOWN_ROUTE|NOT_FOUND/i.test(code);
}

function isInfra(status: number, data: Record<string, unknown>): boolean {
  if (isMissingRoute(status, data)) return false;
  const kind = String(data.kind || data.error_kind || "");
  if (/parse|lint|syntax|compile/i.test(kind)) return false;
  return status === 401 || status === 403 || status >= 500;
}

async function postLanguage(
  env: Env,
  resolved: ResolvedPyneBackend,
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (resolved.auth) headers[resolved.auth.header] = resolved.auth.value;

  if (resolved.useService && env.PYNE_SERVICE) {
    return pynePostJson({
      env,
      service: env.PYNE_SERVICE,
      serviceUrl: `https://pyne-worker${path}`,
      body,
      headers,
    });
  }

  const origin = resolved.origin;
  if (!origin) {
    return { status: 0, data: { error: "no PYNE language origin" } };
  }
  const base = origin.replace(/\/+$/, "");
  return pynePostJson({
    env,
    url: `${base}${path}`,
    body,
    headers,
  });
}

function skipResult(
  backend: string,
  reason: string,
  started: number,
  stage?: string
): AstResult {
  return {
    ok: false,
    skipped: true,
    retryable: false,
    backend,
    stage,
    reason,
    latency_ms: Date.now() - started,
  };
}

/** Flask /lsp/diagnostics → parse+lint diagnostics. */
export async function pyneLspDiagnostics(
  env: Env,
  script: string,
  requested: PyneBackendKind = "auto"
): Promise<AstResult> {
  const started = Date.now();
  const resolved = resolvePyneBackend(env, requested);
  if (resolved.language !== "lsp") {
    return skipResult(
      label(resolved.kind),
      resolved.language === "ast"
        ? "use worker /ast for this host"
        : resolved.reason || "no Flask /lsp surface",
      started,
      "diagnostics"
    );
  }

  try {
    const { status, data } = await postLanguage(env, resolved, "/lsp/diagnostics", {
      source: script,
    });
    const latency_ms = Date.now() - started;
    if (isMissingRoute(status, data)) {
      return skipResult(label(resolved.kind), "Flask /lsp/diagnostics missing", started, "diagnostics");
    }
    if (isInfra(status, data)) {
      return {
        ok: false,
        skipped: true,
        retryable: false,
        backend: label(resolved.kind),
        stage: "diagnostics",
        status,
        error: String(data.message || data.error || `HTTP ${status}`),
        reason: String(data.message || data.error || `HTTP ${status}`),
        latency_ms,
      };
    }
    const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
    const errors = diagnostics.filter(
      (d) =>
        d &&
        typeof d === "object" &&
        String((d as { severity?: string }).severity || "").toLowerCase() ===
          "error"
    );
    const ok = data.ok !== false && errors.length === 0 && status >= 200 && status < 300;
    return {
      ok,
      backend: label(resolved.kind),
      stage: "diagnostics",
      partial: true,
      diagnostics,
      errors,
      error_count: errors.length,
      warning_count: diagnostics.length - errors.length,
      status,
      error: ok
        ? undefined
        : String(
            (errors[0] as { message?: string } | undefined)?.message ||
              data.message ||
              "diagnostics failed"
          ),
      error_kind: ok ? undefined : "parse",
      line: (errors[0] as { line?: number } | undefined)?.line,
      latency_ms,
      raw: { source: data.source },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return skipResult(
      label(resolved.kind),
      /abort|timeout/i.test(msg) ? "timeout" : `transport: ${msg}`,
      started,
      "diagnostics"
    );
  }
}

/** Worker POST /ast/<op>. Skips when FEATURE_PYNE_AST=false or route missing. */
export async function pyneAstOp(
  env: Env,
  op: AstOp,
  script: string,
  requested: PyneBackendKind = "auto",
  extra: Record<string, unknown> = {}
): Promise<AstResult> {
  const started = Date.now();
  const resolved = resolvePyneBackend(env, requested);

  if (resolved.language === "lsp") {
    if (op === "parse" || op === "lint" || op === "diagnostics") {
      return pyneLspDiagnostics(env, script, requested);
    }
    return skipResult(
      label(resolved.kind),
      "flask host has no /ast; use worker or wait for Pro /ast",
      started,
      op
    );
  }

  if (resolved.language !== "ast" || !featurePyneAst(env)) {
    return skipResult(
      label(resolved.kind),
      resolved.reason ||
        (featurePyneAst(env)
          ? "pyne /ast not available on this host"
          : "FEATURE_PYNE_AST=false"),
      started,
      op
    );
  }

  const body: Record<string, unknown> = { script, ...extra };
  if (op === "compile") {
    // Never request Python IR.
    delete body.emit;
  }

  try {
    const { status, data } = await postLanguage(env, resolved, `/ast/${op}`, body);
    const latency_ms = Date.now() - started;

    if (isMissingRoute(status, data) || status === 413) {
      return skipResult(
        label(resolved.kind),
        status === 413 ? "tree_truncated" : `/ast/${op} not available`,
        started,
        op
      );
    }
    if (isInfra(status, data)) {
      return {
        ok: false,
        skipped: true,
        retryable: false,
        backend: label(resolved.kind),
        stage: op,
        status,
        error: String(data.error || data.message || `HTTP ${status}`),
        reason: String(data.error || data.message || `HTTP ${status}`),
        latency_ms,
      };
    }

    const ok = data.ok === true || (data.ok !== false && status >= 200 && status < 300 && !data.error);
    // Never surface emitted Python.
    const { python: _python, emit: _emit, ...safe } = data;

    return {
      ok,
      backend: label(resolved.kind),
      stage: op,
      status,
      error: ok ? undefined : String(data.error || data.message || `${op} failed`),
      error_kind: data.kind != null ? String(data.kind) : data.error_kind != null ? String(data.error_kind) : undefined,
      line: typeof data.line === "number" ? data.line : undefined,
      column: typeof data.column === "number" ? data.column : undefined,
      version: data.version != null ? String(data.version) : undefined,
      kind: data.kind != null ? String(data.kind) : undefined,
      title: data.title != null ? String(data.title) : undefined,
      errors: Array.isArray(data.errors) ? data.errors : undefined,
      findings: Array.isArray(data.findings) ? data.findings : undefined,
      diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : undefined,
      error_count: typeof data.error_count === "number" ? data.error_count : undefined,
      warning_count: typeof data.warning_count === "number" ? data.warning_count : undefined,
      dump: data.dump != null ? String(data.dump) : undefined,
      tree: data.tree,
      source: data.source != null ? String(data.source) : undefined,
      changed: typeof data.changed === "boolean" ? data.changed : undefined,
      mode: data.mode != null ? String(data.mode) : undefined,
      plots: data.plots,
      elapsed_ms: typeof data.elapsed_ms === "number" ? data.elapsed_ms : undefined,
      latency_ms,
      raw: safe,
      retryable: ok ? undefined : true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return skipResult(
      label(resolved.kind),
      /abort|timeout/i.test(msg) ? "timeout" : `transport: ${msg}`,
      started,
      op
    );
  }
}

/** Lint: PYNE language surface, else heuristic. */
export async function pyneLintOrHeuristic(
  env: Env,
  script: string,
  requested: PyneBackendKind = "auto"
): Promise<AstResult> {
  const started = Date.now();
  const resolved = resolvePyneBackend(env, requested);
  if (resolved.language === "lsp" || resolved.language === "ast") {
    const r = await pyneAstOp(env, "lint", script, requested);
    if (!r.skipped) return r;
  }
  const lint = lintPine(script);
  return {
    ok: lint.ok,
    backend: "heuristic",
    stage: "lint",
    findings: lint.issues,
    error_count: lint.issues.filter((i) => i.severity === "error").length,
    warning_count: lint.issues.filter((i) => i.severity === "warning").length,
    error: lint.ok
      ? undefined
      : lint.issues.find((i) => i.severity === "error")?.message,
    error_kind: lint.ok ? undefined : "lint",
    retryable: !lint.ok,
    latency_ms: Date.now() - started,
    raw: { changed: lint.changed },
  };
}

