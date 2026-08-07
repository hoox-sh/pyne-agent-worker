#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Upload staged knowledge JSON chunks to R2 and upsert Vectorize™ vectors
 * using Workers AI™ embeddings via `wrangler` + the Cloudflare API.
 *
 * Requires:
 *   - wrangler authenticated
 *   - R2 bucket pyne-agent-kb
 *   - Vectorize index pyne-agent-kb (768 dims, cosine) matching EMBED model
 *
 * Usage:
 *   bun run scripts/build-index.ts
 *   bun run scripts/build-index.ts --dry-run
 *
 * Embedding is done through a temporary local call pattern:
 *   for production-scale, prefer a one-shot Worker admin endpoint or CF AI Search™.
 *
 * This script writes R2 objects with:
 *   wrangler r2 object put pyne-agent-kb/<key> --file=...
 * and prints Vectorize upsert NDJSON for:
 *   wrangler vectorize insert pyne-agent-kb --file=vectors.ndjson
 *
 * Note: Generating embeddings without a live Worker requires CF API tokens.
 * When --embed-endpoint is set, POST { texts: string[] } → { vectors: number[][] }.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "knowledge", "data");
const EXPORT = join(ROOT, "knowledge", "index-export");

type ChunkFile = {
  id: string;
  text: string;
  title?: string;
  source?: string;
  kind?: string;
};

function parseArgs(argv: string[]) {
  let dry = false;
  let embedEndpoint = "";
  let bucket = "pyne-agent-kb";
  let index = "pyne-agent-kb";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dry = true;
    else if (argv[i] === "--embed-endpoint") embedEndpoint = argv[++i] || "";
    else if (argv[i] === "--bucket") bucket = argv[++i] || bucket;
    else if (argv[i] === "--index") index = argv[++i] || index;
  }
  return { dry, embedEndpoint, bucket, index };
}

async function collectChunks(): Promise<ChunkFile[]> {
  const out: ChunkFile[] = [];
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
          const j = JSON.parse(await readFile(p, "utf8")) as ChunkFile;
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

async function embedBatch(
  endpoint: string,
  texts: string[]
): Promise<number[][]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`embed endpoint HTTP ${res.status}`);
  const data = (await res.json()) as { vectors?: number[][]; data?: number[][] };
  const vectors = data.vectors || data.data;
  if (!vectors) throw new Error("embed endpoint missing vectors");
  return vectors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chunks = await collectChunks();
  if (!chunks.length) {
    console.error(
      "No staged chunks under knowledge/data. Run ingest-docs / ingest-corpus / ingest-builtins first."
    );
    process.exit(2);
  }

  await mkdir(EXPORT, { recursive: true });
  console.log(`Found ${chunks.length} chunks`);

  // 1) Prepare R2 keys + local files for upload
  const r2List: { key: string; file: string; chunk: ChunkFile }[] = [];
  for (const c of chunks) {
    const key = `kb/${c.kind || "other"}/${c.id.replace(/[:/]/g, "_")}.json`;
    const file = join(EXPORT, `${c.id.replace(/[:/]/g, "_")}.json`);
    await writeFile(file, JSON.stringify(c));
    r2List.push({ key, file, chunk: c });
  }

  if (!args.dry) {
    for (const item of r2List) {
      const r = spawnSync(
        "npx",
        [
          "wrangler",
          "r2",
          "object",
          "put",
          `${args.bucket}/${item.key}`,
          "--file",
          item.file,
          "--remote",
        ],
        { stdio: "inherit", cwd: ROOT }
      );
      if (r.status !== 0) {
        console.warn(`R2 put failed for ${item.key} (continuing)`);
      }
    }
  } else {
    console.log(`[dry-run] would upload ${r2List.length} objects to R2 ${args.bucket}`);
  }

  // 2) Embeddings + Vectorize NDJSON
  const ndjsonPath = join(EXPORT, "vectors.ndjson");
  const lines: string[] = [];

  if (args.embedEndpoint) {
    const batchSize = 16;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const vectors = await embedBatch(
        args.embedEndpoint,
        batch.map((c) => c.text.slice(0, 6000))
      );
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        const values = vectors[j];
        if (!values) continue;
        const meta = {
          title: c.title || "",
          source: c.source || "",
          kind: c.kind || "other",
          r2_key: r2List[i + j]?.key || "",
          // Keep a short snippet in metadata for fast RAG without R2 roundtrip
          text: c.text.slice(0, 1200),
        };
        lines.push(
          JSON.stringify({
            id: c.id,
            values,
            metadata: meta,
          })
        );
      }
      console.log(`embedded ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
    }
    await writeFile(ndjsonPath, lines.join("\n") + "\n");
    console.log(`Wrote ${ndjsonPath}`);

    if (!args.dry) {
      const r = spawnSync(
        "npx",
        [
          "wrangler",
          "vectorize",
          "insert",
          args.index,
          "--file",
          ndjsonPath,
        ],
        { stdio: "inherit", cwd: ROOT }
      );
      if (r.status !== 0) process.exit(r.status || 1);
    } else {
      console.log(`[dry-run] would insert into Vectorize ${args.index}`);
    }
  } else {
    // Without embeddings, write a helper payload for a Worker-side indexer.
    const payloadPath = join(EXPORT, "to-embed.json");
    await writeFile(
      payloadPath,
      JSON.stringify(
        r2List.map((x) => ({
          id: x.chunk.id,
          r2_key: x.key,
          title: x.chunk.title,
          source: x.chunk.source,
          kind: x.chunk.kind,
          text: x.chunk.text.slice(0, 6000),
        })),
        null,
        2
      )
    );
    console.log(
      `Wrote ${payloadPath}.\n` +
        "Provide embeddings via:\n" +
        "  bun run scripts/build-index.ts --embed-endpoint https://<worker>/v1/admin/embed\n" +
        "or use Cloudflare® AI Search™ pointed at R2 bucket pyne-agent-kb.\n" +
        "Pine Script™ / TradingView® trademarks of TradingView, Inc."
    );
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
