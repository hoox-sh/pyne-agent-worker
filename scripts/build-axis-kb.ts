#!/usr/bin/env bun
// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build knowledge/axisDocs.json — structured AXIS PWA knowledge base.
 *
 * Prefers live sister-repo MDX (../axis/docs). Falls back to knowledge/axis-llm.txt.
 * Output is operator-private (gitignored) and ingested by ingest:pinedocs / ingest:kb.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { splitLlmPack } from "./lib/llm-pack";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "knowledge", "axisDocs.json");
const SISTER = join(ROOT, "..", "axis", "docs");
const LLM_PACK = join(ROOT, "knowledge", "axis-llm.txt");

type Entry = {
  name: string;
  kind: string;
  desc: string;
  syntax?: string;
  remarks?: string;
  path?: string;
};

type Section = { title: string; docs: Entry[] };

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      yield* walk(p);
    } else if (e.isFile() && [".md", ".mdx"].includes(extname(e.name).toLowerCase())) {
      if (e.name === "llm.txt" || e.name === "llms.txt") continue;
      yield p;
    }
  }
}

function stripLicense(text: string): string {
  return text
    .replace(/^# Copyright[\s\S]*?SPDX-License-Identifier:[^\n]*\n+/i, "")
    .replace(/^Copyright[\s\S]*?SPDX-License-Identifier:[^\n]*\n+/i, "")
    .trim();
}

function parseFrontmatter(raw: string): { title?: string; description?: string; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { body: raw };
  const fm = m[1] || "";
  const title = fm.match(/^title:\s*"?([^"\n]+)"?/m)?.[1];
  const description = fm.match(/^description:\s*"?([^"\n]+)"?/m)?.[1];
  return { title, description, body: (m[2] || "").trim() };
}

function sectionOf(rel: string): string {
  const top = rel.split("/")[0] || "product";
  const map: Record<string, string> = {
    architecture: "architecture",
    devops: "devops",
    enduser: "enduser",
    plugins: "plugins",
    reference: "reference",
    ui: "ui",
    worker: "worker",
  };
  return map[top] || "product";
}

function titles(): Record<string, string> {
  return {
    product: "AXIS product",
    architecture: "Architecture",
    plugins: "Plugins",
    ui: "UI",
    worker: "Cloudflare Worker",
    enduser: "End user",
    devops: "DevOps",
    reference: "Reference",
    contracts: "Plugin contracts",
  };
}

const SURFACE: Entry[] = [
  {
    name: "axis-pwa",
    kind: "Product",
    desc:
      "AXIS is an installable SolidJS + Vite charting PWA. It treats price, time, and calculation as separable axes. " +
      "Sources load history, streams advance live bars, engines evaluate Pine Script™ via PYNE, storage holds the script library. " +
      "AXIS never embeds a closed interpreter (AXIS ≠ engine). Evaluation always goes through EnginePlugin.run. " +
      "Namespace: pynescript.axis.plugins.v1. Independent of TradingView®.",
    syntax: "kind: source | stream | engine | storage | dataset | component",
    remarks:
      "Product UI: src/index.tsx, src/app.tsx. Chart: lightweight-charts isolated in ChartHost / PaneManager. " +
      "Engines: server (POST /run), pyodide (in-browser), optional worker proxy. Desktop: Tauri 2.",
  },
  {
    name: "plugin-kind",
    kind: "Contract",
    desc:
      "Every AXIS plugin shares PluginBase (id, name, kind, description, version, builtIn, configSchema, capabilities, init/dispose). " +
      "pluginKey(kind, id) → `${kind}:${id}` for store.pluginsConfig.",
    syntax: "type PluginKind = 'source' | 'stream' | 'engine' | 'storage' | 'component'",
  },
  {
    name: "SourcePlugin",
    kind: "Contract",
    desc:
      "fetchHistorical({ symbol, interval, limit?, config? }) → Promise<Bar[]>. Optional searchSymbols. " +
      "Bar: { time (unix seconds), open, high, low, close, volume? }.",
    syntax: "kind: 'source'; fetchHistorical(opts): Promise<Bar[]>",
  },
  {
    name: "StreamPlugin",
    kind: "Contract",
    desc:
      "start(opts) must return a stop() that closes sockets/timers. AXIS calls stop on symbol change or unmount. " +
      "onBar / onError / onStatus. Live pairs with history via defaultStreamForSource.",
    syntax: "kind: 'stream'; start(opts): () => void",
  },
  {
    name: "EnginePlugin",
    kind: "Contract",
    desc:
      "isReady() then run({ script, bars, config?, signal? }) → RunResult { status, plots, series?, events, drawings?, error?, meta? }. " +
      "plots is the primary overlay; strategy fills live in events; drawings carry line/label/box objects. " +
      "Prefer status:'error' over throwing.",
    syntax: "kind: 'engine'; run(opts): Promise<RunResult>",
  },
  {
    name: "StoragePlugin",
    kind: "Contract",
    desc:
      "list/read/write/remove required. Optional saveDraft/loadDraft, sync(push|pull|both), getStatus. " +
      "Built-ins: local IndexedDB, cloud, git (GitHub/GitLab).",
    syntax: "kind: 'storage'",
  },
  {
    name: "ComponentPlugin",
    kind: "Contract",
    desc:
      "URL-loadable UI plugin. Export default ES module: kind:'component', slots, mount(slot, el, api), optional init/dispose. " +
      "PYNE Agent uses this to inject NL→script chat. Slots: manager-tab | results-tab | topbar-action | settings-section.",
    syntax: "kind: 'component'; mount(slot, el, api): () => void",
  },
  {
    name: "pyne-agent-plugin",
    kind: "AXIS plugin",
    desc:
      "Sister worker pyne-agent-worker writes Pine Script™ from natural language. It does not evaluate — AXIS still runs the active engine. " +
      "Install same-origin /plugins/axis-pine-agent.js (or remote GET /plugin/axis-pine-agent.js). " +
      "Config: endpoint (agent origin, no trailing slash), apiKey, pineVersion (auto|v5|v6), style (auto|indicator|strategy|library). " +
      "API: POST /v1/chat. Standalone Workers AI™ is enough; pyne-worker validate is optional.",
    syntax: "POST /v1/chat  { message, pine_version, style, validate, max_retries }",
    remarks:
      "Auth: X-API-Key or Authorization: Bearer when API_KEY is set. " +
      "Insert via api.insertScript or copy the fenced pine block into the editor, then Run.",
  },
  {
    name: "runAndApply",
    kind: "Runtime",
    desc:
      "AXIS run pipeline: getActiveEngine().run → setLastRun → optional results → syncOverlayLines (no blank destroy) → " +
      "markers + strategy report → atomic drawing replace → equity pane. " +
      "History load bumps chartDataGen (full setData + fit). Live ticks only manager.appendBar.",
    syntax: "src/indicators/runner.ts",
  },
  {
    name: "evaluation-hosts",
    kind: "Runtime",
    desc:
      "server engine: HTTP JSON { script, data } → POST /run (local PYNE Pro API :5002 or Worker proxy). " +
      "pyodide engine: in-browser pynescript wheels + pynescript_runtime.py (offline after cache). " +
      "Timeout scales with bar length; live re-runs use shorter silent timeouts.",
    syntax: "engines: server | pyodide",
  },
];

