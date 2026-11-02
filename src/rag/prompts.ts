// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MARKS, DISCLAIMER_SHORT } from "../lib/legal";
import {
  detectPersona,
  normalizePersona,
  personaSystemSection,
  type PersonaId,
} from "../agent/personas";
import { buildPineHardRules } from "../agent/pine-rules";
import {
  buildGrandmasterSection,
  type GrandmasterToolsMode,
} from "../agent/grandmaster";
import type { RagChunk } from "./retrieve";

/**
 * System prompt for the PYNE coding agent (REST path).
 * Always references legal marks; never claims TV platform bit-parity.
 */
export function buildSystemPrompt(opts?: {
  pineVersion?: "v5" | "v6" | "auto";
  style?: "indicator" | "strategy" | "library" | "auto";
  persona?: PersonaId;
  /** Latest user message (drives auto-detection). */
  userText?: string;
  /**
   * Tool surface for this turn.
   * none = cheap REST; axis = looksActionable; full = orchestrate:true.
   */
  tools?: GrandmasterToolsMode;
}): string {
  const ver = opts?.pineVersion ?? "auto";
  const style = opts?.style ?? "auto";
  const tools: GrandmasterToolsMode = opts?.tools ?? "none";
  const explicit = normalizePersona(opts?.persona);
  const persona = explicit !== "auto" ? explicit : detectPersona(opts?.userText || "");
  const includeAxisControl = tools !== "none";

  return [
    `You are **PYNE Agent**, a Pine Script™ v5/v6 grandmaster for the HOOX / PYNE / AXIS stack on ${MARKS.cloudflare} Workers.`,
    ``,
    `Legal: ${DISCLAIMER_SHORT}`,
    ``,
    buildGrandmasterSection({ tools }),
    ``,
    `## Script kind preference: ${style}`,
    style === "auto"
      ? `- Infer indicator vs strategy vs library from the user request.`
      : `- Prefer script kind: ${style}.`,
    `- Target language version preference: ${ver}.`,
    ``,
    personaSystemSection(persona, { includeAxisControl }),
    ``,
    buildPineHardRules(ver),
    ``,
    `## Mode pick`,
    `Pick **one** mode (A = script, B = how-to, C = small-talk). Do not mix an AXIS tutorial with a filler script.`,
    ``,
    `### Mode A — write / edit a script`,
    `Follow the Grandmaster output format (bullets + one \`\`\`pine fence).`,
    ``,
    `### Mode B — AXIS / PYNE product how-to (no script asked)`,
    `Plain lead line. Then 3–7 numbered steps with exact UI labels.`,
    `Live AXIS topbar uses **DSM** for Data Source Manager. Prefer **DSM**.`,
    `Do **not** emit a \`\`\`pine block in this mode.`,
    ``,
    `### Mode C — conversational small-talk (hi, thanks, ok, bye)`,
    `One short friendly line plus one question (what to build, which Pine version).`,
    `Never emit a \`\`\`pine block in this mode.`,
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
  const t = String(userText || "").toLowerCase().trim();
  if (!t) return false;
  // Chit-chat is never a script request — otherwise a plain "hi" triggers a
  // pointless generate→validate→retry loop and the fix prompt goads the model
  // into delivering an unprompted script ("revised" from nothing).
  if (
    /^(hi|hey|hello|yo|sup|thanks|thank you|thx|ok|okay|yes|no|sure|please|bye)\b[.!…]*$/i.test(
      t
    )
  ) {
    return false;
  }
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

function looksLikePineSource(src: string): boolean {
  return (
    /\/\/\s*@version\s*=\s*[56]\b/i.test(src) ||
    /\b(indicator|strategy|library)\s*\(/.test(src)
  );
}

/**
 * Extract the first fenced Pine Script™ block.
 * Language `pine` / `pinescript` / `pyne` wins; an untagged fence is used only
 * when the body looks like Pine. ```js / ```ts / etc. are never treated as Pine.
 */
export function extractPineBlock(text: string): string | null {
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let untagged: string | null = null;
  while ((m = re.exec(text)) !== null) {
    const lang = String(m[1] || "").trim().split(/\s+/)[0] || "";
    const body = (m[2] || "").trim();
    if (!body) continue;
    if (/^(pine|pinescript|pine-script|pyne)$/i.test(lang)) return body;
    if (!lang && looksLikePineSource(body) && !untagged) untagged = body;
  }
  return untagged;
}
