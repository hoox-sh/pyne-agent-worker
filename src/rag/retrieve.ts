// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { embedQuery } from "../ai/workers-ai";
import { ragTopK } from "../ai/models";

export type KnowledgeKind =
  | "docs-v5"
  | "docs-v6"
  | "docs"
  | "corpus"
  | "builtin-ref"
  | "template"
  | "other";

export type RagChunk = {
  id: string;
  text: string;
  title?: string;
  source?: string;
  kind?: KnowledgeKind | string;
  score?: number;
};

export type RetrieveOpts = {
  query: string;
  topK?: number;
  /** Optional metadata filter: only these kinds */
  kinds?: string[];
};

/**
 * Semantic retrieve against Vectorize™.
 * Vectors were upserted by scripts/build-index.ts with metadata.text (or R2 pointer).
 */
export async function retrieve(
  env: Env,
  opts: RetrieveOpts
): Promise<RagChunk[]> {
  const topK = opts.topK ?? ragTopK(env);
  const vector = await embedQuery(env, opts.query);

  const result = await env.VECTORIZE.query(vector, {
    topK,
    returnMetadata: "all",
    returnValues: false,
  });

  const matches = result.matches ?? [];
  const chunks: RagChunk[] = [];

  for (const m of matches) {
    const meta = (m.metadata || {}) as Record<string, unknown>;
    const kind = String(meta.kind || "other");
    if (opts.kinds?.length && !opts.kinds.includes(kind)) continue;

    let text = String(meta.text || meta.snippet || "");
    const r2Key = meta.r2_key != null ? String(meta.r2_key) : "";

    // Prefer full body from R2 when only a pointer is stored in metadata.
    if ((!text || text.length < 40) && r2Key) {
      try {
        const obj = await env.KB.get(r2Key);
        if (obj) text = await obj.text();
      } catch {
        /* ignore missing object */
      }
    }

    if (!text) continue;

    chunks.push({
      id: m.id,
      text: text.slice(0, 6000),
      title: meta.title != null ? String(meta.title) : undefined,
      source: meta.source != null ? String(meta.source) : undefined,
      kind,
      score: m.score,
    });
  }

  return chunks;
}
