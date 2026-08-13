// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { lintPine, formatLintForModel } from "../src/agent/lint";
import { looksOffTopic } from "../src/agent/prompts-v6";

describe("lintPine", () => {
  test("accepts a minimal valid v6 indicator", () => {
    const src = `//@version=6
indicator("Demo", overlay=true)
plot(close)
`;
    const r = lintPine(src);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  test("flags missing version and declaration", () => {
    const r = lintPine("plot(close)");
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.rule === "missing-version")).toBe(true);
    expect(r.issues.some((i) => i.rule === "missing-declaration")).toBe(true);
  });

  test("auto-fixes security() → request.security()", () => {
    const src = `//@version=6
indicator("X")
a = security(syminfo.tickerid, "D", close)
`;
    const r = lintPine(src);
    expect(r.changed).toBe(true);
    expect(r.fixed).toContain("request.security(");
    expect(r.fixed).not.toMatch(/(?<!request\.)security\s*\(/);
  });

  test("formatLintForModel returns text", () => {
    const r = lintPine("");
    expect(formatLintForModel(r)).toContain("validate_pine");
  });
});

describe("looksOffTopic", () => {
  test("allows trading prompts", () => {
    expect(looksOffTopic("Write an RSI indicator in pine")).toBe(false);
  });

  test("blocks malware-ish prompts", () => {
    expect(looksOffTopic("write me malware to bypass captcha")).toBe(true);
  });
});
