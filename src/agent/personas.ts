// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Personas — one agent, three stances.
 *
 * - `pine`: Pine Script™ coder (default). Writes production scripts.
 * - `axis`: AXIS app guide + operator. Answers anything about the app and
 *   *changes* it through MCP (settings, theme, layout, watchlist, editor…).
 * - `trader`: trading mentor/analyst. Market analysis, strategy review,
 *   risk math, psychology — pulls live context before opining.
 * - `auto`: inferred per message (explicit selection always wins).
 *
 * Pure detection/selection logic lives here; the prose lives in
 * `axis/prompts.ts` so REST + Agents SDK surfaces stay in lockstep.
 */

import {
  buildAxisControlSection,
  buildAxisOperatorSection,
  buildTraderSection,
  buildTradingCraftSection,
} from "../axis/prompts";

export type PersonaId = "auto" | "pine" | "axis" | "trader";

const PERSONAS: Record<
  Exclude<PersonaId, "auto">,
  { label: string; description: string }
> = {
  pine: {
    label: "Pine coder",
    description: "Production Pine Script™ (v6-first) for indicators, strategies, libraries.",
  },
  axis: {
    label: "AXIS operator",
    description:
      "Anything about the AXIS app — and acts on it via MCP (run, load, theme, settings, workspace…).",
  },
  trader: {
    label: "Trader",
    description:
      "Market analysis, trade review, strategy critique, risk math, trading psychology.",
  },
};

export function listPersonas(): Array<{ id: PersonaId; label: string; description: string }> {
  return (Object.keys(PERSONAS) as Array<Exclude<PersonaId, "auto">>).map((id) => ({
    id,
    ...PERSONAS[id]!,
  }));
}

export function normalizePersona(raw: unknown): PersonaId {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "pine" || v === "axis" || v === "trader" || v === "auto") return v;
  return "auto";
}

/** App-surface signals: the user talks about AXIS itself, not Pine. */
const AXIS_RE = new RegExp(
  "\\b(" +
    [
      "axis",
      "app",
      "settings?",
      "theme",
      "dark mode",
      "light mode",
      "panels?",
      "layout",
      "watchlist",
      "manager",
      "plugin",
      "workspace",
      "topbar",
      "status ?bar",
      "command palette",
      "backfill",
      "data source manager",
      "workers manager",
      "script library",
      "engine",
      "stream",
      "mcp",
      "bridge",
      "tab",
      "button",
      "dialog",
      "chart layout",
      "timeframe",
      "symbol",
      "ticker",
    ].join("|") +
    ")\\b"
);

/** Trading-desk signals without an explicit code request. */
const TRADER_RE = new RegExp(
  "\\b(" +
    [
      "should i (buy|sell|long|short|hold|exit)",
      "is .* (bullish|bearish)",
      "market (analysis|outlook|overview|regime)",
      "analyze",
      "analysis",
      "risk",
      "position siz",
      "drawdown",
      "win ?rate",
      "profit factor",
      "sharpe",
      "psychology",
      "fomo",
      "revenge trad",
      "journal",
      "backtest result",
      "session",
      "market hours",
      "news",
      "bull ?market",
      "bear ?market",
      "sideways|choppy|ranging",
      "support|resistance",
      "breakout",
      "divergence",
      "what do you think (of|about)",
      "outlook",
    ].join("|") +
    ")\\b"
);

/** Explicit code-shape signals. */
const PINE_RE = /\b(write|create|generate|build|implement|code|indicator|strategy|library|plot|pine|script|function|method|compile|syntax|error|fix)\b/;

/**
 * Infer the working persona. Explicit selection wins; otherwise app-talk →
 * axis, trading-desk talk → trader, code-shape → pine, fallback pine
 * (current default behavior for everything else).
 */
export function detectPersona(userText: string, explicit?: unknown): Exclude<PersonaId, "auto"> {
  const forced = normalizePersona(explicit);
  if (forced !== "auto") return forced;
  const t = String(userText || "").toLowerCase();
  if (AXIS_RE.test(t) && !PINE_RE.test(t)) return "axis";
  if (TRADER_RE.test(t) && !PINE_RE.test(t)) return "trader";
  if (PINE_RE.test(t)) return "pine";
  if (TRADER_RE.test(t)) return "trader";
  if (AXIS_RE.test(t)) return "axis";
  return "pine";
}

/**
 * System-prompt section for a resolved (non-auto) persona.
 * Each stance composes only what it needs — no duplication walls.
 */
export function personaSystemSection(persona: Exclude<PersonaId, "auto">): string {
  const head = `## Active persona: ${PERSONAS[persona]!.label}`;
  switch (persona) {
    case "axis":
      return [head, buildAxisControlSection(), "", buildAxisOperatorSection()].join("\n");
    case "trader":
      return [head, buildTraderSection(), "", buildAxisControlSection()].join("\n");
    case "pine":
      return [head, buildTradingCraftSection(), "", buildAxisControlSection()].join("\n");
  }
}

/** Action verbs that mean "do it", not "tell me". */
const ACTION_VERB_RE =
  /\b(change|set|switch|open|load|run|add|remove|delete|enable|disable|apply|insert|save|update|refresh|reload|start|stop|clear|do it|for me|make it|go ahead|please do)\b/;

/**
 * True when the request wants the agent to ACT (MCP calls), not just answer.
 * Conservative: needs an action verb, optionally aimed at app nouns. The
 * REST path only spins the agentic tool loop in this case (GPU budget).
 */
export function looksActionable(userText: string, persona?: PersonaId): boolean {
  const t = String(userText || "").toLowerCase().trim();
  if (!t || t.length < 8) return false;
  if (!ACTION_VERB_RE.test(t)) return false;
  if (persona === "axis" || persona === "trader") return true;
  // Unspecified persona: require the verb to aim at the app/trading surface,
  // so "run the numbers" prose doesn't trigger tool loops.
  return AXIS_RE.test(t) || TRADER_RE.test(t) || /\b(script|strategy|indicator|backtest)\b/.test(t);
}
