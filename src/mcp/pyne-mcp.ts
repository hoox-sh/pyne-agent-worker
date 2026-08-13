// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MCP server (Model Context Protocol) exposing PYNE knowledge + lint tools
 * for external IDEs (Cursor / VS Code) via streamable HTTP at /mcp.
 *
 * Auth: when env.API_KEY is set, require Bearer / X-API-Key on /mcp requests
 * (enforced in the Worker fetch router before serving).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { searchKnowledge } from "../agent/knowledge";
import { formatLintForModel, lintPine } from "../agent/lint";

type McpState = Record<string, never>;

export class PyneMcp extends McpAgent<Env, McpState, Record<string, never>> {
  server = new McpServer({
    name: "pyne-agent-mcp",
    version: "0.2.0",
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
  }
}
