// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * pyne-agent-worker — Cloudflare® Worker
 *
 * Natural-language PYNE coding agent for AXIS / HOOX / PYNE.
 * Uses Workers AI™ + Vectorize™ RAG over operator-ingested v5/v6 docs,
 * open corpus (≤1000), and operator-supplied built-in references.
 *
 * This repository never ships TradingView® built-in source files.
 */

import { requireAuth } from "./lib/auth";
import { pluginCorsHeaders, withCors } from "./lib/cors";
import { errorJson, json } from "./lib/json";
import { DISCLAIMER_SHORT } from "./lib/legal";
import { handleChat } from "./routes/chat";
import { handleHealth } from "./routes/health";
import { handleSearch } from "./routes/search";
import { handleAdminEmbed, handleAdminIndex } from "./routes/admin";
import {
  createSession,
  getSession,
  listMessages,
} from "./rag/sessions";

function notFound(): Response {
  return errorJson(404, "Not found");
}

function isPluginPath(path: string): boolean {
  return (
    path === "/plugin/axis-pine-agent.js" ||
    path === "/plugins/axis-pine-agent.js"
  );
}

/** Public ES module for AXIS dynamic import() — must send CORS. */
async function servePlugin(
  request: Request,
  env: Env
): Promise<Response> {
  const headers = new Headers(pluginCorsHeaders());
  headers.set("Content-Type", "text/javascript; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=300");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  if (env.ASSETS) {
    const assetReq = new Request(
      new URL("/plugin/axis-pine-agent.js", request.url),
      { method: "GET" }
    );
    const res = await env.ASSETS.fetch(assetReq);
    if (res.ok) {
      const body = request.method === "HEAD" ? null : res.body;
      return new Response(body, { status: 200, headers });
    }
  }
  return errorJson(
    404,
    "Plugin asset not found — ensure public/plugin is deployed"
  );
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // AXIS plugin must be Worker-handled (not bare ASSETS) so CORS is applied.
  // Dynamic import() of cross-origin modules requires Access-Control-Allow-Origin.
  if (isPluginPath(path)) {
    return servePlugin(request, env);
  }

  // CORS preflight (API)
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // Public health
  if (path === "/health" && request.method === "GET") {
    return handleHealth(env);
  }

  // Public root meta (also served static assets when ASSETS bound)
  if (path === "/" && request.method === "GET") {
    if (env.ASSETS) {
      try {
        return await env.ASSETS.fetch(request);
      } catch {
        /* fall through */
      }
    }
    return json({
      service: env.SERVICE_NAME || "pyne-agent-worker",
      version: env.SERVICE_VERSION || "0.1.0",
      description:
        "Natural-language Pine Script™ agent (Cloudflare® Workers AI™ + Vectorize™ RAG). AXIS sister plugin.",
      endpoints: {
        health: "GET /health",
        chat: "POST /v1/chat",
        search: "GET|POST /v1/search",
        sessions: "POST /v1/sessions, GET /v1/sessions/:id",
        plugin: "GET /plugin/axis-pine-agent.js",
      },
      disclaimer: DISCLAIMER_SHORT,
    });
  }

  // Auth gate for API
  const auth = requireAuth(request, env);
  if (!auth.ok) return errorJson(auth.status, auth.error);

  if (path === "/v1/chat" && request.method === "POST") {
    return handleChat(request, env);
  }

  if (
    (path === "/v1/search" || path === "/v1/kb/search") &&
    (request.method === "GET" || request.method === "POST")
  ) {
    return handleSearch(request, env);
  }

  if (path === "/v1/admin/embed" && request.method === "POST") {
    return handleAdminEmbed(request, env);
  }

  if (path === "/v1/admin/index" && request.method === "POST") {
    return handleAdminIndex(request, env);
  }

  if (path === "/v1/sessions" && request.method === "POST") {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        title?: string;
      };
      const s = await createSession(env, body.title);
      return json({ ok: true, session: s });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(503, `D1 sessions unavailable: ${msg}`);
    }
  }

  const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/);
  if (sessionMatch && request.method === "GET") {
    try {
      const sid = decodeURIComponent(sessionMatch[1]);
      const s = await getSession(env, sid);
      if (!s) return errorJson(404, "session not found");
      const messages = await listMessages(env, sid);
      return json({ ok: true, session: s, messages });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(503, `D1 sessions unavailable: ${msg}`);
    }
  }

  // Static fallback
  if (env.ASSETS && request.method === "GET") {
    try {
      return await env.ASSETS.fetch(request);
    } catch {
      /* ignore */
    }
  }

  return notFound();
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const res = await route(request, env);
      return withCors(request, env, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return withCors(request, env, errorJson(500, msg));
    }
  },
};
