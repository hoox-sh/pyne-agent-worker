// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { embedQuery } from "../ai/workers-ai";
import { ragTopK } from "../ai/models";
import {
  type EmbedIdentity,
  embedIdentityV1,
  embedIdentityV2,
  kbFallbackV1,
  resolveEmbedIdentity,
  vectorizeBinding,
} from "../ai/routing";

import type { KnowledgeKind } from "../lib/knowledge-kind";

export type { KnowledgeKind };

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
  /** Force index identity. Default: feature-flagged active. */
  index?: "v1" | "v2";
};

async function queryWithIdentity(
  env: Env,
  ident: EmbedIdentity,
  opts: RetrieveOpts,
  topK: number
): Promise<RagChunk[]> {
  const binding = vectorizeBinding(env, ident);
  if (!binding || !env.AI) return [];

  const vector = await embedQuery(env, opts.query, ident);
  if (vector.length !== ident.dimensions) {
    throw new Error(
      `embed dim ${vector.length} != identity ${ident.dimensions} (${ident.id})`
    );
  }

  const queryOpts: VectorizeQueryOptions = {
    topK,
    returnMetadata: "all",
    returnValues: false,
  };
  if (opts.kinds?.length === 1 && opts.kinds[0]) {
    queryOpts.filter = { kind: opts.kinds[0] };
  }

  const result = await binding.query(vector, queryOpts);
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

/**
 * Semantic retrieve against Vectorize™.
 * Never queries a 768-d index with a 384-d vector (or the reverse).
 * Empty/error on V2 → skip RAG unless KB_FALLBACK_V1=true (then re-embed V1).
 */
export async function retrieve(
  env: Env,
  opts: RetrieveOpts
): Promise<RagChunk[]> {
  if (!env.AI) return [];

  const topK = ragTopK(env, opts.topK);

  if (opts.index === "v1") {
    if (!env.VECTORIZE) return [];
    return queryWithIdentity(env, embedIdentityV1(env), opts, topK);
  }

  if (opts.index === "v2") {
    const v2 = embedIdentityV2(env);
    if (!v2) return [];
    return queryWithIdentity(env, v2, opts, topK);
  }

  // auto: prefer V2 when flagged+bound; never cross-query dims
  const v2 = embedIdentityV2(env);
  if (v2) {
    try {
      const chunks = await queryWithIdentity(env, v2, opts, topK);
      if (chunks.length > 0) return chunks;
      if (kbFallbackV1(env) && env.VECTORIZE) {
        return queryWithIdentity(env, embedIdentityV1(env), opts, topK);
      }
      return [];
    } catch (e) {
      if (kbFallbackV1(env) && env.VECTORIZE) {
        console.warn(
          JSON.stringify({
            type: "vectorize_v2_failed_fallback_v1",
            error: e instanceof Error ? e.message : String(e),
          })
        );
        return queryWithIdentity(env, embedIdentityV1(env), opts, topK);
      }
      throw e;
    }
  }

  if (!env.VECTORIZE) return [];
  return queryWithIdentity(
    env,
    resolveEmbedIdentity(env, "auto"),
    opts,
    topK
  );
}
