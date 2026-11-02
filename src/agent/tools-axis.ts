// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * First-class AXIS MCP wrappers for the agent tool loop.
 * Escape hatches (`axis_control`, `axis_app`) stay for anything else.
 */

import { tool } from "ai";
import { z } from "zod";
import { formatLintForModel, lintPine } from "./lint";
import {
  axisApp,
  axisMcpCallTool,
  axisMcpListTools,
  axisMcpStatus,
  axisRunPine,
  isAxisMcpConfigured,
} from "../axis/mcp-client";

async function invokeApp(
  env: Env,
  capability: string,
  payload: Record<string, unknown> = {}
) {
  const res = await axisApp(env, { capability, payload });
  if (!res.ok) return { ok: false as const, error: res.error, code: res.code ?? null };
  return {
    ok: true as const,
    text: res.text,
    structured: res.structured ?? null,
    truncated: res.truncated,
  };
}

function capParams(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= 8) break;
    out[k] = v;
    n += 1;
  }
  return out;
}

/** AXIS status / escape-hatch / run / first-class App-plane wrappers. */
export function createAxisTools(env: Env) {
  return {
    axis_mcp_status: tool({
      description:
        "Check the AXIS MCP wiring: configured endpoint, reachability, tool count, and whether a PWA tab is bridged (app-plane control needs bridge_connected > 0). Call before any axis_* control tool.",
      inputSchema: z.object({}),
      execute: async () => {
        const status = await axisMcpStatus(env);
        return {
          ok: status.reachable,
          configured: status.configured,
          url: status.url,
          reachable: status.reachable,
          latency_ms: status.latency_ms,
          server: status.server ?? null,
          tools: status.tools ?? null,
          bridge_connected: status.bridge_connected ?? 0,
          error: status.error ?? null,
          hint: !status.configured
            ? "Set AXIS_MCP_URL on the worker to enable AXIS control."
            : status.bridge_connected
              ? "App-plane control available."
              : "Worker-plane only — ask the user to open AXIS → Settings → MCP for live-chart control.",
        };
      },
    }),

    axis_mcp_tools: tool({
      description:
        "List the AXIS MCP tool catalog (worker-plane axis_* + app-plane app_*). Use axis_control to call anything listed here.",
      inputSchema: z.object({
        refresh: z.boolean().optional().describe("Bypass the 5-minute cache"),
      }),
      execute: async ({ refresh }) => {
        if (!isAxisMcpConfigured(env)) {
          return { ok: false, error: "AXIS MCP not configured (set AXIS_MCP_URL)." };
        }
        const tools = await axisMcpListTools(env, { refresh: refresh ?? false });
        return { ok: true, count: tools.length, tools };
      },
    }),

    axis_control: tool({
      description:
        "Escape hatch: call any AXIS MCP tool by name (axis_run, axis_scripts_put, axis_market, axis_onchain, app_invoke, app_get, app_set, …). Prefer axis_run_pine / axis_app / first-class wrappers when they fit.",
      inputSchema: z.object({
        tool: z
          .string()
          .min(1)
          .max(80)
          .describe("AXIS MCP tool name, e.g. 'axis_scripts_put' or use axis_app for chart.load"),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Tool arguments as a JSON object"),
      }),
      execute: async ({ tool: name, args }) => {
        const res = await axisMcpCallTool(env, name, args ?? {});
        if (!res.ok) return { ok: false, error: res.error, code: res.code ?? null };
        return {
          ok: true,
          text: res.text,
          structured: res.structured ?? null,
          truncated: res.truncated,
        };
      },
    }),

    axis_run_pine: tool({
      description:
        "Run Pine Script™ on AXIS (worker plane, no PWA needed) and get the real engine result. Lint first, then run, then repair from the actual error. Worker supplies synthetic bars — do not pass ticker or timeframe.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000).describe("Full Pine source to execute"),
      }),
      execute: async ({ code }) => {
        const lint = lintPine(code);
        if (!lint.ok) {
          return {
            ok: false,
            stage: "lint",
            summary: formatLintForModel(lint),
            issues: lint.issues,
            hint: "Fix lint errors before running.",
          };
        }
        const res = await axisRunPine(env, { script: lint.fixed });
        if (!res.ok) {
          return { ok: false, stage: "run", error: res.error, code: res.code ?? null };
        }
        return {
          ok: true,
          stage: "run",
          text: res.text,
          structured: res.structured ?? null,
          truncated: res.truncated,
          lint_fixed: lint.changed,
        };
      },
    }),

    axis_app: tool({
      description:
        "Drive the connected AXIS PWA via any capability (editor.*, chart.*, results.get, alerts.*, …). Prefer first-class wrappers when they fit. Requires a bridged tab (see axis_mcp_status).",
      inputSchema: z.object({
        capability: z
          .string()
          .min(3)
          .max(80)
          .describe("App capability, e.g. 'editor.set', 'chart.load', 'results.get'"),
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Capability payload as a JSON object"),
        session: z.string().max(80).optional().describe("Bridge session (usually omitted)"),
      }),
      execute: async ({ capability, payload, session }) => {
        const res = await axisApp(env, {
          capability,
          payload: payload ?? {},
          session,
        });
        if (!res.ok) return { ok: false, error: res.error, code: res.code ?? null };
        return {
          ok: true,
          text: res.text,
          structured: res.structured ?? null,
          truncated: res.truncated,
        };
      },
    }),

    axis_chart_load: tool({
      description:
        "Load OHLCV on the bridged AXIS chart (app_invoke chart.load). Needs bridge_connected > 0.",
      inputSchema: z.object({
        symbol: z.string().min(1).max(32).describe("Ticker, e.g. BTCUSDT"),
        interval: z.string().max(12).optional().describe("Bar interval, e.g. 1h"),
        source: z.string().max(40).optional().describe("Data source id when required"),
      }),
      execute: async ({ symbol, interval, source }) => {
        const payload: Record<string, unknown> = { symbol };
        if (interval) payload.interval = interval;
        if (source) payload.source = source;
        return invokeApp(env, "chart.load", payload);
      },
    }),

    axis_editor_set: tool({
      description:
        "Set the AXIS editor document to Pine source (app_invoke editor.set). Needs a bridged tab.",
      inputSchema: z.object({
        doc: z.string().min(1).max(80_000).describe("Full Pine source for the editor"),
      }),
      execute: async ({ doc }) => invokeApp(env, "editor.set", { doc }),
    }),

    axis_editor_run: tool({
      description:
        "Run the current AXIS editor document against loaded bars (app_invoke editor.run). Needs a bridged tab.",
      inputSchema: z.object({}),
      execute: async () => invokeApp(env, "editor.run", {}),
    }),

    axis_alerts_create: tool({
      description:
        "Create an AXIS alert (app_invoke alerts.create). Payload matches AXIS dispatch — no invented condition/message fields.",
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        symbol: z.string().max(32).optional(),
        kind: z.string().max(40).optional().describe("Default price_cross"),
        params: z.record(z.string(), z.unknown()).optional().describe("At most 8 keys"),
        interval: z.string().max(12).optional(),
        webhookUrl: z.string().max(500).optional(),
        enabled: z.boolean().optional(),
      }),
      execute: async ({ name, symbol, kind, params, interval, webhookUrl, enabled }) => {
        const payload: Record<string, unknown> = {
          name,
          kind: kind || "price_cross",
          params: capParams(params),
        };
        if (symbol) payload.symbol = symbol;
        if (interval) payload.interval = interval;
        if (webhookUrl) payload.webhookUrl = webhookUrl;
        if (typeof enabled === "boolean") payload.enabled = enabled;
        return invokeApp(env, "alerts.create", payload);
      },
    }),

    axis_results_get: tool({
      description:
        "Read the last AXIS run snapshot including strategy stats (app_invoke results.get). There is no results.strategy tool — stats are fields of this snapshot.",
      inputSchema: z.object({}),
      execute: async () => invokeApp(env, "results.get", {}),
    }),

    axis_engine_tick: tool({
      description:
        "Force one AXIS engine tick (app_invoke engine.tick). Mutating — only after axis_mcp_status shows bridge_connected > 0.",
      inputSchema: z.object({}),
      execute: async () => invokeApp(env, "engine.tick", {}),
    }),
  };
}

export type AxisTools = ReturnType<typeof createAxisTools>;
