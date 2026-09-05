// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Operator pineDocs.json → RAG text.
 *
 * The JSON is an operator-private language-reference dump (not committed).
 * This module only formats entries you already have the right to ingest.
 */

export type PineDocArg = {
  name?: string;
  desc?: string;
  default?: unknown;
  required?: boolean;
  displayType?: string;
};

export type PineDocEntry = {
  name?: string;
  kind?: string;
  desc?: string;
  syntax?: string;
  remarks?: string | string[];
  returns?: string;
  returnedType?: string;
  examples?: string | string[];
  seeAlso?: string[];
  args?: PineDocArg[];
  detailedDesc?: Array<{ desc?: string; examples?: string }>;
};

export type PineDocGroup = { title?: string; docs?: PineDocEntry[] };

export type PineDocsFile = {
  _meta?: Record<string, unknown>;
  [section: string]: PineDocGroup | PineDocGroup[] | Record<string, unknown> | undefined;
};

export function formatPineDocEntry(entry: PineDocEntry): string {
  const name = String(entry.name || "").trim();
  if (!name) return "";

  const lines: string[] = [`# ${name}`];
  if (entry.kind) lines.push(`kind: ${entry.kind}`);
  if (entry.syntax) lines.push(`syntax: ${entry.syntax}`);
  if (entry.desc) {
    lines.push("", String(entry.desc).replace(/\\`/g, "`"));
  }

  if (entry.args?.length) {
    lines.push("", "## Arguments");
    for (const a of entry.args) {
      if (!a?.name) continue;
      const bits = [
        a.displayType,
        a.required ? "required" : "optional",
        a.default != null && a.default !== "" ? `default ${String(a.default)}` : null,
      ].filter(Boolean);
      const head = bits.length ? ` (${bits.join(", ")})` : "";
      const desc = a.desc ? ` — ${String(a.desc).replace(/\\`/g, "`")}` : "";
      lines.push(`- ${a.name}${head}${desc}`);
    }
  }

  const ret = entry.returns || entry.returnedType;
  if (ret) {
    lines.push("", "## Returns", String(ret));
  }

  const remarks = flattenRemarks(entry.remarks);
  if (remarks) {
    lines.push("", "## Remarks", remarks);
  }

  const extra = (entry.detailedDesc || [])
    .map((d) => String(d.desc || "").trim())
    .filter(Boolean);
  if (extra.length) {
    lines.push("", extra.join("\n\n"));
  }

  const examples = flattenExamples(entry.examples);
  if (examples) {
    lines.push("", "## Example", "```pine", examples, "```");
  }

  const see = flattenSeeAlso(entry.seeAlso);
  if (see) {
    lines.push("", "## See also", see);
  }

  lines.push(
    "",
    "Pine Script™ is a trademark of TradingView, Inc. Operator-private RAG excerpt."
  );
  return lines.join("\n").trim();
}

export function iterPineDocEntries(
  data: PineDocsFile
): Array<{ section: string; title: string; entry: PineDocEntry }> {
  const out: Array<{ section: string; title: string; entry: PineDocEntry }> = [];
  for (const [section, value] of Object.entries(data)) {
    if (section.startsWith("_") || value == null || typeof value !== "object") continue;
    const groups = Array.isArray(value) ? value : [value];
    for (const group of groups) {
      if (!group || typeof group !== "object" || !("docs" in group)) continue;
      const g = group as { title?: string; docs?: PineDocEntry[] };
      const title = String(g.title || section);
      for (const entry of g.docs || []) {
        if (entry?.name) out.push({ section, title, entry });
      }
    }
  }
  return out;
}

function flattenRemarks(remarks: PineDocEntry["remarks"]): string {
  if (!remarks) return "";
  if (Array.isArray(remarks)) return remarks.map(String).join("\n");
  return String(remarks).replace(/\\`/g, "`");
}

function flattenExamples(examples: PineDocEntry["examples"]): string {
  if (!examples) return "";
  const raw = Array.isArray(examples) ? examples.join("\n\n") : String(examples);
  return raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\`/g, "`").trim();
}

function flattenSeeAlso(see: PineDocEntry["seeAlso"] | unknown): string {
  if (!see) return "";
  if (Array.isArray(see)) return see.map(String).join(", ");
  return String(see);
}
