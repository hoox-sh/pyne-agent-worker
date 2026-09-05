#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stage operator pineDocs.json (language reference) into gitignored RAG chunks.
 *
 * LEGAL
 * -----
 * This repo never commits TradingView® documentation dumps. Place a lawful
 * offline export at knowledge/pineDocs.json (gitignored) and run this script.
 * Staged output lives under knowledge/data/docs (also gitignored).
 *
 * Usage:
 *   bun run ingest:pinedocs
 *   bun run ingest:pinedocs -- --file ./knowledge/pineDocs.json --version v6
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chunkText, sha1ish } from "./lib/chunk";
import {
  formatPineDocEntry,
  iterPineDocEntries,
  type PineDocsFile,
} from "./lib/pinedocs";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_FILE = join(ROOT, "knowledge", "pineDocs.json");

function parseArgs(argv: string[]) {
  let file = DEFAULT_FILE;
  let version: "v5" | "v6" | "mixed" = "v6";
  let kind = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") file = argv[++i] || file;
    else if (argv[i] === "--kind") kind = argv[++i] || "";
    else if (argv[i] === "--version") {
      const v = argv[++i];
      if (v === "v5" || v === "v6" || v === "mixed") version = v;
    }
  }
  return { file: resolve(file), version, kind };
}

async function main() {
  const { file, version, kind: kindOverride } = parseArgs(process.argv.slice(2));
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    console.error(
      `Missing pineDocs.json at ${file}\n` +
        "Place an operator-private language reference there (gitignored),\n" +
        "then re-run: bun run ingest:pinedocs\n" +
        "Pine Script™ / TradingView® marks belong to TradingView, Inc."
    );
    process.exit(2);
  }

  let data: PineDocsFile;
  try {
    data = JSON.parse(raw) as PineDocsFile;
  } catch (e) {
    console.error(`Invalid JSON: ${file}`);
    console.error(e);
    process.exit(2);
  }

  const entries = iterPineDocEntries(data);
  if (!entries.length) {
    console.error("No language-reference entries found in pineDocs.json");
    process.exit(2);
  }

  const kind =
    kindOverride ||
    (version === "v5" ? "docs-v5" : version === "v6" ? "docs-v6" : "docs");
  const OUT = join(
    ROOT,
    "knowledge",
    "data",
    kind === "docs-axis" ? "axis" : "docs"
  );
  await mkdir(OUT, { recursive: true });
  const manifest: unknown[] = [];
  let chunks = 0;

  for (const { section, title, entry } of entries) {
    const text = formatPineDocEntry(entry);
    if (!text) continue;
    const name = String(entry.name);
    const parts = chunkText(text, {
      idPrefix: `pinedocs:${sha1ish(`${section}:${name}`)}`,
      title: name,
      source: `pinedocs:${section}/${name}`,
      kind,
      maxChars: 2200,
      overlap: 180,
    });
    for (const c of parts) {
      const outPath = join(OUT, `${c.id.replace(/[:/]/g, "_")}.json`);
      await writeFile(
        outPath,
        JSON.stringify(
          {
            ...c,
            section,
            group: title,
            marks: {
              pine: "Pine Script™",
              tradingView: "TradingView®",
            },
          },
          null,
          2
        )
      );
      manifest.push({ id: c.id, file: outPath, kind: c.kind, title: c.title, section });
      chunks += 1;
    }
  }

  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source: file,
        files: entries.length,
        chunks,
        version,
        note:
          "Staging only — gitignored. Upload with scripts/build-index.ts. " +
          "Do not commit. Pine Script™ and TradingView® are trademarks of TradingView, Inc.",
        items: manifest,
      },
      null,
      2
    )
  );

  console.log(`Staged ${chunks} chunks from ${entries.length} pineDocs entries → ${OUT}`);
  console.log("Next: bun run ingest:index");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
