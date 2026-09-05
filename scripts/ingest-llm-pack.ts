#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stage HOOX llm.txt packs (axis-llm.txt, pyne-llm.txt) into gitignored RAG chunks.
 *
 * Usage:
 *   bun run ingest:llm
 *   bun run ingest:llm -- --file knowledge/axis-llm.txt --product axis
 *   bun run ingest:llm -- --file knowledge/pyne-llm.txt --product pyne
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { chunkText, sha1ish } from "./lib/chunk";
import { formatLlmPackDoc, splitLlmPack } from "./lib/llm-pack";

const ROOT = join(import.meta.dir, "..");
const DEFAULTS = [
  { file: join(ROOT, "knowledge", "axis-llm.txt"), product: "axis" },
  { file: join(ROOT, "knowledge", "pyne-llm.txt"), product: "pyne" },
];

function parseArgs(argv: string[]) {
  let file = "";
  let product = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") file = argv[++i] || "";
    else if (argv[i] === "--product") product = argv[++i] || "";
  }
  return { file, product };
}

async function ingestOne(file: string, product: string) {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw == null) {
    console.warn(`skip missing: ${file}`);
    return { files: 0, chunks: 0 };
  }
  const docs = splitLlmPack(raw);
  if (!docs.length) {
    console.warn(`no FILE: sections in ${file}`);
    return { files: 0, chunks: 0 };
  }

  const outDir = join(ROOT, "knowledge", "data", product === "axis" ? "axis" : "pyne");
  await mkdir(outDir, { recursive: true });
  const kind = product === "axis" ? "docs-axis" : "docs";
  const manifest: unknown[] = [];
  let chunks = 0;

  for (const doc of docs) {
    const text = formatLlmPackDoc(doc, product);
    const parts = chunkText(text, {
      idPrefix: `${product}:${sha1ish(doc.path)}`,
      title: doc.title,
      source: `${product}-llm:${doc.path}`,
      kind,
      maxChars: 2000,
      overlap: 180,
    });
    for (const c of parts) {
      const outPath = join(outDir, `${c.id.replace(/[:/]/g, "_")}.json`);
      await writeFile(
        outPath,
        JSON.stringify(
          {
            ...c,
            path: doc.path,
            marks: { pine: "Pine Script™", tradingView: "TradingView®", cloudflare: "Cloudflare®" },
          },
          null,
          2
        )
      );
      manifest.push({ id: c.id, file: outPath, kind, title: c.title, path: doc.path });
      chunks += 1;
    }
  }

  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source: file,
        product,
        files: docs.length,
        chunks,
        note: "Staging only — gitignored. HOOX first-party docs. Do not commit dumps.",
        items: manifest,
      },
      null,
      2
    )
  );
  console.log(`Staged ${chunks} chunks from ${docs.length} ${product} docs (${basename(file)}) → ${outDir}`);
  return { files: docs.length, chunks };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs = args.file
    ? [{ file: resolve(args.file), product: args.product || inferProduct(args.file) }]
    : DEFAULTS;

  let total = 0;
  for (const job of jobs) {
    const r = await ingestOne(job.file, job.product);
    total += r.chunks;
  }
  if (!total) {
    console.error(
      "No llm packs staged. Place knowledge/axis-llm.txt and/or knowledge/pyne-llm.txt\n" +
        "or pass --file <pack> --product axis|pyne"
    );
    process.exit(2);
  }
  console.log("Next: bun run ingest:index");
}

function inferProduct(file: string): string {
  const b = basename(file).toLowerCase();
  if (b.includes("axis")) return "axis";
  if (b.includes("pyne")) return "pyne";
  return "docs";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
