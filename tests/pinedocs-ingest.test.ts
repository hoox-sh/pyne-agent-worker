// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { formatPineDocEntry, iterPineDocEntries } from "../scripts/lib/pinedocs";
import { formatLlmPackDoc, splitLlmPack } from "../scripts/lib/llm-pack";

describe("formatPineDocEntry", () => {
  test("renders name, syntax, args, example", () => {
    const text = formatPineDocEntry({
      name: "input.enum",
      kind: "Built-in Function",
      desc: "Dropdown from a Pine Script™ enum.",
      syntax: "input.enum(defval, title) → input enum",
      args: [{ name: "defval", required: true, displayType: "const enum", desc: "Default member" }],
      examples: '//@version=6\nindicator("e")',
    });
    expect(text).toContain("# input.enum");
    expect(text).toContain("syntax: input.enum");
    expect(text).toContain("defval");
    expect(text).toContain("//@version=6");
    expect(text).toContain("Pine Script™");
  });

  test("skips nameless entries", () => {
    expect(formatPineDocEntry({})).toBe("");
  });
});

describe("iterPineDocEntries", () => {
  test("walks section docs and skips _meta", () => {
    const rows = iterPineDocEntries({
      _meta: { updated: "2026-08-19" },
      functions: [{ title: "Built-in Function", docs: [{ name: "plot", desc: "plot series" }] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry.name).toBe("plot");
    expect(rows[0]?.section).toBe("functions");
  });

  test("accepts object-shaped sections (AXIS KB)", () => {
    const rows = iterPineDocEntries({
      plugins: { title: "Plugins", docs: [{ name: "SourcePlugin", desc: "fetch history" }] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry.name).toBe("SourcePlugin");
  });
});

describe("splitLlmPack", () => {
  test("splits FILE sections and strips license", () => {
    const pack = [
      "AXIS CONSOLIDATED DOCUMENTATION",
      "FILE: ../axis/docs/plugins/pyne-agent.mdx",
      "Copyright (C) - jango",
      "SPDX-License-Identifier: AGPL-3.0-only",
      "---",
      'title: "PYNE Agent plugin"',
      'description: "NL script chat"',
      "---",
      "PYNE Agent plugin",
      "Install /plugins/axis-pine-agent.js",
      "FILE: ../axis/docs/index.mdx",
      "# AXIS Documentation",
      "Sources load history.",
    ].join("\n");
    const docs = splitLlmPack(pack);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.title).toBe("PYNE Agent plugin");
    expect(docs[0]?.text).not.toMatch(/SPDX-License/);
    expect(docs[0]?.text).toContain("axis-pine-agent.js");
    expect(docs[1]?.title).toBe("AXIS Documentation");
    const formatted = formatLlmPackDoc(docs[0]!, "axis");
    expect(formatted).toContain("product: axis");
    expect(formatted).toContain("Cloudflare®");
  });

  test("empty pack", () => {
    expect(splitLlmPack("   ")).toEqual([]);
  });
});
