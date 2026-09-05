// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Split HOOX llm.txt / *-llm.txt packs (FILE: path …) into RAG documents.
 * These packs are first-party AXIS / PYNE docs, not TradingView® corpora.
 */

export type LlmPackDoc = {
  path: string;
  title: string;
  description?: string;
  text: string;
};

const FILE_RE = /^FILE:\s+(\S+)\s*$/m;
const FRONT_TITLE = /^title:\s*"?([^"\n]+)"?\s*$/m;
const FRONT_DESC = /^description:\s*"?([^"\n]+)"?\s*$/m;

export function splitLlmPack(raw: string): LlmPackDoc[] {
  const src = String(raw || "").replace(/\r\n/g, "\n");
  if (!src.trim()) return [];

  const matches: Array<{ path: string; start: number; headerEnd: number }> = [];
  const re = /^FILE:\s+(\S+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    matches.push({ path: m[1]!, start: m.index, headerEnd: m.index + m[0].length });
  }
  if (!matches.length) {
    const text = stripLicense(src).trim();
    return text ? [{ path: "pack", title: inferTitle(text, "pack"), text }] : [];
  }

  const out: LlmPackDoc[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const end = i + 1 < matches.length ? matches[i + 1]!.start : src.length;
    const body = stripLicense(src.slice(cur.headerEnd, end)).trim();
    if (!body) continue;
    const title = FRONT_TITLE.exec(body)?.[1]?.trim() || inferTitle(body, cur.path);
    const description = FRONT_DESC.exec(body)?.[1]?.trim();
    out.push({
      path: cur.path,
      title,
      description,
      text: body,
    });
  }
  return out;
}

export function formatLlmPackDoc(doc: LlmPackDoc, product: string): string {
  const lines = [
    `# ${doc.title}`,
    `product: ${product}`,
    `path: ${doc.path}`,
  ];
  if (doc.description) lines.push(`description: ${doc.description}`);
  lines.push("", doc.text);
  lines.push(
    "",
    "HOOX first-party documentation. Pine Script™ / TradingView® marks of TradingView, Inc. Cloudflare® mark of Cloudflare, Inc."
  );
  return lines.join("\n").trim();
}

function stripLicense(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    if (
      !t ||
      /^copyright/i.test(t) ||
      /^this file is part of/i.test(t) ||
      /^spdx-license/i.test(t) ||
      /^pynescript is (free|distributed)/i.test(t) ||
      /^you should have received/i.test(t) ||
      /^along with pynescript/i.test(t) ||
      /^it under the terms/i.test(t) ||
      /^the free software foundation/i.test(t) ||
      /^gnu affero/i.test(t) ||
      /^but without any warranty/i.test(t) ||
      /^merchantability/i.test(t) ||
      t === "#"
    ) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n");
}

function inferTitle(text: string, fallback: string): string {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return heading[1]!.trim();
  const base = fallback.split("/").pop() || fallback;
  return base.replace(/\.(mdx|md|txt)$/i, "").replace(/[-_]/g, " ");
}
