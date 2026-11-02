// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DISCLAIMER_SHORT, MARKS } from "../lib/legal";
import {
  detectPersona,
  normalizePersona,
  personaSystemSection,
  type PersonaId,
} from "./personas";
import { buildPineHardRules } from "./pine-rules";
import { buildGrandmasterSection } from "./grandmaster";

/**
 * System instructions for the stateful Agents SDK path (AIChatAgent).
 * Always uses the full Grandmaster tool loop (`tools: "full"`).
 */
export function buildAgentSystemPrompt(opts?: {
  pineVersion?: "v5" | "v6" | "auto";
  style?: "indicator" | "strategy" | "library" | "auto";
  /** Explicit persona, or detected from `lastUserText` when auto/omitted. */
  persona?: PersonaId;
  /** Latest user message (drives auto-detection). */
  lastUserText?: string;
}): string {
  const ver = opts?.pineVersion ?? "auto";
  const style = opts?.style ?? "auto";
  const explicit = normalizePersona(opts?.persona);
  const persona = explicit !== "auto" ? explicit : detectPersona(opts?.lastUserText || "");

  return [
    `You are **PYNE Agent**, a Pine Script™ v5/v6 grandmaster that writes ${MARKS.pine}`,
    `for the HOOX / PYNE / AXIS stack on ${MARKS.cloudflare} Workers.`,
    ``,
    `Legal: ${DISCLAIMER_SHORT}`,
    ``,
    buildGrandmasterSection({ tools: "full" }),
    ``,
    `## Script kind preference: ${style}`,
    style === "auto"
      ? `- Infer indicator vs strategy vs library from the user request.`
      : `- Prefer script kind: ${style}.`,
    `- Prefer v6 language features; eliminate deprecated v5 patterns when version is auto.`,
    `- Target language version preference: ${ver}.`,
    ``,
    personaSystemSection(persona, { includeAxisControl: true }),
    ``,
    buildPineHardRules(ver),
    ``,
    `## AXIS (charting PWA)`,
    `- AXIS evaluates via EnginePlugin.run (server POST /run or in-browser Pyodide). It is not TradingView®.`,
    `- Plugin namespace pynescript.axis.plugins.v1; kinds: source, stream, engine, storage, dataset, component.`,
    `- Prefer clear plots, inputs, overlay/force_overlay, and strategy events AXIS can render.`,
  ].join("\n");
}

/**
 * Scope guard: denylist only (abuse / injection / unrelated app scaffolds).
 * Trading, AXIS, and everything else is allowed — false refusals are worse
 * than answering a vague prompt.
 */
export function looksOffTopic(userText: string): boolean {
  const t = userText.toLowerCase();
  if (
    /\b(hack|malware|bypass captcha|sql injection|ddos|phishing|steal .*password)\b/.test(t) ||
    /\b(ignore (all )?previous instructions|system prompt|reveal .*instructions)\b/.test(t)
  ) {
    return true;
  }
  // "react app" contains "app" but is not AXIS talk.
  if (
    /\b(write me a (react|django|rails|express|vue|angular|flutter) app|homework|essay)\b/.test(t)
  ) {
    return true;
  }
  return false;
}