async function fromSister(): Promise<Record<string, Section> | null> {
  const st = await stat(SISTER).catch(() => null);
  if (!st?.isDirectory()) return null;
  const sections: Record<string, Section> = {};
  const titleMap = titles();
  for (const key of Object.keys(titleMap)) {
    sections[key] = { title: titleMap[key]!, docs: [] };
  }
  sections.contracts.docs.push(...SURFACE);

  for await (const file of walk(SISTER)) {
    const raw = await readFile(file, "utf8");
    const { title, description, body } = parseFrontmatter(stripLicense(raw));
    const rel = relative(SISTER, file);
    const key = sectionOf(rel);
    const name = rel.replace(/\.(mdx|md)$/i, "");
    const desc = [description, body].filter(Boolean).join("\n\n");
    if (!desc.trim()) continue;
    sections[key] ??= { title: titleMap[key] || key, docs: [] };
    sections[key].docs.push({
      name,
      kind: "AXIS doc",
      desc,
      path: `../axis/docs/${rel}`,
      remarks: title ? `title: ${title}` : undefined,
    });
  }
  return sections;
}

async function fromLlmPack(): Promise<Record<string, Section> | null> {
  const raw = await readFile(LLM_PACK, "utf8").catch(() => null);
  if (!raw) return null;
  const docs = splitLlmPack(raw);
  if (!docs.length) return null;
  const sections: Record<string, Section> = {};
  const titleMap = titles();
  for (const key of Object.keys(titleMap)) {
    sections[key] = { title: titleMap[key]!, docs: [] };
  }
  sections.contracts.docs.push(...SURFACE);
  for (const doc of docs) {
    const rel = doc.path.replace(/^(\.\.\/)?axis\/docs\//, "");
    const key = sectionOf(rel);
    sections[key] ??= { title: titleMap[key] || key, docs: [] };
    sections[key].docs.push({
      name: rel.replace(/\.(mdx|md)$/i, ""),
      kind: "AXIS doc",
      desc: [doc.description, doc.text].filter(Boolean).join("\n\n"),
      path: doc.path,
      remarks: `title: ${doc.title}`,
    });
  }
  return sections;
}

async function main() {
  const sections = (await fromSister()) || (await fromLlmPack());
  if (!sections) {
    console.error(
      "Need ../axis/docs or knowledge/axis-llm.txt to build the AXIS KB.\n" +
        "Place the pack, or clone the sister repo next to this worker."
    );
    process.exit(2);
  }

  await mkdir(dirname(OUT), { recursive: true });
  const payload = {
    _meta: {
      product: "AXIS",
      pine: "Pine Script™",
      tradingView: "TradingView®",
      cloudflare: "Cloudflare®",
      updated: new Date().toISOString().slice(0, 10),
      namespace: "pynescript.axis.plugins.v1",
      source: (await stat(SISTER).catch(() => null)) ? "../axis/docs" : "knowledge/axis-llm.txt",
      redistributable: true,
      license: "AGPL-3.0-only",
      note: "HOOX first-party AXIS PWA knowledge. Operator-staged; do not treat as TradingView® content.",
    },
    ...Object.fromEntries(
      Object.entries(sections).filter(([, s]) => s.docs.length)
    ),
  };
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
  const n = Object.values(sections).reduce((a, s) => a + s.docs.length, 0);
  console.log(`Wrote ${OUT} (${n} entries)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
