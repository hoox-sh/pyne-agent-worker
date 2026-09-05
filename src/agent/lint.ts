// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight Pine Script™ heuristic linter (no full AST).
 * Catches common LLM hallucinations before delivery / feeds self-repair.
 */

export type LintSeverity = "error" | "warning";

export type LintIssue = {
  severity: LintSeverity;
  rule: string;
  message: string;
  line?: number;
};

export type LintResult = {
  ok: boolean;
  issues: LintIssue[];
  /** Best-effort auto-fixes applied to source (may be identical to input). */
  fixed: string;
  changed: boolean;
};

/** Known-safe ta.* subset (not exhaustive — missing names → warning, not hard fail). */
const KNOWN_TA = new Set(
  [
    "sma",
    "ema",
    "rma",
    "wma",
    "vwma",
    "swma",
    "alma",
    "hma",
    "rsi",
    "macd",
    "stoch",
    "bb",
    "bbw",
    "atr",
    "tr",
    "highest",
    "lowest",
    "change",
    "roc",
    "mom",
    "cci",
    "cmo",
    "mfi",
    "obv",
    "vwap",
    "supertrend",
    "dmi",
    "adx",
    "sar",
    "linreg",
    "correlation",
    "stdev",
    "variance",
    "percentile_nearest_rank",
    "percentile_linear_interpolation",
    "barssince",
    "valuewhen",
    "crossover",
    "crossunder",
    "cross",
    "rising",
    "falling",
    "pivothigh",
    "pivotlow",
    "cum",
    "accdist",
    "iii",
    "nvi",
    "pvi",
    "pvt",
    "wad",
    "wvad",
    "median",
    "mode",
    "range",
    "percentrank",
    "max",
    "min",
    "sum",
  ].map((s) => s.toLowerCase())
);

/** Deprecated / hallucinated patterns. */
const BANNED: Array<{ re: RegExp; rule: string; message: string; fix?: (s: string) => string }> = [
  {
    re: /\bsecurity\s*\(/g,
    rule: "deprecated-security",
    message: "Use request.security(...) instead of security(...).",
    fix: (s) => s.replace(/\bsecurity\s*\(/g, "request.security("),
  },
  {
    re: /\bstudy\s*\(/g,
    rule: "deprecated-study",
    message: "study() is deprecated; use indicator().",
    fix: (s) => s.replace(/\bstudy\s*\(/g, "indicator("),
  },
  {
    re: /strategy\.(entry|order|exit|close|close_all|cancel|cancel_all)\s*\([^)]*\bwhen\s*=/g,
    rule: "strategy-when",
    message:
      "v6 removed when= on strategy.* order calls; wrap the call in an if-condition.",
  },
  {
    re: /\btransp\s*=/g,
    rule: "deprecated-transp",
    message: "transp= was removed in v6; use color.new(color, transparency).",
  },
  {
    re: /\bta\.(fake|magic|super_rsi|ultimate_buy|nonexistent)\b/gi,
    rule: "hallucinated-ta",
    message: "Suspected hallucinated ta.* function.",
  },
];

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split(/\r?\n/).length;
}

/**
 * Lint + light auto-fix for generated Pine.
 */
export function lintPine(source: string): LintResult {
  let fixed = String(source || "");
  const issues: LintIssue[] = [];
  let changed = false;

  if (!fixed.trim()) {
    return {
      ok: false,
      issues: [{ severity: "error", rule: "empty", message: "Script is empty." }],
      fixed,
      changed: false,
    };
  }

  if (!/\/\/\s*@version\s*=\s*[56]\b/i.test(fixed)) {
    issues.push({
      severity: "error",
      rule: "missing-version",
      message: "Missing //@version=5 or //@version=6 directive.",
    });
  }

  if (!/\b(indicator|strategy|library)\s*\(/.test(fixed)) {
    issues.push({
      severity: "error",
      rule: "missing-declaration",
      message: "Missing indicator()/strategy()/library() declaration.",
    });
  }

  for (const ban of BANNED) {
    ban.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const re = new RegExp(ban.re.source, ban.re.flags);
    while ((m = re.exec(fixed)) !== null) {
      issues.push({
        severity: ban.rule === "strategy-when" || ban.rule === "deprecated-transp" ? "warning" : "error",
        rule: ban.rule,
        message: ban.message,
        line: lineOf(fixed, m.index),
      });
    }
    if (ban.fix) {
      const next = ban.fix(fixed);
      if (next !== fixed) {
        fixed = next;
        changed = true;
      }
    }
  }

  // Unknown ta.* warnings (heuristic)
  const taRe = /\bta\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let tm: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((tm = taRe.exec(fixed)) !== null) {
    const name = tm[1]!.toLowerCase();
    if (KNOWN_TA.has(name) || seen.has(name)) continue;
    seen.add(name);
    // Allow nested namespaces like ta.something if short & common patterns
    if (name.length <= 2) continue;
    issues.push({
      severity: "warning",
      rule: "unknown-ta",
      message: `ta.${tm[1]} is not in the known-safe builtin subset — verify via search_knowledge_base.`,
      line: lineOf(fixed, tm.index),
    });
  }

  // series history misuse heuristic: foo(close)[1] vs close[1]
  if (/\bplot\s*\(\s*[^)]+\)\s*\[/.test(fixed)) {
    issues.push({
      severity: "warning",
      rule: "history-on-plot",
      message: "History operator [] applied after plot() is invalid — index the series first.",
    });
  }

  const hasError = issues.some((i) => i.severity === "error");
  return { ok: !hasError, issues, fixed, changed };
}

export function formatLintForModel(result: LintResult): string {
  if (result.ok && !result.issues.length) {
    return "validate_pine: OK — no issues.";
  }
  const lines = result.issues.map(
    (i) =>
      `- [${i.severity}] ${i.rule}${i.line != null ? ` L${i.line}` : ""}: ${i.message}`
  );
  return [
    `validate_pine: ${result.ok ? "warnings only" : "FAILED"}`,
    ...lines,
    result.changed ? "Auto-fixes applied to source (security→request.security, study→indicator)." : "",
  ]
    .filter(Boolean)
    .join("\n");
}
