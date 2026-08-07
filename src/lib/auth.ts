// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * API auth: X-API-Key or Authorization: Bearer <key>.
 * When API_KEY secret is unset, local/open mode is allowed (dev only).
 */

export function extractApiKey(request: Request): string | null {
  const header = request.headers.get("X-API-Key");
  if (header && header.trim()) return header.trim();

  const auth = request.headers.get("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  return null;
}

export function requireAuth(
  request: Request,
  env: Env
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = (env.API_KEY || "").trim();
  if (!expected) {
    // Open mode for local `wrangler dev` without secrets.
    return { ok: true };
  }
  const got = extractApiKey(request);
  if (!got || got !== expected) {
    return { ok: false, status: 401, error: "Unauthorized: missing or invalid API key" };
  }
  return { ok: true };
}
