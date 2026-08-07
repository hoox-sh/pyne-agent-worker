// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Small synthetic OHLCV fixture for pyne-worker validation runs.
 * Not market data — only enough bars for parse/runtime smoke checks.
 */

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** ~64 bars of deterministic random-walk prices (unix seconds). */
export function syntheticBars(count = 64): Bar[] {
  const n = Math.max(32, Math.min(count, 256));
  const bars: Bar[] = [];
  let price = 100;
  // Fixed epoch so retries are stable
  let t = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    // Simple LCG-ish step
    const drift = ((i * 37) % 11) - 5;
    const open = price;
    const close = Math.max(1, open + drift * 0.15);
    const high = Math.max(open, close) + 0.4;
    const low = Math.min(open, close) - 0.4;
    bars.push({
      time: t,
      open,
      high,
      low,
      close,
      volume: 1000 + (i % 50) * 10,
    });
    price = close;
    t += 60;
  }
  return bars;
}
