// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { embedTexts } from "../ai/workers-ai";
import { errorJson, json, readJson } from "../lib/json";

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

  const parsed = await readJson<{ texts?: string[]; text?: string }>(request);
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

  try {
    const vectors = await embedTexts(env, texts);
    return json({ ok: true, vectors, data: vectors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(502, `embed failed: ${msg}`);
  }
}

export type IndexUpsertBody = {
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

  const vectors = await embedTexts(
    env,
    items.map((i) => i.text.slice(0, 6000))
  );

  const upserts: VectorizeVector[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const values = vectors[i];
    if (!it?.id || !values) continue;
    const r2Key = `kb/${it.kind || "other"}/${it.id.replace(/[:/]/g, "_")}.json`;
    await env.KB.put(
      r2Key,
      JSON.stringify({
        id: it.id,
        text: it.text,
        title: it.title,
        source: it.source,
        kind: it.kind,
      })
    );
    upserts.push({
      id: it.id,
      values,
      metadata: {
        title: it.title || "",
        source: it.source || "",
        kind: it.kind || "other",
        r2_key: r2Key,
        text: it.text.slice(0, 1200),
      },
    });
  }

  if (upserts.length) {
    await env.VECTORIZE.upsert(upserts);
  }

  return json({ ok: true, upserted: upserts.length });
}
