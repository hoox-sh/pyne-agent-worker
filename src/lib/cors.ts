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

/** Origin is scheme+host+port only — drop accidental paths from env lists. */
function canonicalizeOrigin(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === "*") return "*";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function parseOrigins(raw: string | undefined): string[] {
  const extra = (raw || "")
    .split(",")
    .map((s) => canonicalizeOrigin(s))
    .filter((s): s is string => Boolean(s));
  // Always keep product defaults so dashboard ALLOWED_ORIGINS is additive
  return [...new Set([...DEFAULT_ORIGINS, ...extra])];
}

/** True when origin is on the allowlist (exact or AXIS Pages preview hosts). */
export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (!origin) return false;
  if (allowed.includes(origin) || allowed.includes("*")) return true;
  try {
    const host = new URL(origin).hostname;
    // Cloudflare Pages previews for the AXIS project only — not every *.pages.dev
    if (
      host === "pynescript-axis.pages.dev" ||
      host.endsWith(".pynescript-axis.pages.dev")
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
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (origin && isOriginAllowed(origin, allowed)) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (!origin && allowed.includes("*")) {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  // Unknown browser Origin: omit ACAO so the browser blocks the response.
  // Plugin ES module uses pluginCorsHeaders() (*), not this helper.

  return headers;
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

/** WebSocket 101 responses must not be cloned — `webSocket` does not copy. */
export function isWebSocketResponse(response: Response): boolean {
  if (response.status === 101) return true;
  return Boolean((response as Response & { webSocket?: unknown }).webSocket);
}

export function withCors(
  request: Request,
  env: Env,
  response: Response
): Response {
  if (isWebSocketResponse(response)) return response;
  const headers = corsHeaders(request, parseOrigins(env.ALLOWED_ORIGINS));
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
