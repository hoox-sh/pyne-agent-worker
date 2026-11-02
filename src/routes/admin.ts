// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { embedTexts } from "../ai/workers-ai";
import {
  resolveEmbedIdentity,
  vectorizeBinding,
  type EmbedIdentity,
} from "../ai/routing";
import { errorJson, json, readJson } from "../lib/json";
import { normalizeKnowledgeKind } from "../lib/knowledge-kind";

function parseIndex(raw: unknown): "v1" | "v2" | "auto" {
  const s = String(raw || "auto").trim().toLowerCase();
  if (s === "v1" || s === "v2") return s;
  return "auto";
}

function identityForAdmin(env: Env, index: "v1" | "v2" | "auto"): EmbedIdentity {
  try {
    return resolveEmbedIdentity(env, index === "auto" ? "auto" : index);
  } catch {
    return resolveEmbedIdentity(env, "v1");
  }
}

/**
 * Admin embed helper for build-index.ts.
 * Requires API_KEY (never open in production without a key).
 */
export async function handleAdminEmbed(
  request: Request,
  env: Env
): Promise<Response> {
  if (!(env.API_KEY || "").trim()) {
    return errorJson(
      403,
      "Admin embed disabled when API_KEY is unset (refuse open embedding API)"
    );
  }

  const parsed = await readJson<{
    texts?: string[];
    text?: string;
    index?: string;
    pooling?: string;
  }>(request);
  if (!parsed.ok) return errorJson(400, parsed.error);

  const texts = Array.isArray(parsed.data.texts)
    ? parsed.data.texts
    : parsed.data.text
      ? [parsed.data.text]
      : [];

  if (!texts.length) return errorJson(400, "texts[] required");
  if (texts.length > 32) return errorJson(413, "max 32 texts per request");
  for (const t of texts) {
    if (typeof t !== "string" || t.length > 12_000) {
      return errorJson(413, "each text max 12k chars");
    }
  }

  const ident = identityForAdmin(env, parseIndex(parsed.data.index));
  const poolingRaw = String(parsed.data.pooling || "").toLowerCase();
  const pooling =
    poolingRaw === "mean" || poolingRaw === "cls"
      ? poolingRaw
      : ident.pooling;

  try {
    const vectors = await embedTexts(env, texts, {
      identity: ident,
      pooling,
    });
    return json({
      ok: true,
      vectors,
      data: vectors,
      index: ident.id,
      model: ident.model,
      pooling,
      dimensions: ident.dimensions,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(502, `embed failed: ${msg}`);
  }
}

export type IndexUpsertBody = {
  index?: string;
  pooling?: string;
  items?: Array<{
    id: string;
    text: string;
    title?: string;
    source?: string;
    kind?: string;
  }>;
};

/** Embed + upsert into Vectorize and store full body in R2. */
export async function handleAdminIndex(
  request: Request,
  env: Env
): Promise<Response> {
  if (!(env.API_KEY || "").trim()) {
    return errorJson(403, "Admin index disabled when API_KEY is unset");
  }

  const parsed = await readJson<IndexUpsertBody>(request);
  if (!parsed.ok) return errorJson(400, parsed.error);
  const items = parsed.data.items || [];
  if (!items.length) return errorJson(400, "items[] required");
  if (items.length > 32) return errorJson(413, "max 32 items per request");

  const ident = identityForAdmin(env, parseIndex(parsed.data.index));
  const binding = vectorizeBinding(env, ident);
  if (!binding) {
    return errorJson(
      503,
      `Vectorize binding ${ident.binding} not configured for index=${ident.id}`
    );
  }

  const poolingRaw = String(parsed.data.pooling || "").toLowerCase();
  const pooling =
    poolingRaw === "mean" || poolingRaw === "cls"
      ? poolingRaw
      : ident.pooling;

  const vectors = await embedTexts(
    env,
    items.map((i) => i.text.slice(0, 6000)),
    { identity: ident, pooling }
  );

  const prepared = items
    .map((it, i) => {
      const values = vectors[i];
      if (!it?.id || !values) return null;
      const kind = normalizeKnowledgeKind(it.kind || "other");
      const r2Key = `kb/${kind}/${it.id.replace(/[:/]/g, "_")}.json`;
      return { it: { ...it, kind }, values, r2Key };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  await Promise.all(
    prepared.map((row) =>
      env.KB.put(
        row.r2Key,
        JSON.stringify({
          id: row.it.id,
          text: row.it.text,
          title: row.it.title,
          source: row.it.source,
          kind: row.it.kind,
        })
      )
    )
  );

  const upserts: VectorizeVector[] = prepared.map((row) => ({
    id: row.it.id,
    values: row.values,
    metadata: {
      title: row.it.title || "",
      source: row.it.source || "",
      kind: row.it.kind || "other",
      r2_key: row.r2Key,
      text: row.it.text.slice(0, 1200),
    },
  }));

  if (upserts.length) {
    await binding.upsert(upserts);
  }

  return json({
    ok: true,
    upserted: upserts.length,
    index: ident.id,
    model: ident.model,
    pooling,
    dimensions: ident.dimensions,
  });
}
