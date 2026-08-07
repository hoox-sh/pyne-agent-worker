// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { chunkText } from "../scripts/lib/chunk";

describe("chunkText", () => {
  test("splits long text", () => {
    const text = Array.from({ length: 50 }, (_, i) => `para ${i}\n\n`).join("");
    const chunks = chunkText(text, {
      idPrefix: "t",
      title: "t",
      source: "s",
      kind: "docs",
      maxChars: 80,
      overlap: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].id).toStartWith("t:");
    expect(chunks[0].kind).toBe("docs");
  });

  test("empty", () => {
    expect(
      chunkText("   ", {
        idPrefix: "t",
        title: "t",
        source: "s",
        kind: "docs",
      })
    ).toEqual([]);
  });
});
