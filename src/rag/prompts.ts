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
    `- Prefer PYNE/AXIS-friendly scripts (clear plots, inputs, enums, force_overlay, no proprietary TV-only APIs when avoidable).`,
    `- Default v6: no when=, no transp=, bool never na, request.security (not security), dynamic requests ok.`,
    `- When writing a script, explain briefly, then deliver one complete fenced \`\`\`pine block.`,
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
    `Pick **one** mode. Do not mix an AXIS tutorial with a filler script.`,
    ``,
    `### Mode A — write / edit a script`,
    `1. 1–4 short bullets (what you will build).`,
    `2. Exactly one complete \`\`\`pine fence with //@version=5 or //@version=6.`,
    `3. Optional one-line notes (inputs, overlay, Run in AXIS).`,
    `No "Example Workflow", no recap paragraph.`,
    ``,
    `### Mode B — AXIS / PYNE product how-to (no script asked)`,
    `Plain lead line (never write the words "Lead sentence"). Then 3–7 numbered steps.`,
    `Each step is one action: **button/field** + verb. Do not use chrome names as the step title.`,
    `Stop after the last step. No "Example Workflow", no "Notes:", no recap.`,
    `Live AXIS topbar uses **DSM** for Data Source Manager (docs may still say Data). Prefer **DSM**.`,
    `Other real labels: **Load**, **Start background backfill**, **Load to chart**, command palette **Toggle Data Source Manager**.`,
    `Do **not** emit a \`\`\`pine block in this mode.`,
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

/** True when the user is asking for a Pine Script™, not an AXIS/product how-to. */
export function wantsPineScript(userText: string): boolean {
  const t = String(userText || "").toLowerCase();
  if (!t.trim()) return false;
  const howTo =
    /\b(how (do i|to|can i)|where (is|do i)|which button|open the|toggle the|install (the )?plugin|backfill|data source manager|workers manager|command palette)\b/.test(
      t
    );
  const scriptIntent =
    /\b(write|create|generate|build|implement|code|indicator|strategy|library|plot|pine|script)\b/.test(
      t
    );
  if (howTo && !scriptIntent) return false;
  if (scriptIntent) return true;
  return !howTo;
}

/** Extract first fenced pine / pinescript / code block if present. */
export function extractPineBlock(text: string): string | null {
  const re =
    /```(?:pine|pinescript|pine-script)?\s*\n([\s\S]*?)```/i;
  const m = text.match(re);
  return m?.[1]?.trim() ? m[1].trim() : null;
}
