#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ingest an open Pine Script™ corpus (max 1000 scripts by default).
 *
 * The repository never stores .pine sources. You point this tool at a local
 * directory of lawfully obtained open scripts (e.g. your own, or OSS with
 * compatible licenses). TradingView® built-ins must NOT go through this path
 * — use ingest-builtins.ts for private operator-only built-in references.
 *
 * Usage:
 *   bun run scripts/ingest-corpus.ts --dir /path/to/open-pine --max 1000
 */

import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
import { chunkText, sha1ish } from "./lib/chunk";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "knowledge", "data", "corpus");
const DEFAULT_MAX = 1000;

function parseArgs(argv: string[]) {
  let dir = "";
  let max = DEFAULT_MAX;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i] || "";
    else if (argv[i] === "--max") max = Number(argv[++i] || DEFAULT_MAX);
  }
  return { dir, max: Number.isFinite(max) ? Math.min(Math.max(1, max), 1000) : DEFAULT_MAX };
}

async function* walkPine(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      // Refuse directories that look like TV built-in dumps
      if (/builtin|built-in|tv[_-]?official/i.test(e.name)) {
        console.warn(`skip forbidden dir name: ${p}`);
        continue;
      }
      yield* walkPine(p);
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if (ext === ".pine" || ext === ".pinescript" || e.name.endsWith(".pine.txt")) {
        yield p;
      }
    }
  }
}

async function main() {
  const { dir, max } = parseArgs(process.argv.slice(2));
  if (!dir) {
    console.error(
      "Usage: bun run scripts/ingest-corpus.ts --dir /path/to/open-scripts [--max 1000]\n" +
        "Open corpus only. No TradingView® built-ins. Not committed to git."
    );
    process.exit(2);
  }

  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(2);
  }

  await mkdir(OUT, { recursive: true });
  const manifest: unknown[] = [];
  let scripts = 0;
  let chunks = 0;

  for await (const file of walkPine(dir)) {
    if (scripts >= max) break;
    const raw = await readFile(file, "utf8");
    // Soft reject if file claims TV proprietary header without OSS license
    if (/copyright\s+tradingview/i.test(raw) && !/spdx-license|mit|apache|agpl|gpl/i.test(raw)) {
      console.warn(`skip likely proprietary: ${file}`);
      continue;
    }
    const title = basename(file);
    const rel = relative(dir, file);
    const parts = chunkText(raw, {
      idPrefix: `corpus:${sha1ish(rel)}`,
      title,
      source: `corpus:${rel}`,
      kind: "corpus",
      maxChars: 2400,
    });
    for (const c of parts) {
      const outPath = join(OUT, `${c.id.replace(/[:/]/g, "_")}.json`);
      await writeFile(outPath, JSON.stringify(c, null, 2));
      manifest.push({ id: c.id, title: c.title, source: c.source });
      chunks += 1;
    }
    scripts += 1;
  }

  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        scripts,
        chunks,
        max,
        note:
          "Open corpus staging (≤1000). Gitignored. Pine Script™ is a trademark of TradingView, Inc.",
        items: manifest,
      },
      null,
      2
    )
  );

  console.log(`Staged ${scripts} scripts → ${chunks} chunks (max ${max}) in ${OUT}`);
  console.log("Next: bun run scripts/build-index.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
