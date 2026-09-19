// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * API auth: X-API-Key or Authorization: Bearer <key>.
 * When API_KEY secret is unset, local/open mode is allowed (dev only).
 */

export type ExtractApiKeyOpts = {
  /** Browser WebSocket cannot set Authorization; allow ?api_key= / ?key= only then. */
  allowQuery?: boolean;
};

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
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = (env.API_KEY || "").trim();
  if (!expected) {
    // Open mode for local `wrangler dev` without secrets.
    return { ok: true };
  }
  const got = extractApiKey(request, opts);
  if (!got || !timingSafeEqualUtf8(got, expected)) {
    return { ok: false, status: 401, error: "Unauthorized: missing or invalid API key" };
  }
  return { ok: true };
}
