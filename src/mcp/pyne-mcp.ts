// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MCP server (Model Context Protocol) exposing PYNE knowledge, lint, and
 * AXIS control tools for external IDEs (Cursor / VS Code) and agents via
 * streamable HTTP at /mcp.
 *
 * Auth: when env.API_KEY is set, require Bearer / X-API-Key on /mcp requests
 * (enforced in the Worker fetch router before serving).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { searchKnowledge } from "../agent/knowledge";
import { formatLintForModel, lintPine } from "../agent/lint";
import {
  axisApp,
  axisMcpCallTool,
  axisMcpListTools,
  axisMcpStatus,
  axisRunPine,
  isAxisMcpConfigured,
  isCallableAxisTool,
  validateOnAxisMcp,
} from "../axis/mcp-client";
import { SERVICE_VERSION } from "../lib/version";
import {
  envPyneBackend,
  validateOnSelectedBackend,
} from "../lib/pyne-backend";
import { pyneAstOp, pyneLintOrHeuristic } from "../lib/pyne-ast";
import { syntheticBars } from "../lib/synthetic-bars";

type McpState = Record<string, never>;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function textJson(value: unknown) {
  return textResult(JSON.stringify(value));
}

export class PyneMcp extends McpAgent<Env, McpState, Record<string, never>> {
  server = new McpServer({
    name: "pyne-agent-mcp",
    version: SERVICE_VERSION,
  });

  initialState: McpState = {};

