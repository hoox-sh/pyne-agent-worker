// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical legal marks for user-facing strings.
 *
 * Always use Pine Script™ and TradingView® (and Cloudflare® where relevant).
 * This project is independent and not affiliated with TradingView, Inc.
 */

export const MARKS = {
  pine: "Pine Script™",
  tradingView: "TradingView®",
  cloudflare: "Cloudflare®",
  workersAi: "Workers AI™",
  vectorize: "Vectorize™",
  aiSearch: "AI Search™",
} as const;

export const DISCLAIMER_SHORT =
  "Pine Script™ and TradingView® are trademarks of TradingView, Inc. " +
  "Cloudflare® is a registered trademark of Cloudflare, Inc. " +
  "This project is independent and not affiliated with or endorsed by TradingView, Inc. or Cloudflare, Inc.";

export const DISCLAIMER_CONTENT =
  "Knowledge bases must not redistribute proprietary TradingView® built-in " +
  "indicator/strategy sources. Operators ingest documentation and permitted " +
  "corpora into private R2/Vectorize only; this repository never ships those files.";

/** Ensure response / UI copy mentions trademarks at least once. */
export function withLegalFooter(text: string): string {
  if (/Pine Script™/.test(text) && /TradingView®/.test(text)) return text;
  return `${text.trim()}\n\n—\n${DISCLAIMER_SHORT}`;
}
