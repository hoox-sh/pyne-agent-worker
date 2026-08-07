// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Simple text chunker for RAG ingest (scripts only; not shipped as TV content). */

export type TextChunk = {
  id: string;
  text: string;
  title: string;
  source: string;
  kind: string;
};

export function chunkText(
  text: string,
  opts: {
    idPrefix: string;
    title: string;
    source: string;
    kind: string;
    maxChars?: number;
    overlap?: number;
  }
): TextChunk[] {
  const maxChars = opts.maxChars ?? 1800;
  const overlap = opts.overlap ?? 200;
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const chunks: TextChunk[] = [];
  let i = 0;
  let part = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + maxChars);
    let slice = cleaned.slice(i, end);
    // Prefer break on paragraph
    if (end < cleaned.length) {
      const nl = slice.lastIndexOf("\n\n");
      if (nl > maxChars * 0.4) slice = slice.slice(0, nl);
    }
    const body = slice.trim();
    if (body) {
      chunks.push({
        id: `${opts.idPrefix}:${part}`,
        text: body,
        title: opts.title,
        source: opts.source,
        kind: opts.kind,
      });
      part += 1;
    }
    if (end >= cleaned.length) break;
    i += Math.max(1, body.length - overlap);
  }
  return chunks;
}

export function sha1ish(s: string): string {
  // Lightweight non-crypto id for local scripts (not security-sensitive).
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