  async init() {
    this.server.resource("legal", "mcp://pyne/legal", async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text:
            "Pine Script™ and TradingView® are trademarks of TradingView, Inc. " +
            "Cloudflare® is a registered trademark of Cloudflare, Inc. " +
            "Independent project — not affiliated with TradingView or Cloudflare.",
          mimeType: "text/plain",
        },
      ],
    }));

    const searchKb = async ({
      query,
      top_k,
    }: {
      query: string;
      top_k?: number;
    }) => {
      const result = await searchKnowledge(this.env, query, top_k ?? 6);
      return {
        content: [
          {
            type: "text" as const,
            text: `backend=${result.backend}\n\n${result.formatted}`,
          },
        ],
      };
    };

    this.server.registerTool(
      "search_knowledge_base",
      {
        description:
          "Hybrid search over Pine Script™ / PYNE knowledge (AI Search or Vectorize).",
        inputSchema: {
          query: z.string().min(2).max(500),
          top_k: z.number().int().min(1).max(12).optional(),
        },
      },
      searchKb
    );

    // Alias kept for 0.4.0 vocabulary; do not remove search_knowledge_base.
    this.server.registerTool(
      "rag_search",
      {
        description:
          "Alias of search_knowledge_base — hybrid Pine Script™ / PYNE knowledge search.",
        inputSchema: {
          query: z.string().min(2).max(500),
          top_k: z.number().int().min(1).max(12).optional(),
        },
      },
      searchKb
    );

    this.server.registerTool(
      "validate_pine",
      {
        description: "Heuristic lint for Pine Script™ sources (hallucination guard).",
        inputSchema: {
          code: z.string().min(1).max(80_000),
        },
      },
      async ({ code }) => {
        const result = lintPine(code);
        return {
          content: [
            {
              type: "text" as const,
              text: formatLintForModel(result),
            },
          ],
        };
      }
    );

    this.server.registerTool(
      "lint_pine_json",
      {
        description: "Same as validate_pine but returns structured JSON.",
        inputSchema: {
          code: z.string().min(1).max(80_000),
        },
      },
      async ({ code }) => {
        const result = lintPine(code);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result),
            },
          ],
        };
      }
    );

    this.server.registerTool(
      "axis_mcp_status",
      {
        description:
          "AXIS MCP wiring status: endpoint, reachability, tool count, bridged PWA tabs. Call before any axis_* tool.",
        inputSchema: {},
      },
      async () => textResult(JSON.stringify(await axisMcpStatus(this.env)))
    );

    this.server.registerTool(
      "axis_mcp_list_tools",
      {
        description: "List the AXIS MCP tool catalog (worker-plane + app-plane).",
        inputSchema: {
          refresh: z.boolean().optional().describe("Bypass the 5-minute cache"),
        },
      },
      async ({ refresh }) =>
        textResult(
          JSON.stringify(await axisMcpListTools(this.env, { refresh: refresh ?? false }))
        )
    );

    this.server.registerTool(
      "axis_mcp_call",
      {
        description:
          "Call any AXIS MCP tool by name (axis_run, axis_scripts_put, axis_market, app_invoke, …).",
        inputSchema: {
          tool: z.string().min(1).max(80),
          args: z.record(z.string(), z.unknown()).optional(),
        },
      },
      async ({ tool, args }) => {
        if (!isCallableAxisTool(tool)) {
          return textResult(JSON.stringify({ ok: false, error: `refusing tool name: ${tool}` }));
        }
        const res = await axisMcpCallTool(this.env, tool, args ?? {});
        return textResult(
          JSON.stringify(res.ok ? { ok: true, text: res.text } : res)
        );
      }
    );

    this.server.registerTool(
      "axis_run_pine",
      {
        description:
          "Lint + execute Pine Script™ on AXIS (worker plane, no PWA needed). Worker supplies synthetic bars — do not pass ticker or timeframe.",
        inputSchema: {
          code: z.string().min(1).max(80_000),
        },
      },
      async ({ code }) => {
        const lint = lintPine(code);
        if (!lint.ok) {
          return textJson({
            ok: false,
            stage: "lint",
            summary: formatLintForModel(lint),
          });
        }
        const res = await axisRunPine(this.env, { script: lint.fixed });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    this.server.registerTool(
      "axis_app_invoke",
      {
        description:
          "Drive the connected AXIS PWA (editor.*, chart.*, results.*, alerts.*, workspace.*, …). Needs a bridged tab. Prefer first-class wrappers when they fit.",
        inputSchema: {
          capability: z.string().min(3).max(80),
          payload: z.record(z.string(), z.unknown()).optional(),
          session: z.string().max(80).optional(),
        },
      },
      async ({ capability, payload, session }) => {
        const res = await axisApp(this.env, {
          capability,
          payload: payload ?? {},
          session,
        });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    this.server.registerTool(
      "axis_chart_load",
      {
        description: "Load OHLCV on the bridged AXIS chart (app_invoke chart.load).",
        inputSchema: {
          symbol: z.string().min(1).max(32),
          interval: z.string().max(12).optional(),
          source: z.string().max(40).optional(),
        },
      },
      async ({ symbol, interval, source }) => {
        const payload: Record<string, unknown> = { symbol };
        if (interval) payload.interval = interval;
        if (source) payload.source = source;
        const res = await axisApp(this.env, {
          capability: "chart.load",
          payload,
        });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    this.server.registerTool(
      "axis_editor_set",
      {
        description: "Set the AXIS editor document (app_invoke editor.set).",
        inputSchema: {
          doc: z.string().min(1).max(80_000),
        },
      },
      async ({ doc }) => {
        const res = await axisApp(this.env, {
          capability: "editor.set",
          payload: { doc },
        });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    this.server.registerTool(
      "axis_editor_run",
      {
        description: "Run the AXIS editor document (app_invoke editor.run).",
        inputSchema: {},
      },
      async () => {
        const res = await axisApp(this.env, {
          capability: "editor.run",
          payload: {},
        });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    this.server.registerTool(
      "axis_alerts_create",
      {
        description:
          "Create an AXIS alert (app_invoke alerts.create). Fields: name, symbol, kind, params, interval, webhookUrl, enabled.",
        inputSchema: {
          name: z.string().min(1).max(80),
          symbol: z.string().max(32).optional(),
          kind: z.string().max(40).optional(),
          params: z.record(z.string(), z.unknown()).optional(),
          interval: z.string().max(12).optional(),
          webhookUrl: z.string().max(500).optional(),
          enabled: z.boolean().optional(),
        },
      },
      async (input) => {
        const params = input.params || {};
        const capped: Record<string, unknown> = {};
        let n = 0;
        for (const [k, v] of Object.entries(params)) {
          if (n >= 8) break;
          capped[k] = v;
          n += 1;
        }
        const payload: Record<string, unknown> = {
          name: input.name,
          kind: input.kind || "price_cross",
          params: capped,
        };
        if (input.symbol) payload.symbol = input.symbol;
        if (input.interval) payload.interval = input.interval;
        if (input.webhookUrl) payload.webhookUrl = input.webhookUrl;
        if (typeof input.enabled === "boolean") payload.enabled = input.enabled;
        const res = await axisApp(this.env, {
          capability: "alerts.create",
          payload,
        });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    this.server.registerTool(
      "axis_results_get",
      {
        description:
          "Last AXIS run snapshot including strategy stats (app_invoke results.get). No results.strategy tool.",
        inputSchema: {},
      },
      async () => {
        const res = await axisApp(this.env, {
          capability: "results.get",
          payload: {},
        });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    this.server.registerTool(
      "axis_engine_tick",
      {
        description:
          "Force one AXIS engine tick (app_invoke engine.tick). Mutating — needs bridge_connected > 0.",
        inputSchema: {},
      },
      async () => {
        const res = await axisApp(this.env, {
          capability: "engine.tick",
          payload: {},
        });
        return textJson(res.ok ? { ok: true, text: res.text } : res);
      }
    );

    const backendOpt = z
      .enum(["auto", "pro", "local", "worker", "container", "none"])
      .optional();

    this.server.registerTool(
      "pyne_parse",
      {
        description: "Parse Pine via PYNE /ast/parse or Flask /lsp/diagnostics.",
        inputSchema: {
          code: z.string().min(1).max(80_000),
          backend: backendOpt,
        },
      },
      async ({ code, backend }) =>
        textJson(
          await pyneAstOp(
            this.env,
            "parse",
            code,
            backend || envPyneBackend(this.env)
          )
        )
    );

    this.server.registerTool(
      "pyne_lint",
      {
        description: "Lint Pine via PYNE language surface or heuristic fallback.",
        inputSchema: {
          code: z.string().min(1).max(80_000),
          backend: backendOpt,
        },
      },
      async ({ code, backend }) =>
        textJson(
          await pyneLintOrHeuristic(
            this.env,
            code,
            backend || envPyneBackend(this.env)
          )
        )
    );

    this.server.registerTool(
      "pyne_diagnostics",
      {
        description: "Parse + lint diagnostics via PYNE or Flask /lsp.",
        inputSchema: {
          code: z.string().min(1).max(80_000),
          backend: backendOpt,
        },
      },
      async ({ code, backend }) =>
        textJson(
          await pyneAstOp(
            this.env,
            "diagnostics",
            code,
            backend || envPyneBackend(this.env)
          )
        )
    );

    this.server.registerTool(
      "pyne_compile",
      {
        description:
          "Compile-check only (/ast/compile). Never returns Python IR. Skips until sister route exists.",
        inputSchema: {
          code: z.string().min(1).max(80_000),
          backend: backendOpt,
        },
      },
      async ({ code, backend }) =>
        textJson(
          await pyneAstOp(
            this.env,
            "compile",
            code,
            backend || envPyneBackend(this.env)
          )
        )
    );

    this.server.registerTool(
      "pyne_eval",
      {
        description: "Evaluate Pine on the selected PYNE host /run (or AXIS axis_run).",
        inputSchema: {
          code: z.string().min(1).max(80_000),
          mode: z.enum(["interpret", "compile", "auto"]).optional(),
          backend: backendOpt,
        },
      },
      async ({ code, mode, backend }) => {
        const kind = backend || envPyneBackend(this.env);
        const ohlcv = syntheticBars(64);
        if (kind !== "none") {
          const r = await validateOnSelectedBackend(
            this.env,
            { script: code, mode: mode || "interpret", ohlcv },
            kind
          );
          if (!r.skipped || r.ok) return textJson(r);
        }
        if (isAxisMcpConfigured(this.env)) {
          return textJson(
            await validateOnAxisMcp(this.env, {
              script: code,
              mode: mode || "interpret",
            })
          );
        }
        return textJson({
          ok: false,
          skipped: true,
          reason: "no PYNE eval backend configured",
          latency_ms: 0,
        });
      }
    );
  }
}
