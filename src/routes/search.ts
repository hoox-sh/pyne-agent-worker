// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ragTopK } from "../ai/models";
import { errorJson, json, readJson } from "../lib/json";
import { retrieve } from "../rag/retrieve";

export async function handleSearch(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  let query = url.searchParams.get("q") || url.searchParams.get("query") || "";
  let topK = Number(url.searchParams.get("top_k") || "8");
  let kinds: string[] | undefined;
  let indexParam = url.searchParams.get("index") || "";

  if (request.method === "POST") {
    const parsed = await readJson<{
      query?: string;
      q?: string;
      top_k?: number;
      kinds?: string[];
      index?: string;
    }>(request);
    if (!parsed.ok) return errorJson(400, parsed.error);
    query = String(parsed.data.query || parsed.data.q || query).trim();
    if (parsed.data.top_k != null) topK = Number(parsed.data.top_k);
    if (Array.isArray(parsed.data.kinds)) kinds = parsed.data.kinds;
    if (parsed.data.index != null) indexParam = String(parsed.data.index);
  }

  query = query.trim();
  if (!query) return errorJson(400, "query is required");

  const indexRaw = indexParam.trim().toLowerCase();
  const index =
    indexRaw === "v1" || indexRaw === "v2" ? (indexRaw as "v1" | "v2") : undefined;

  try {
    const chunks = await retrieve(env, {
      query,
      topK: ragTopK(env, Number.isFinite(topK) ? topK : undefined),
      kinds,
      index,
    });
    return json({
      ok: true,
      query,
      index: index || "auto",
      count: chunks.length,
      chunks,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(502, `Vectorize™ search failed: ${msg}`);
  }
}
