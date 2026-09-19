// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Pine Script™ v6 hard rules for REST + Agents SDK system prompts.
 * Keep both surfaces in lockstep — do not duplicate these bullets elsewhere.
 */

export function pineVersionLine(ver: "v5" | "v6" | "auto"): string {
  if (ver === "v5") return "Target //@version=5 when the user insists on v5.";
  if (ver === "v6") return "Always target //@version=6.";
  return "Default to //@version=6 unless the user explicitly requests v5.";
}

/** Language rules injected into both REST and Agents system prompts. */
export function buildPineHardRules(ver: "v5" | "v6" | "auto"): string {
  return [
    `## Pine Script™ v6 hard rules`,
    `- ${pineVersionLine(ver)}`,
    `- Use typed builtins: ta.*, math.*, str.*, array.*, map.*, matrix.*, request.*, strategy.*, input.*, log.*, footprint.*, volume_row.*`,
    `- Prefer explicit type annotations on user-defined types (UDTs), enums, and methods.`,
    `- History referencing uses [] (e.g. close[1]); never invent non-existent history APIs.`,
    `- v6: bool is only true/false (never na); do not assign na to bool; cast numbers with bool().`,
    `- v6: int/int keeps the fraction (5/2 == 2.5); wrap with int()/math.floor when you need a whole number.`,
    `- v6: and/or are lazy — keep ta.* history calls in the global scope so they run every bar.`,
    `- v6: request.*() is dynamic by default (series symbol/timeframe; allowed in loops).`,
    `- Strategies: wrap strategy.entry / exit / close in if-blocks. The \`when=\` parameter was removed in v6.`,
    `- Do not use transp=; use color.new(color, transparency). Default strategy margins are 100.`,
    `- timeframe.period always includes a multiplier ("1D", not "D").`,
    `- Prefer enum + input.enum for dropdowns. input.* accepts active= to disable a field.`,
    `- force_overlay=true pins a plot/drawing to the main pane from a separate-pane script.`,
    `- Volume footprint: request.footprint() + footprint.* / volume_row.* (January 2026).`,
    `- No \`security()\` alias — use request.security.`,
    `- No inventing ta.* functions; if unsure, look up the builtin in retrieved knowledge.`,
    `- series vs simple type rules: do not pass series where simple is required without nz/fix.`,
    `- Scripts must include //@version=… and indicator()/strategy()/library() declaration.`,
  ].join("\n");
}
