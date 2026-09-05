#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Upload staged knowledge/data chunks to R2 + Vectorize via the Cloudflare API.
 * Uses CLOUDFLARE_API_TOKEN (no Worker API_KEY required).
 *
 *   bun run scripts/upload-kb.ts
 *   bun run scripts/upload-kb.ts --dry-run
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "knowledge", "data");
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "debc6545e63bea36be059cbc82d80ec8";
const BUCKET = "pyne-agent-kb";
const INDEX = "pyne-agent-kb";
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const EMBED_BATCH = 16;
const UPSERT_BATCH = 80;
const R2_CONCURRENCY = 4;

type Chunk = { id: string; text: string; title?: string; source?: string; kind?: string };

function parseArgs(argv: string[]) {
  return { dry: argv.includes("--dry-run") };
}

function token(): string {
  const t = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!t) {
    console.error("CLOUDFLARE_API_TOKEN is required");
    process.exit(2);
  }
  return t;
}

async function collect(): Promise<Chunk[]> {
  const out: Chunk[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".json") && e.name !== "manifest.json") {
        try {
          const j = JSON.parse(await readFile(p, "utf8")) as Chunk;
          if (j.id && j.text) out.push(j);
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk(DATA);
  return out;
}

async function cf(
  auth: string,
  method: string,
  path: string,
  body?: BodyInit | null,
  headers: Record<string, string> = {}
): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`;
  let last: Response | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    last = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${auth}`, ...headers },
      body: body ?? undefined,
    });
    if (last.status !== 429 && last.status < 500) return last;
    const retryAfter = Number(last.headers.get("Retry-After") || 0);
    const wait = Math.max(retryAfter * 1000, 800 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, Math.min(wait, 20_000)));
  }
  return last!;
}

async function embedBatch(auth: string, texts: string[]): Promise<number[][]> {
  const res = await cf(auth, "POST", `/ai/run/${EMBED_MODEL}`, JSON.stringify({ text: texts }), {
    "Content-Type": "application/json",
  });
  const data = (await res.json()) as {
    success?: boolean;
    result?: { data?: number[][] };
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !data.result?.data) {
    throw new Error(`embed HTTP ${res.status}: ${data.errors?.[0]?.message || JSON.stringify(data).slice(0, 240)}`);
  }
  return data.result.data;
}

async function putR2(auth: string, key: string, body: string): Promise<void> {
  const enc = encodeURIComponent(key).replace(/%2F/g, "/");
  const res = await cf(auth, "PUT", `/r2/buckets/${BUCKET}/objects/${enc}`, body, {
    "Content-Type": "application/json",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`R2 PUT ${key} HTTP ${res.status}: ${t.slice(0, 240)}`);
  }
}

async function upsertVectors(
  auth: string,
  rows: Array<{ id: string; values: number[]; metadata: Record<string, string> }>
): Promise<void> {
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const res = await cf(auth, "POST", `/vectorize/v2/indexes/${INDEX}/upsert`, ndjson, {
    "Content-Type": "application/x-ndjson",
  });
  const data = (await res.json()) as { success?: boolean; errors?: Array<{ message?: string }> };
  if (!res.ok || data.success === false) {
    throw new Error(`vectorize upsert HTTP ${res.status}: ${data.errors?.[0]?.message || "failed"}`);
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const { dry } = parseArgs(process.argv.slice(2));
  const auth = token();
  const chunks = await collect();
  if (!chunks.length) {
    console.error("No staged chunks under knowledge/data. Run bun run ingest:kb first.");
    process.exit(2);
  }
  console.log(`Uploading ${chunks.length} chunks to R2 ${BUCKET} + Vectorize ${INDEX}${dry ? " (dry-run)" : ""}`);

  if (dry) {
    const kinds = new Map<string, number>();
    for (const c of chunks) kinds.set(c.kind || "other", (kinds.get(c.kind || "other") || 0) + 1);
    console.log(Object.fromEntries(kinds));
    return;
  }

  let embedded = 0;
  let uploaded = 0;
  const pending: Array<{ id: string; values: number[]; metadata: Record<string, string> }> = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(
      auth,
      batch.map((c) => c.text.slice(0, 6000))
    );
    const r2Jobs: Array<{ key: string; body: string }> = [];
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j]!;
      const values = vectors[j];
      if (!values) continue;
      const key = `kb/${c.kind || "other"}/${c.id.replace(/[:/]/g, "_")}.json`;
      r2Jobs.push({
        key,
        body: JSON.stringify({
          id: c.id,
          text: c.text,
          title: c.title,
          source: c.source,
          kind: c.kind,
        }),
      });
      pending.push({
        id: c.id,
        values,
        metadata: {
          title: c.title || "",
          source: c.source || "",
          kind: c.kind || "other",
          r2_key: key,
          text: c.text.slice(0, 1200),
        },
      });
    }
    await mapPool(r2Jobs, R2_CONCURRENCY, async (job) => {
      await putR2(auth, job.key, job.body);
      uploaded += 1;
    });
    embedded += batch.length;

    while (pending.length >= UPSERT_BATCH) {
      const slice = pending.splice(0, UPSERT_BATCH);
      await upsertVectors(auth, slice);
    }
    if (embedded % 160 === 0 || embedded === chunks.length) {
      console.log(`progress ${embedded}/${chunks.length} embedded, ${uploaded} in R2`);
    }
  }

  if (pending.length) await upsertVectors(auth, pending);
  console.log(`Done. R2 objects: ${uploaded}. Vectorize upserts: ${embedded}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
