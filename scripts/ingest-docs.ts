#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ingest Pine Script™ v5/v6 documentation into local staging (gitignored),
 * then upload to R2 via wrangler.
 *
 * IMPORTANT
 * ---------
 * This repo never commits scraped docs. You must have the legal right to
 * copy documentation into your private Cloudflare® R2 bucket.
 *
 * Sources (operator-controlled):
 *   --dir ./path/to/markdown-or-text   (preferred: offline export)
 *   --pyne-docs ../pynescript/docs     (HOOX/PYNE surface docs; not TV)
 *
 * Official TradingView® reference pages are NOT scraped by default to avoid
 * accidental redistribution. If you hold rights / fair-use policy for private
 * RAG only, drop exports into --dir yourself.
 *
 * Usage:
 *   bun run scripts/ingest-docs.ts --dir ./my-pine-docs --version v6
 *   bun run scripts/ingest-docs.ts --pyne-docs ../pynescript/docs/pyne
 */

import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { chunkText, sha1ish } from "./lib/chunk";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "knowledge", "data", "docs");

type Args = {
  dir?: string;
  pyneDocs?: string;
  pinedocs?: string;
  version: "v5" | "v6" | "mixed";
};

function parseArgs(argv: string[]): Args {
  const out: Args = { version: "mixed" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--pyne-docs") out.pyneDocs = argv[++i];
    else if (a === "--pinedocs") out.pinedocs = argv[++i];
    else if (a === "--version") out.version = argv[++i] as Args["version"];
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      yield* walk(p);
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if ([".md", ".mdx", ".txt", ".rst", ".html"].includes(ext)) yield p;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources: { path: string; label: string; kind: string }[] = [];

  if (args.dir) {
    sources.push({
      path: args.dir,
      label: "operator-docs",
      kind: args.version === "v5" ? "docs-v5" : args.version === "v6" ? "docs-v6" : "docs",
    });
  }
  if (args.pyneDocs) {
    sources.push({
      path: args.pyneDocs,
      label: "pyne-docs",
      kind: "docs",
    });
  }

  if (args.pinedocs) {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      "bun",
      ["run", join(ROOT, "scripts", "ingest-pinedocs.ts"), "--file", args.pinedocs, "--version", args.version],
      { stdio: "inherit" }
    );
    if (r.status !== 0) process.exit(r.status || 1);
  }

  if (!sources.length && !args.pinedocs) {
    console.error(
      "Usage: bun run scripts/ingest-docs.ts --dir <docs-export> [--version v5|v6|mixed]\n" +
        "   or: bun run scripts/ingest-docs.ts --pyne-docs ../pynescript/docs/pyne\n" +
        "   or: bun run scripts/ingest-docs.ts --pinedocs ./knowledge/pineDocs.json\n\n" +
        "Does not scrape TradingView® by default. Place lawful offline exports in --dir.\n" +
        "Pine Script™ / TradingView® marks belong to TradingView, Inc."
    );
    process.exit(2);
  }

  if (!sources.length) return;

  await mkdir(OUT, { recursive: true });
  const manifest: unknown[] = [];
  let files = 0;
  let chunks = 0;

  for (const src of sources) {
    const st = await stat(src.path).catch(() => null);
    if (!st) {
      console.error(`skip missing: ${src.path}`);
      continue;
    }
    for await (const file of walk(src.path)) {
      const raw = await readFile(file, "utf8");
      const title = relative(src.path, file);
      const parts = chunkText(raw, {
        idPrefix: `docs:${sha1ish(file)}`,
        title,
        source: `${src.label}:${title}`,
        kind: src.kind,
      });
      for (const c of parts) {
        const outPath = join(OUT, `${c.id.replace(/[:/]/g, "_")}.json`);
        await writeFile(
          outPath,
          JSON.stringify(
            {
              ...c,
              marks: {
                pine: "Pine Script™",
                tradingView: "TradingView®",
              },
            },
            null,
            2
          )
        );
        manifest.push({ id: c.id, file: outPath, kind: c.kind, title: c.title });
        chunks += 1;
      }
      files += 1;
    }
  }

  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        files,
        chunks,
        note:
          "Staging only — gitignored. Upload with scripts/build-index.ts. " +
          "Do not commit. Pine Script™ and TradingView® are trademarks of TradingView, Inc.",
        items: manifest,
      },
      null,
      2
    )
  );

  console.log(`Staged ${chunks} chunks from ${files} files → ${OUT}`);
  console.log("Next: bun run scripts/build-index.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
