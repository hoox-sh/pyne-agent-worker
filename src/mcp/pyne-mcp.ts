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
  isCallableAxisTool,
} from "../axis/mcp-client";

type McpState = Record<string, never>;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export class PyneMcp extends McpAgent<Env, McpState, Record<string, never>> {
  server = new McpServer({
    name: "pyne-agent-mcp",
    version: "0.3.0",
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
      async ({ query, top_k }) => {
        const result = await searchKnowledge(this.env, query, top_k ?? 6);
        return {
          content: [
            {
              type: "text" as const,
              text: `backend=${result.backend}\n\n${result.formatted}`,
            },
          ],
        };
      }
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
          "Lint + execute Pine Script™ on AXIS (worker plane, no PWA needed). Returns the real engine result.",
        inputSchema: {
          code: z.string().min(1).max(80_000),
          symbol: z.string().max(24).optional(),
          timeframe: z.string().max(8).optional(),
        },
      },
      async ({ code, symbol, timeframe }) => {
        const lint = lintPine(code);
        if (!lint.ok) {
          return textResult(
            JSON.stringify({ ok: false, stage: "lint", summary: formatLintForModel(lint) })
          );
        }
        const res = await axisRunPine(this.env, { script: lint.fixed, symbol, timeframe });
        return textResult(
          JSON.stringify(res.ok ? { ok: true, text: res.text } : res)
        );
      }
    );

    this.server.registerTool(
      "axis_app_invoke",
      {
        description:
          "Drive the connected AXIS PWA (editor.*, chart.*, results.*, alerts.*, workspace.*, …). Needs a bridged tab.",
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
        return textResult(
          JSON.stringify(res.ok ? { ok: true, text: res.text } : res)
        );
      }
    );
  }
}
