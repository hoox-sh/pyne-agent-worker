// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

export function json(
  data: unknown,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorJson(
  status: number,
  error: string,
  extra?: Record<string, unknown>
): Response {
  return json({ ok: false, error, ...extra }, { status });
}

export async function readJson<T = unknown>(
  request: Request
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const data = (await request.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
}
