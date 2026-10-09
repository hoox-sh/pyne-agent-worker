// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Usage metering for `POST /v1/chat` (Phase 3).
 *
 * Mirrors the sibling `pyne-worker` (`queue_usage_event` / `flush_usage_queue`):
 * verified tenant chat completions queue one event each and flush in batches
 * of up to 50 to:
 *
 *     POST {CONSOLE_URL}/api/v1/usage  {events: [{tid, scope, units, idem}]}
 *
 * - Hash-on-wire only: `Authorization: Bearer <USAGE_SERVICE_KEY | tenant hash>`.
 *   Raw `hx_live_…` keys are never transmitted, cached, or logged (hash
 *   prefixes only).
 * - Idempotency key: `<YYYY-MM-DD>:<hash16>:<counter>` with a per-isolate
 *   monotonic counter so retries across requests never collide.
 * - Lossy by design: the batch is dropped either way. Transport failures,
 *   non-2xx (including 500 / 429), and `207` per-event errors are swallowed
 *   with `console.warn` and never fail the chat. `quota_exceeded` entries are
 *   intentionally NOT requeued (dropped with warn) to avoid poison-event
 *   flush loops.
 * - Console `207` multi-status is handled tolerantly: `ok` / duplicate
 *   entries count as accepted; anything else is warned and dropped.
 *
 * No new dependencies (native `fetch` only). No change to verify semantics,
 * chat prompts, RAG, or Vectorize bindings.
 */

export const USAGE_PATH = "/api/v1/usage";
export const USAGE_SCOPE = "agent:chat";
export const USAGE_SERVICE = "pyne-agent-worker";

/** Max usage events per flush POST (mirrors pyne-worker `USAGE_BATCH_MAX`). */
export const USAGE_BATCH_MAX = 50;
/** Cap the in-isolate queue to bound memory (mirrors `USAGE_QUEUE_MAX`). */
export const USAGE_QUEUE_MAX = 500;
/** Inline flush budget so a slow console never blocks chat (fire-and-forget). */
export const USAGE_FLUSH_TIMEOUT_MS = 2_000;

export type UsageUnits = {
  generations: number;
  kbBytes?: number;
};

export type UsageEvent = {
  tid?: string;
  userId?: string;
  scope: string;
  units: UsageUnits;
  idem: string;
  service?: string;
  day?: string;
};

export type QueueUsageInput = {
  tid?: string;
  userId?: string;
  scope?: string;
  units?: { generations?: number; kbBytes?: number };
  /** 16-char hash shard for the idem key (never the raw key). */
  keyHash16?: string;
  /** Override idem (tests); generated when omitted. */
  idem?: string;
  service?: string;
};

export type UsageFlushOpts = {
  /** Override for tests (defaults to global fetch). */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Abort budget in ms (default {@link USAGE_FLUSH_TIMEOUT_MS}). */
  timeoutMs?: number;
};

const usageQueue: UsageEvent[] = [];
let usageSeq = 0;

function usageDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Queue one usage event. Returns the event, or `null` when the tenant id is
 * missing / `unknown` (tid mismatch — dropped, never queued). Never throws
 * and never logs raw keys.
 */
export function queueUsageEvent(input: QueueUsageInput): UsageEvent | null {
  try {
    const tid = String(input.tid ?? input.userId ?? "").trim();
    if (!tid || tid === "unknown") return null;
    const scope = String(input.scope ?? USAGE_SCOPE).trim() || USAGE_SCOPE;
    const genRaw = Number(input.units?.generations ?? 1);
    const generations =
      Number.isFinite(genRaw) && genRaw > 0 ? Math.floor(genRaw) : 1;
    const units: UsageUnits = { generations };
    const kbRaw = input.units?.kbBytes;
    if (typeof kbRaw === "number" && Number.isFinite(kbRaw) && kbRaw >= 0) {
      units.kbBytes = Math.floor(kbRaw);
    }
    const day = usageDay();
    const hash16 = String(input.keyHash16 ?? "").trim() || "unknown";
    const idem =
      String(input.idem ?? "").trim() || `${day}:${hash16}:${++usageSeq}`;
    const event: UsageEvent = {
      tid,
      scope,
      units,
      idem,
      service: String(input.service ?? USAGE_SERVICE),
      day,
    };
    usageQueue.push(event);
    while (usageQueue.length > USAGE_QUEUE_MAX) usageQueue.shift();
    return event;
  } catch {
    return null;
  }
}

