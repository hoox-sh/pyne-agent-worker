// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Canonical RAG kind metadata (Vectorize + R2). */

export type KnowledgeKind =
  | "docs-v5"
  | "docs-v6"
  | "docs"
  | "docs-axis"
  | "docs-pyne"
  | "corpus"
  | "builtin-ref"
  | "template"
  | "other";

/** Map legacy AXIS / product labels to canonical KnowledgeKind. */
export function normalizeKnowledgeKind(raw: string): KnowledgeKind {
  const s = String(raw || "").trim();
  const legacy: Record<string, KnowledgeKind> = {
    "AXIS doc": "docs-axis",
    Product: "docs-axis",
    Contract: "docs-axis",
    "AXIS plugin": "docs-axis",
    Runtime: "docs-axis",
    "docs-axis": "docs-axis",
    "docs-pyne": "docs-pyne",
    "docs-v5": "docs-v5",
    "docs-v6": "docs-v6",
    docs: "docs",
    corpus: "corpus",
    "builtin-ref": "builtin-ref",
    template: "template",
    other: "other",
  };
  if (legacy[s]) return legacy[s]!;
  const lower = s.toLowerCase();
  if (lower.includes("axis")) return "docs-axis";
  if (lower.includes("pyne") && lower.includes("doc")) return "docs-pyne";
  return "other";
}
