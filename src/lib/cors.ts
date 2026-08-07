// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

const DEFAULT_ORIGINS = [
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "https://hoox.sh",
  "https://hoox.sh/axis",
];

export function parseOrigins(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return DEFAULT_ORIGINS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(
  request: Request,
  allowed: string[]
): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const allow =
    origin && allowed.includes(origin)
      ? origin
      : allowed[0] || DEFAULT_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
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
