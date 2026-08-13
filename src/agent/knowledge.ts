// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { retrieve, type RagChunk } from "../rag/retrieve";
import { formatRagContext } from "../rag/prompts";

export type KnowledgeHit = {
  id: string;
  title?: string;
  text: string;
  source?: string;
  score?: number;
  backend: "ai-search" | "vectorize" | "none";
};

const INSTANCE_ID = "pyne-pine-kb";

/**
 * Hybrid knowledge search: prefer AI Search namespace when bound,
 * fall back to Vectorize RAG (existing pipeline).
 */
export async function searchKnowledge(
  env: Env,
  query: string,
  topK = 6
): Promise<{ hits: KnowledgeHit[]; backend: KnowledgeHit["backend"]; formatted: string }> {
  const q = String(query || "").trim();
  if (!q) {
    return { hits: [], backend: "none", formatted: "Empty query." };
  }

  // 1) AI Search managed hybrid retrieval
  if (env.AI_SEARCH) {
    try {
      const instance = env.AI_SEARCH.get(INSTANCE_ID);
      // Binding shape follows Cloudflare AI Search Workers API.
      const res = await instance.search({
        messages: [{ role: "user", content: q }],
        max_num_results: topK,
      });
      const hits: KnowledgeHit[] = [];
      const data = (res as { data?: unknown[]; results?: unknown[] }).data
        ?? (res as { results?: unknown[] }).results
        ?? [];
      for (const row of data as Array<Record<string, unknown>>) {
        const content = row.content ?? row.text ?? row.chunk;
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content
            .map((c) =>
              typeof c === "string"
                ? c
                : String((c as { text?: string }).text || "")
            )
            .join("\n");
        } else if (content && typeof content === "object") {
          text = String((content as { text?: string }).text || "");
        }
        if (!text.trim()) continue;
        hits.push({
          id: String(row.id || row.filename || hits.length),
          title: row.filename != null ? String(row.filename) : undefined,
          text: text.slice(0, 4000),
          source: row.source != null ? String(row.source) : "ai-search",
          score: typeof row.score === "number" ? row.score : undefined,
          backend: "ai-search",
        });
      }
      if (hits.length) {
        return {
          hits,
          backend: "ai-search",
          formatted: formatHits(hits),
        };
      }
    } catch {
      // Fall through to Vectorize
    }
  }

  // 2) Vectorize + R2 (operator-ingested KB)
  try {
    const chunks: RagChunk[] = await retrieve(env, { query: q, topK });
    const hits: KnowledgeHit[] = chunks.map((c) => ({
      id: c.id,
      title: c.title,
      text: c.text,
      source: c.source,
      score: c.score,
      backend: "vectorize" as const,
    }));
    return {
      hits,
      backend: hits.length ? "vectorize" : "none",
      formatted: hits.length
        ? formatRagContext(chunks)
        : "No knowledge-base hits (AI Search + Vectorize empty). Be conservative.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      hits: [],
      backend: "none",
      formatted: `Knowledge search failed: ${msg}`,
    };
  }
}

function formatHits(hits: KnowledgeHit[]): string {
  return hits
    .map((h, i) => {
      const head = [
        `### [${i + 1}] ${h.title || h.id}`,
        h.source ? `source: ${h.source}` : null,
        h.score != null ? `score: ${h.score.toFixed(4)}` : null,
        `backend: ${h.backend}`,
      ]
        .filter(Boolean)
        .join(" | ");
      return `${head}\n${h.text}`;
    })
    .join("\n\n");
}