/** Drop queued usage events (tests). The idem counter stays monotonic. */
export function clearUsageQueue(): void {
  usageQueue.length = 0;
}

/** Number of queued (unflushed) usage events. */
export function usageQueueDepth(): number {
  return usageQueue.length;
}

/** Read-only snapshot of the queue (tests). */
export function peekUsageQueue(): UsageEvent[] {
  return usageQueue.map((e) => ({
    ...e,
    units: { ...e.units },
  }));
}

function warn(type: string, extra?: Record<string, unknown>): void {
  try {
    console.warn(JSON.stringify({ type, ...extra }));
  } catch {
    /* logging must never throw */
  }
}

function resolveServiceAuth(env: Env, authToken?: string): string {
  const explicit = String(authToken ?? "").trim();
  if (explicit) return explicit;
  try {
    const fromEnv = String(
      (env as unknown as { USAGE_SERVICE_KEY?: unknown }).USAGE_SERVICE_KEY ??
        ""
    ).trim();
    if (fromEnv) return fromEnv;
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * POST up to {@link USAGE_BATCH_MAX} queued events to the console.
 * Returns the number of accepted events. The dequeued batch is dropped either
 * way (lossy) — metering can never wedge the isolate or fail a chat.
 * Never throws; never logs raw keys or bearer values.
 */
export async function flushUsageQueue(
  env: Env,
  authToken?: string,
  opts?: UsageFlushOpts
): Promise<number> {
  try {
    if (usageQueue.length === 0) return 0;
    const base = String(env.CONSOLE_URL ?? "").trim().replace(/\/+$/, "");
    if (!base) {
      warn("usage_flush_no_console", { queued: usageQueue.length });
      return 0;
    }
    const batch = usageQueue.splice(0, USAGE_BATCH_MAX);
    if (batch.length === 0) return 0;
    const token = resolveServiceAuth(env, authToken);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // Hash-on-wire: service key or per-request tenant hash — never raw.
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const url = `${base}${USAGE_PATH}`;
    const timeoutMs =
      opts?.timeoutMs !== undefined &&
      Number.isFinite(opts.timeoutMs) &&
      (opts.timeoutMs as number) > 0
        ? Math.floor(opts.timeoutMs as number)
        : USAGE_FLUSH_TIMEOUT_MS;
    const fetchFn = opts?.fetchFn ?? fetch;
    const signal =
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ events: batch }),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warn("usage_flush_error", { error: msg.slice(0, 200), dropped: batch.length });
      return 0;
    }
    if (res.status === 207) return handleMultiStatus(batch, res);
    if (res.status >= 200 && res.status < 300) return batch.length;
    warn("usage_flush_rejected", {
      status: res.status,
      dropped: batch.length,
      first_idem: batch[0]?.idem,
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warn("usage_flush_error", { error: msg.slice(0, 200) });
    return 0;
  }
}

/**
 * Tolerant `207` multi-status handling: count `ok` / duplicate replays as
 * accepted, warn (and drop) everything else — including `quota_exceeded`,
 * which is deliberately NOT requeued to avoid poison-event flush loops.
 */
async function handleMultiStatus(
  batch: UsageEvent[],
  res: Response
): Promise<number> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    warn("usage_flush_207_unparseable", { dropped: batch.length });
    return 0;
  }
  const results = extractResults(body);
  if (!results) return batch.length;
  let accepted = 0;
  results.forEach((r, i) => {
    const idem = batch[i]?.idem ?? (r as Record<string, unknown>)["idem"];
    if (isAcceptedResult(r)) {
      accepted++;
      return;
    }
    warn("usage_event_rejected", {
      idem: typeof idem === "string" ? idem : batch[i]?.idem,
      code: (r as Record<string, unknown>)["code"],
      status: (r as Record<string, unknown>)["status"],
    });
  });
  return accepted;
}

function extractResults(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  for (const key of ["results", "events", "data"]) {
    const v = o[key];
    if (Array.isArray(v)) return v as unknown[];
  }
  return null;
}

function isAcceptedResult(r: unknown): boolean {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (o["ok"] === true) return true;
  if (o["ok"] === false) return false;
  const status = Number(o["status"]);
  if (Number.isFinite(status) && status >= 200 && status < 300) return true;
  const code = String(o["code"] ?? o["error"] ?? "").toLowerCase();
  if (!code) return false;
  if (/(duplicate|already|idempotent|replay|^ok$)/.test(code)) return true;
  // quota_exceeded / rate_limited / invalid: not accepted — dropped with warn.
  return false;
}
