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
  // Standalone / degraded: no Vectorize binding → empty context (chat still works).
  if (!env.VECTORIZE || !env.AI) {
    return [];
  }

  const topK = ragTopK(env, opts.topK);
  const vector = await embedQuery(env, opts.query);

  const queryOpts: VectorizeQueryOptions = {
    topK,
    returnMetadata: "all",
    returnValues: false,
  };
  if (opts.kinds?.length === 1 && opts.kinds[0]) {
    queryOpts.filter = { kind: opts.kinds[0] };
  }

  const result = await env.VECTORIZE.query(vector, queryOpts);

  const matches = result.matches ?? [];
  const pending = matches.map((m) => {
    const meta = (m.metadata || {}) as Record<string, unknown>;
    const kind = String(meta.kind || "other");
    const text = String(meta.text || meta.snippet || "");
    const r2Key = meta.r2_key != null ? String(meta.r2_key) : "";
    return { m, meta, kind, text, r2Key };
  });

  const needR2 = pending.filter(
    (p) =>
      (!opts.kinds?.length || opts.kinds.includes(p.kind)) &&
      (!p.text || p.text.length < 40) &&
      p.r2Key
  );
  const r2Texts = await Promise.all(
    needR2.map(async (p) => {
      try {
        const obj = await env.KB.get(p.r2Key);
        return obj ? await obj.text() : "";
      } catch {
        return "";
      }
    })
  );
  const r2ByKey = new Map<string, string>();
  needR2.forEach((p, i) => {
    r2ByKey.set(p.r2Key, r2Texts[i] || "");
  });

  const CONTEXT_BUDGET = 24_000;
  const PER_CHUNK = 3_000;
  let used = 0;
  const chunks: RagChunk[] = [];

  for (const p of pending) {
    if (opts.kinds?.length && !opts.kinds.includes(p.kind)) continue;
    let text = p.text;
    if ((!text || text.length < 40) && p.r2Key) {
      text = r2ByKey.get(p.r2Key) || text;
    }
    if (!text) continue;
    const room = CONTEXT_BUDGET - used;
    if (room <= 200) break;
    const sliced = text.slice(0, Math.min(PER_CHUNK, room));
    used += sliced.length;
    chunks.push({
      id: p.m.id,
      text: sliced,
      title: p.meta.title != null ? String(p.meta.title) : undefined,
      source: p.meta.source != null ? String(p.meta.source) : undefined,
      kind: p.kind,
      score: p.m.score,
    });
  }

  return chunks;
}
