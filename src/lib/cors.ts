// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser Origins that may call the agent API / load the AXIS plugin module.
 * Note: Origin is scheme+host+port only (no path). `https://hoox.sh/axis` is
 * never a valid Origin — use `https://hoox.sh`.
 */
const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://hoox.sh",
  "https://axis.hoox.sh",
  "https://pynescript.ai",
  "https://pynescript.online",
];

export function parseOrigins(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [...DEFAULT_ORIGINS];
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Always keep product defaults so dashboard ALLOWED_ORIGINS is additive
  return [...new Set([...DEFAULT_ORIGINS, ...parsed])];
}

/** True when origin is on the allowlist (exact or *.pages.dev project hosts). */
export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (!origin) return false;
  if (allowed.includes(origin) || allowed.includes("*")) return true;
  try {
    const host = new URL(origin).hostname;
    // Cloudflare Pages previews for AXIS / product projects
    if (
      host.endsWith(".pynescript-axis.pages.dev") ||
      host.endsWith(".pages.dev")
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function corsHeaders(
  request: Request,
  allowed: string[]
): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  // Reflect allowlisted Origin. Never claim a *different* site's origin
  // (browser rejects ACAO mismatch). Unknown origins → first allowlist or *.
  let acao = "*";
  if (origin && isOriginAllowed(origin, allowed)) {
    acao = origin;
  } else if (!origin) {
    acao = allowed.includes("*") ? "*" : allowed[0] || "*";
  } else if (allowed.includes("*")) {
    acao = "*";
  } else {
    // Unknown Origin: still return * for public GETs; credentialed API
    // clients must be allowlisted. Dynamic import accepts *.
    acao = "*";
  }

  return {
    "Access-Control-Allow-Origin": acao,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Headers for public ES module plugin (dynamic import needs CORS). */
export function pluginCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

export function withCors(
  request: Request,
  env: Env,
  response: Response
): Response {
  const headers = corsHeaders(request, parseOrigins(env.ALLOWED_ORIGINS));
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
