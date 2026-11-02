// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-request specialist quota.
 * - maxSpecialists: total specialists this turn (default 5)
 * - concurrency: in-flight generateText caps (default 3)
 * Isolate fuse is separate (shared across concurrent REST turns).
 */

export type QuotaAcquireOk = { ok: true };
export type QuotaAcquireFail = {
  ok: false;
  error: string;
  skipped?: boolean;
};
export type QuotaAcquireResult = QuotaAcquireOk | QuotaAcquireFail;

export type SpecialistQuota = {
  tryAcquire: () => QuotaAcquireResult;
  release: () => void;
  /** Specialists acquired this turn (never decreases). */
  readonly active: number;
  /** Currently running specialists. */
  readonly inFlight: number;
  readonly maxSpecialists: number;
  readonly concurrency: number;
};

/** Isolate-wide in-flight fuse (not a fairness lock). */
const isolateInflight = { n: 0 };

export function isolateSubagentInflight(): number {
  return isolateInflight.n;
}

/** Test helper — reset isolate fuse between cases. */
export function _resetIsolateSubagentFuse(): void {
  isolateInflight.n = 0;
}

export function createQuota(opts: {
  maxSpecialists: number;
  concurrency: number;
  isolateCap?: number;
}): SpecialistQuota {
  const maxSpecialists = Math.max(0, Math.min(5, Math.floor(opts.maxSpecialists)));
  const concurrency = Math.max(1, Math.min(5, Math.floor(opts.concurrency)));
  const isolateCap =
    opts.isolateCap != null
      ? Math.max(1, Math.min(32, Math.floor(opts.isolateCap)))
      : Math.max(8, concurrency);
  let active = 0;
  let inFlight = 0;

  return {
    get active() {
      return active;
    },
    get inFlight() {
      return inFlight;
    },
    get maxSpecialists() {
      return maxSpecialists;
    },
    get concurrency() {
      return concurrency;
    },
    tryAcquire(): QuotaAcquireResult {
      if (active >= maxSpecialists || inFlight >= concurrency) {
        return { ok: false, error: "subagent quota exceeded" };
      }
      if (isolateInflight.n >= isolateCap) {
        return {
          ok: false,
          error: "isolate busy",
          skipped: true,
        };
      }
      active += 1;
      inFlight += 1;
      isolateInflight.n += 1;
      return { ok: true };
    },
    release(): void {
      if (inFlight > 0) inFlight -= 1;
      if (isolateInflight.n > 0) isolateInflight.n -= 1;
    },
  };
}

export function maxSpecialistsFromEnv(env: Env, requested?: number): number {
  const envMax = Number(env.MAX_SUBAGENTS || "6");
  const ceiling = Number.isFinite(envMax)
    ? Math.max(0, Math.min(5, Math.floor(envMax) - 1))
    : 5;
  if (requested == null || !Number.isFinite(requested)) return ceiling;
  return Math.max(0, Math.min(ceiling, Math.floor(requested)));
}

export function concurrencyFromEnv(env: Env): number {
  const n = Number(env.SUBAGENT_CONCURRENCY || "3");
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(5, Math.floor(n));
}
