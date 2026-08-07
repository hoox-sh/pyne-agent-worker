#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Operator-only ingest of Pine Script™ built-in *references* for private RAG.
 *
 * LEGAL
 * -----
 * TradingView® built-in indicator/strategy **source code** is proprietary.
 * This repository MUST NOT contain those files. This script:
 *
 * 1. Reads from a path you supply outside the repo (or a gitignored dir).
 * 2. Stages chunks under knowledge/data/builtins (gitignored).
 * 3. Never prints full sources to logs.
 * 4. Refuses to run if the destination would be force-added to git.
 *
 * Preferred input: metadata / API signatures / your own re-implementations /
 * documentation excerpts you are allowed to use — NOT a wholesale dump of
 * TV built-in .pine files for redistribution.
 *
 * Usage:
 *   bun run scripts/ingest-builtins.ts --dir /secure/path/builtin-refs
 *   bun run scripts/ingest-builtins.ts --metadata ../pynescript/.../builtin_metadata.json
 */

import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, extname, basename, resolve } from "node:path";
import { chunkText, sha1ish } from "./lib/chunk";

const ROOT = resolve(join(import.meta.dir, ".."));
const OUT = join(ROOT, "knowledge", "data", "builtins");

function parseArgs(argv: string[]) {
  let dir = "";
  let metadata = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i] || "";
    else if (argv[i] === "--metadata") metadata = argv[++i] || "";
  }
  return { dir, metadata };
}

function assertOutsideOrGitignored(path: string) {
  const abs = resolve(path);
  // Allow gitignored knowledge/data paths and anything outside the repo root.
  if (abs.startsWith(join(ROOT, "knowledge", "data"))) return;
  if (!abs.startsWith(ROOT)) return;
  // Inside repo but not under knowledge/data → refuse (prevents committing sources)
  if (
    abs.includes(`${join(ROOT, "knowledge", "templates")}`) ||
    abs.endsWith(".pine.example")
  ) {
    return;
  }
  console.error(
    "Refusing to read built-in sources from a non-gitignored path inside the repo.\n" +
      "Place them outside the repository or under knowledge/data/ (gitignored).\n" +
      `Path: ${abs}`
  );
  process.exit(3);
}

async function ingestMetadata(path: string) {
  assertOutsideOrGitignored(path);
  const raw = await readFile(path, "utf8");
  const data = JSON.parse(raw) as Record<string, unknown>;
  await mkdir(OUT, { recursive: true });
  let n = 0;
  for (const [name, value] of Object.entries(data)) {
    const text =
      typeof value === "string"
        ? value
        : JSON.stringify({ name, ...(value as object) }, null, 2);
    const body = `Builtin reference: ${name}\n\n${text}`;
    const parts = chunkText(body, {
      idPrefix: `builtin-ref:${sha1ish(name)}`,
      title: name,
      source: `builtin-metadata:${name}`,
      kind: "builtin-ref",
      maxChars: 2000,
    });
    for (const c of parts) {
      await writeFile(
        join(OUT, `${c.id.replace(/[:/]/g, "_")}.json`),
        JSON.stringify(c, null, 2)
      );
      n += 1;
    }
  }
  return n;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if ([".pine", ".txt", ".md", ".json"].includes(ext)) yield p;
    }
  }
}

async function main() {
  const { dir, metadata } = parseArgs(process.argv.slice(2));
  if (!dir && !metadata) {
    console.error(
      "Usage:\n" +
        "  bun run scripts/ingest-builtins.ts --metadata /path/to/builtin_metadata.json\n" +
        "  bun run scripts/ingest-builtins.ts --dir /secure/builtin-refs\n\n" +
        "Private RAG only. Never commit TradingView® built-in sources.\n" +
        "Pine Script™ and TradingView® are trademarks of TradingView, Inc."
    );
    process.exit(2);
  }

  await mkdir(OUT, { recursive: true });
  let chunks = 0;

  if (metadata) {
    chunks += await ingestMetadata(metadata);
  }

  if (dir) {
    assertOutsideOrGitignored(dir);
    const st = await stat(dir).catch(() => null);
    if (!st?.isDirectory()) {
      console.error(`Not a directory: ${dir}`);
      process.exit(2);
    }
    for await (const file of walk(dir)) {
      const raw = await readFile(file, "utf8");
      const title = basename(file);
      const rel = relative(dir, file);
      const parts = chunkText(raw, {
        idPrefix: `builtin-ref:${sha1ish(rel)}`,
        title,
        source: `operator-builtins:${rel}`,
        kind: "builtin-ref",
        maxChars: 2000,
      });
      for (const c of parts) {
        await writeFile(
          join(OUT, `${c.id.replace(/[:/]/g, "_")}.json`),
          JSON.stringify(c, null, 2)
        );
        chunks += 1;
      }
    }
  }

  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        chunks,
        warning:
          "Operator-private built-in references. Do not redistribute. " +
          "Not part of the public git tree. " +
          "Pine Script™ / TradingView® are trademarks of TradingView, Inc.",
      },
      null,
      2
    )
  );

  console.log(`Staged ${chunks} builtin-ref chunks → ${OUT} (gitignored)`);
  console.log("Next: bun run scripts/build-index.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
