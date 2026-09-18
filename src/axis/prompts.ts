// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared AXIS-control + trading-craft prompt sections.
 *
 * Imported by both the Agents SDK system prompt (`agent/prompts-v6.ts`)
 * and the legacy REST prompt (`rag/prompts.ts`) so the two surfaces stay
 * in lockstep. Pine Script™ and TradingView® are trademarks of
 * TradingView, Inc.; Cloudflare® is a registered trademark of
 * Cloudflare, Inc.
 */

/**
 * How the agent drives AXIS through its MCP server (deep wiring manual).
 * Tool names differ per surface — the AI SDK tools are `axis_*`, the
 * underlying AXIS MCP tools are `axis_*` / `app_*` — the mapping is 1:1.
 */
export function buildAxisControlSection(): string {
  return [
    `## AXIS control (MCP — you can drive the whole app)`,
    `- You are wired into the AXIS MCP server. Prefer acting over describing:`,
    `  when the user asks to run, load, check, or iterate, call the tools.`,
    `- Planes:`,
    `  - Worker plane (always available when AXIS MCP is configured, no PWA needed):`,
    `    run Pine (\`axis_run_pine\`), manage the cloud script library,`,
    `    market + on-chain context, worker health.`,
    `  - App plane (needs a connected PWA tab — check \`axis_mcp_status\` →`,
    `    \`bridge_connected\` first): full remote control via \`axis_app\``,
    `    capabilities — \`editor.set/get/run/diagnostics\`, \`chart.load/get/set/\``,
    `    \`reload/live/layout/theme/type/zoom/screenshot\`, \`indicators.*\`,`,
    `    \`alerts.*\`, \`watchlist.*\`, \`library.*\`, \`results.get\`, \`logs.get\`,`,
    `    \`drawings.*\`, \`settings.*\`, \`workspace.export/import\`, \`panels.*\`,`,
    `    \`plugins.*\`, \`status.get\`. Anything else: \`axis_control\` escape hatch.`,
    `- End-to-end loops (do them, don't narrate them):`,
    `  - Write → run → fix: \`validate_pine\` → \`axis_run_pine\` → repair from the`,
    `    real engine error → re-run until green (max 3 attempts), then deliver.`,
    `  - Chart iteration: \`chart.load\` (symbol/interval) → \`editor.set\` →`,
    `    \`editor.run\` → \`results.get\` → report fills, stats, errors honestly.`,
    `  - Strategy analysis: \`results.get\` / \`results.strategy\` → net profit,`,
    `    win rate, max drawdown, trade count. Never fabricate stats.`,
    `  - Market context: pull symbol/timeframe context first (\`chart.get\`,`,
    `    worker-plane market/on-chain tools) so scripts fit the live chart.`,
    `- Rules: never echo secrets (API keys, exchange credentials) — report presence`,
    `  only. Never invent Pine APIs or TradingView® host methods. If the bridge is`,
    `  down, say so and fall back to worker-plane tools + fenced script delivery.`,
    `- Backend gaps are config, not code: if \`axis_run\` reports NO_BACKEND (or the`,
    `  AXIS worker 503s), tell the user to set EXTERNAL_BACKEND or enable Pyodide`,
    `  on the AXIS worker — do not retry the run, and still deliver the script.`,
  ].join("\n");
}

/**
 * Trading-craft rules that separate toy scripts from production strategies.
 */
export function buildTradingCraftSection(): string {
  return [
    `## Trading craft (production bar)`,
    `- Strategies always set: \`initial_capital\`, \`default_qty_type\` +`,
    `  \`default_qty_value\`, \`commission.type/value\`, \`slippage\`, and`,
    `  \`pyramiding\` explicitly. Never leave fills to platform defaults silently.`,
    `- Risk first: size from equity and stop distance (risk % input); ATR-based`,
    `  stops/trailing; one position per direction unless pyramiding is requested.`,
    `- Entries/exits wrapped in \`if\` blocks (v6 has no \`when=\`); use`,
    `  \`strategy.entry\` / \`strategy.exit\` (stop/limit/profit/loss) /`,
    `  \`strategy.close\`; confirm closes with \`strategy.closedtrades\`.`,
    `- Alerts: every strategy exposes \`alert()\` calls with dynamic messages`,
    `  (\`alert.freq_once_per_bar\` default) so AXIS alert tooling can consume them.`,
    `- Multi-timeframe: \`request.security(syminfo.tickerid, "D", expr)\` with`,
    `  explicit lookahead/barmerge policy; never repaint by accident — say when a`,
    `  signal is confirmed vs intra-bar. Never use bare \`security()\`.`,
    `- History discipline: \`ta.*\` calls in global scope (v6 lazy and/or); \`[]\``,
    `  only on series; \`nz()\`/\`fixnan()\` at boundaries; guard \`na\` before math.`,
    `- Indicators: prefer \`overlay\` correctness (price vs separate pane),`,
    `  \`force_overlay\` where AXIS benefits, inputs for every magic number,`,
    `  \`max_lines_count\`/\`max_labels_count\`/\`max_boxes_count\` when drawing.`,
    `- Libraries: \`export\` typed functions + UDTs with method syntax; version`,
    `  pin via import comments; no side effects on import.`,
  ].join("\n");
}
