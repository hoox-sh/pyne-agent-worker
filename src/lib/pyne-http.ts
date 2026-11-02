// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Shared JSON POST for PYNE hosts (service binding or origin). */

export type PyneHttpResult = {
  status: number;
  data: Record<string, unknown>;
};

export function pyneValidateTimeoutMs(env: Env): number {
  const n = Number(env.PYNE_VALIDATE_TIMEOUT_MS || "20000");
  if (!Number.isFinite(n) || n < 1_000) return 20_000;
  return Math.min(Math.floor(n), 60_000);
}

export async function pynePostJson(opts: {
  env: Env;
  /** Absolute URL for fetch(). Ignored when `service` is set. */
  url?: string;
  /** Optional pyne-worker service binding. */
  service?: Fetcher;
  /** Binding fetch URL, default https://pyne-worker/run */
  serviceUrl?: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<PyneHttpResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  const init: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
    signal: AbortSignal.timeout(pyneValidateTimeoutMs(opts.env)),
  };
  let res: Response;
  if (opts.service) {
    res = await opts.service.fetch(
      opts.serviceUrl || "https://pyne-worker/run",
      init
    );
  } else {
    const url = (opts.url || "").trim();
    if (!url) {
      return { status: 0, data: { error: "pyne POST missing URL" } };
    }
    const fetchImpl = opts.fetchImpl || fetch;
    res = await fetchImpl(url, init);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = { error: `Non-JSON response from PYNE host (HTTP ${res.status})` };
  }
  return { status: res.status, data };
}
