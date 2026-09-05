#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One-shot operator ingest: pineDocs + AXIS KB + HOOX llm packs + sister-repo docs.
 *
 *   bun run ingest:kb
 *   bun run ingest:kb -- --dry-run
 */

import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const dry = process.argv.includes("--dry-run");

function run(script: string, args: string[] = []): number {
  const cmd = ["bun", "run", script, ...args];
  console.log(`$ ${cmd.join(" ")}`);
  if (dry) return 0;
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: ROOT, stdio: "inherit" });
  return r.status ?? 1;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const pineDocs = join(ROOT, "knowledge", "pineDocs.json");
  const axisLlm = join(ROOT, "knowledge", "axis-llm.txt");
  const pyneLlm = join(ROOT, "knowledge", "pyne-llm.txt");
  const sisterAxis = join(ROOT, "..", "axis", "docs");
  const sisterPyne = join(ROOT, "..", "pynescript", "docs", "pyne");

  let steps = 0;

  if (await exists(sisterAxis)) {
    const st = run(join(ROOT, "scripts", "build-axis-kb.ts"));
    if (st !== 0) process.exit(st);
    steps += 1;
  } else if (await exists(axisLlm)) {
    const st = run(join(ROOT, "scripts", "build-axis-kb.ts"));
    if (st !== 0) process.exit(st);
    steps += 1;
  }

  const axisDocs = join(ROOT, "knowledge", "axisDocs.json");
  if (await exists(pineDocs)) {
    const st = run(join(ROOT, "scripts", "ingest-pinedocs.ts"), ["--file", pineDocs, "--version", "v6"]);
    if (st !== 0) process.exit(st);
    steps += 1;
  }
  if (await exists(axisDocs)) {
    const st = run(join(ROOT, "scripts", "ingest-pinedocs.ts"), [
      "--file",
      axisDocs,
      "--version",
      "mixed",
      "--kind",
      "docs-axis",
    ]);
    if (st !== 0) process.exit(st);
    steps += 1;
  }

  if (!(await exists(axisDocs)) && (await exists(axisLlm))) {
    const st = run(join(ROOT, "scripts", "ingest-llm-pack.ts"), [
      "--file",
      axisLlm,
      "--product",
      "axis",
    ]);
    if (st !== 0) process.exit(st);
    steps += 1;
  }

  if (await exists(sisterPyne)) {
    const st = run(join(ROOT, "scripts", "ingest-docs.ts"), ["--pyne-docs", sisterPyne]);
    if (st !== 0) process.exit(st);
    steps += 1;
  } else if (await exists(pyneLlm)) {
    const st = run(join(ROOT, "scripts", "ingest-llm-pack.ts"), [
      "--file",
      pyneLlm,
      "--product",
      "pyne",
    ]);
    if (st !== 0) process.exit(st);
    steps += 1;
  }

  if (!steps) {
    console.error(
      "Nothing to ingest. Add knowledge/pineDocs.json, knowledge/axis-llm.txt,\n" +
        "knowledge/pyne-llm.txt, or clone sister repos (axis, pynescript) next to this worker."
    );
    process.exit(2);
  }

  console.log(dry ? "[dry-run] done" : "Staged. Next: bun run ingest:index");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
