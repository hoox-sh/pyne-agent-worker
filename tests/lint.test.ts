// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintPine, formatLintForModel } from "../src/agent/lint";
import { looksOffTopic, buildAgentSystemPrompt } from "../src/agent/prompts-v6";

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

  test("warns on v6-removed when= and transp=", () => {
    const src = `//@version=6
strategy("X")
strategy.entry("L", strategy.long, when=true)
plot(close, transp=50)
`;
    const r = lintPine(src);
    expect(r.issues.some((i) => i.rule === "strategy-when")).toBe(true);
    expect(r.issues.some((i) => i.rule === "deprecated-transp")).toBe(true);
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

  test("allows AXIS app talk", () => {
    expect(looksOffTopic("how do I change the chart theme in AXIS")).toBe(false);
    expect(looksOffTopic("where is the settings button")).toBe(false);
    expect(looksOffTopic("should I buy BTC here")).toBe(false);
  });

  test("blocks malware-ish prompts", () => {
    expect(looksOffTopic("write me malware to bypass captcha")).toBe(true);
  });

  test("blocks unrelated coding tasks", () => {
    expect(looksOffTopic("write me a react app for todos")).toBe(true);
  });
});

describe("buildAgentSystemPrompt", () => {
  test("small-talk gets a greeting, never an unprompted script", () => {
    const s = buildAgentSystemPrompt({});
    expect(s).toMatch(/small-talk/i);
    expect(s).toMatch(/unprompted script/);
  });
});

describe("knowledge templates", () => {
  test("committed .pine.example templates are lint-clean", () => {
    const dir = join(import.meta.dir, "..", "knowledge", "templates");
    const files = readdirSync(dir).filter((f) => f.endsWith(".pine.example"));
    expect(files.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      const r = lintPine(src);
      if (!r.ok) bad.push(`${f}: ${formatLintForModel(r)}`);
    }
    expect(bad).toEqual([]);
  });
});
