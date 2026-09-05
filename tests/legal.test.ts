// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  DISCLAIMER_SHORT,
  MARKS,
  withLegalFooter,
} from "../src/lib/legal";
import {
  buildSystemPrompt,
  extractPineBlock,
  formatRagContext,
  wantsPineScript,
} from "../src/rag/prompts";

describe("legal marks", () => {
  test("MARKS use TM and R", () => {
    expect(MARKS.pine).toContain("Pine Script");
    expect(MARKS.pine).toContain("™");
    expect(MARKS.tradingView).toContain("TradingView");
    expect(MARKS.tradingView).toContain("®");
    expect(MARKS.cloudflare).toContain("Cloudflare");
    expect(MARKS.cloudflare).toContain("®");
  });

  test("disclaimer mentions both vendors", () => {
    expect(DISCLAIMER_SHORT).toContain("Pine Script™");
    expect(DISCLAIMER_SHORT).toContain("TradingView®");
    expect(DISCLAIMER_SHORT).toContain("Cloudflare®");
    expect(DISCLAIMER_SHORT.toLowerCase()).toContain("not affiliated");
  });

  test("withLegalFooter appends when missing", () => {
    const out = withLegalFooter("hello");
    expect(out).toContain("Pine Script™");
    expect(out).toContain("TradingView®");
  });

  test("withLegalFooter no double footer", () => {
    const base = `x Pine Script™ y TradingView® z`;
    expect(withLegalFooter(base)).toBe(base);
  });
});

describe("prompts", () => {
  test("system prompt carries marks and non-affiliation", () => {
    const s = buildSystemPrompt({ pineVersion: "v6", style: "strategy" });
    expect(s).toContain("Pine Script™");
    expect(s).toContain("TradingView®");
    expect(s).toContain("Cloudflare®");
    expect(s.toLowerCase()).toMatch(/not.*affiliated|independent|disclaimer/i);
  });

  test("extractPineBlock", () => {
    const text = "here\n```pine\n//@version=6\nindicator('x')\n```\nbye";
    expect(extractPineBlock(text)).toContain("//@version=6");
  });

  test("formatRagContext empty", () => {
    expect(formatRagContext([])).toContain("Pine Script™");
  });

  test("system prompt forbids Example Workflow essays", () => {
    const s = buildSystemPrompt({ pineVersion: "v6" });
    expect(s).toContain("Mode B");
    expect(s).toMatch(/Example Workflow/);
    expect(s).toContain("DSM");
  });
});

describe("wantsPineScript", () => {
  test("AXIS how-to is not a script request", () => {
    expect(
      wantsPineScript("How do I backfill historical data in AXIS using the Data Source Manager?")
    ).toBe(false);
  });

  test("script requests stay script requests", () => {
    expect(wantsPineScript("v6 RSI strategy with ATR trailing stop")).toBe(true);
    expect(wantsPineScript("write an ema crossover indicator")).toBe(true);
  });
});
