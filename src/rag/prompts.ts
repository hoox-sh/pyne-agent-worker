// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MARKS, DISCLAIMER_SHORT } from "../lib/legal";
import type { RagChunk } from "./retrieve";

/**
 * System prompt for the PYNE coding agent.
 * Always references legal marks; never claims TV platform bit-parity.
 */
export function buildSystemPrompt(opts?: {
  pineVersion?: "v5" | "v6" | "auto";
  style?: "indicator" | "strategy" | "library" | "auto";
}): string {
  const ver = opts?.pineVersion ?? "auto";
  const style = opts?.style ?? "auto";

  return [
    `You are **PYNE Agent**, an expert assistant that writes ${MARKS.pine} code`,
    `for the HOOX / PYNE / AXIS stack using Cloudflare® Workers AI™.`,
    ``,
    `Legal: ${DISCLAIMER_SHORT}`,
    ``,
    `## Goals`,
    `- Produce correct, idiomatic ${MARKS.pine} (prefer v6 when version is auto; support v5 when asked).`,
    `- Prefer PYNE/AXIS-friendly scripts (clear plots, inputs, no proprietary TV-only APIs when avoidable).`,
    `- Explain briefly, then deliver a complete script in a fenced \`\`\`pine code block.`,
    `- When the user asks to edit, return the full updated script (not a partial patch) unless they request a diff.`,
    ``,
    `## Constraints`,
    `- Never invent non-existent ${MARKS.pine} builtins. Prefer symbols from the retrieved knowledge.`,
    `- Never claim bit-identical ${MARKS.tradingView} platform parity.`,
    `- Do not reproduce proprietary ${MARKS.tradingView} built-in indicator sources verbatim.`,
    `- If knowledge is insufficient, say so and write the best safe approximation with comments.`,
    `- Target version preference: ${ver}. Script kind preference: ${style}.`,
    `- Prefer code that parses and evaluates cleanly on PYNE/AXIS. (Optional: operator may validate via pyne-worker; not required.)`,
    ``,
    `## Output format`,
    `1. Short plan (1–4 bullets).`,
    `2. One complete \`\`\`pine block with //@version=5 or //@version=6.`,
    `3. Optional notes: inputs, known limitations, how to run on AXIS / PYNE.`,
  ].join("\n");
}

export function formatRagContext(chunks: RagChunk[]): string {
  if (!chunks.length) {
    return (
      "No knowledge-base hits for this query. " +
      "Rely on general Pine Script™ knowledge and be conservative."
    );
  }
  return chunks
    .map((c, i) => {
      const head = [
        `### [${i + 1}] ${c.title || c.id}`,
        c.source ? `source: ${c.source}` : null,
        c.kind ? `kind: ${c.kind}` : null,
        c.score != null ? `score: ${c.score.toFixed(4)}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return `${head}\n${c.text}`;
    })
    .join("\n\n");
}

export function buildUserAugmentedMessage(
  userText: string,
  chunks: RagChunk[]
): string {
  return [
    "## Retrieved knowledge (Pine Script™ docs / open corpus / operator builtins)",
    formatRagContext(chunks),
    "",
    "## User request",
    userText,
  ].join("\n");
}

/** Extract first fenced pine / pinescript / code block if present. */
export function extractPineBlock(text: string): string | null {
  const re =
    /```(?:pine|pinescript|pine-script)?\s*\n([\s\S]*?)```/i;
  const m = text.match(re);
  return m?.[1]?.trim() ? m[1].trim() : null;
}
