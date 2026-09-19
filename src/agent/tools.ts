// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { tool } from "ai";
import { z } from "zod";
import { searchKnowledge } from "./knowledge";
import { formatLintForModel, lintPine } from "./lint";
import {
  axisApp,
  axisMcpCallTool,
  axisMcpListTools,
  axisMcpStatus,
  axisRunPine,
  isAxisMcpConfigured,
} from "../axis/mcp-client";

export type AxisPane = {
  id: string;
  kind: "price" | "oscillator" | "volume" | "custom";
  title?: string;
  height?: number;
  overlays?: string[];
};

export type AxisChartLayout = {
  version: 1;
  title?: string;
  theme?: "dark" | "light" | "auto";
  panes: AxisPane[];
  colors?: Record<string, string>;
};

/**
 * Server-side tools for PyneAgent (AIChatAgent + MCP).
 * Strict Zod schemas prevent malformed tool args from crashing the DO.
 */
export function createAgentTools(env: Env) {
  return {
    search_knowledge_base: tool({
      description:
        "Search Pine Script™ / PYNE knowledge (AI Search hybrid or Vectorize fallback) for exact syntax, builtins, and limits before writing code.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .max(500)
          .describe("Search query, e.g. 'strategy.entry v6' or 'ta.rsi signature'"),
        top_k: z.number().int().min(1).max(12).optional().describe("Max chunks (default 6)"),
      }),
      execute: async ({ query, top_k }) => {
        const result = await searchKnowledge(env, query, top_k ?? 6);
        return {
          ok: true,
          cached: Boolean(result.cached),
          backend: result.backend,
          hit_count: result.hits.length,
          text: result.formatted,
        };
      },
    }),

    validate_pine: tool({
      description:
        "Lint generated Pine Script™ for common LLM hallucinations (missing version, bad builtins, deprecated security/study). Call before final answer.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000).describe("Full Pine source to validate"),
        apply_fixes: z
          .boolean()
          .optional()
          .describe("Return auto-fixed source when safe (default true)"),
      }),
      execute: async ({ code, apply_fixes }) => {
        const result = lintPine(code);
        const apply = apply_fixes !== false;
        return {
          ok: result.ok,
          summary: formatLintForModel(result),
          issues: result.issues,
          fixed_code: apply ? result.fixed : code,
          changed: apply ? result.changed : false,
        };
      },
    }),

    render_axis_chart: tool({
      description:
        "Emit an AXIS chart layout plan (panes, overlays, colors) for the client plugin to render alongside the generated script. Does not execute trades.",
      inputSchema: z.object({
        title: z.string().max(120).optional(),
        theme: z.enum(["dark", "light", "auto"]).optional(),
        pine_summary: z
          .string()
          .max(500)
          .optional()
          .describe("One-line description of what the script plots"),
        panes: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              kind: z.enum(["price", "oscillator", "volume", "custom"]),
              title: z.string().max(80).optional(),
              height: z.number().min(0.1).max(1).optional(),
              overlays: z.array(z.string().max(80)).max(20).optional(),
            })
          )
          .min(1)
          .max(6),
        colors: z.record(z.string(), z.string()).optional(),
      }),
      execute: async (input) => {
        const layout: AxisChartLayout = {
          version: 1,
          title: input.title,
          theme: input.theme ?? "auto",
          panes: input.panes,
          colors: input.colors,
        };
        // Client tools / plugin intercept this JSON as a data part.
        return {
          ok: true,
          type: "axis_chart_layout",
          layout,
          pine_summary: input.pine_summary ?? null,
          note: "AXIS plugin may render this layout; standalone UI shows JSON preview.",
        };
      },
    }),

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
        "Escape hatch: call any AXIS MCP tool by name (axis_run, axis_scripts_put, axis_market, axis_onchain, app_invoke, app_get, app_set, …). Prefer the composed axis_run_pine / axis_app tools when they fit.",
      inputSchema: z.object({
        tool: z
          .string()
          .min(1)
          .max(80)
          .describe("AXIS MCP tool name, e.g. 'axis_scripts_put' or 'chart.load' via app_invoke"),
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
        "Run Pine Script™ on AXIS (worker plane, no PWA needed) and get the real engine result. Lint first, then run, then repair from the actual error. This is the write→run→fix loop primitive.",
      inputSchema: z.object({
        code: z.string().min(1).max(80_000).describe("Full Pine source to execute"),
        symbol: z.string().max(24).optional().describe("Ticker label for the run"),
        timeframe: z.string().max(8).optional().describe("Bar timeframe, e.g. '1h'"),
      }),
      execute: async ({ code, symbol, timeframe }) => {
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
        const res = await axisRunPine(env, {
          script: lint.fixed,
          symbol,
          timeframe,
        });
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
        "Drive the connected AXIS PWA: editor.set/get/run/diagnostics, chart.load/get/set/reload/live/layout/theme/type/zoom/screenshot, indicators.*, alerts.*, watchlist.*, library.*, results.get, logs.get, drawings.*, settings.*, workspace.export/import, panels.*, plugins.*, status.get. Requires a bridged tab (see axis_mcp_status).",
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
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
