// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cfg,
  deliverScript,
  describeChatError,
  explainEndpoint,
  looksLikePine,
  parseReplySegments,
  presentReply,
  scriptNameFromPine,
  stripValidationNotes,
} from "../plugin/axis-pine-agent.js";

const pluginPath = join(import.meta.dir, "..", "plugin", "axis-pine-agent.js");

describe("plugin contract", () => {
  test("live getConfig wins over the mount snapshot", () => {
    const src = readFileSync(pluginPath, "utf8");
    expect(src).toContain("cfg({ ...(config || {}), ...(api?.getConfig?.() || {}) })");
    expect(src).toContain("bootstrapFloating(ctx)");
    expect(src).toContain("api?.getConfig?.() || {}");
    expect(src).toContain('version: "0.1.7"');
    expect(src).toContain('const PLUGIN_UI_VERSION = "0.1.7"');
  });
});

describe("cfg", () => {
  test("trims, drops a trailing slash, and keeps https", () => {
    expect(cfg({ endpoint: "  https://agent.example/  ", apiKey: "  k  " })).toEqual({
      endpoint: "https://agent.example",
      apiKey: "k",
      pineVersion: "auto",
      style: "auto",
      persona: "auto",
    });
  });

  test("live fields override the snapshot", () => {
    const snapshot = { endpoint: "https://old.example", persona: "pine", apiKey: "old" };
    const live = { endpoint: "https://new.example/", persona: "axis" };
    expect(cfg({ ...snapshot, ...live }).endpoint).toBe("https://new.example");
    expect(cfg({ ...snapshot, ...live }).persona).toBe("axis");
    expect(cfg({ ...snapshot, ...live }).apiKey).toBe("old");
  });

  test("rejects a non-http endpoint", () => {
    expect(cfg({ endpoint: "ftp://agent.example" }).endpoint).toBe("");
    expect(cfg({ endpoint: "javascript:alert(1)" }).endpoint).toBe("");
    expect(cfg({ endpoint: "  " }).endpoint).toBe("");
    expect(cfg({ endpoint: "/v1/chat" }).endpoint).toBe("");
  });

  test("explainEndpoint distinguishes missing from a bad scheme", () => {
    expect(explainEndpoint("")).toContain("endpoint");
    expect(explainEndpoint("notaurl")).toContain("http");
    expect(explainEndpoint("https://agent.example")).toContain("endpoint");
  });
});

describe("replies", () => {
  test("parseReplySegments keeps prose and a pine fence", () => {
    const parts = parseReplySegments("Use this.\n```pine\n//@version=6\nindicator('x')\n```\nDone.");
    expect(parts.map((p) => p.type)).toEqual(["text", "code", "text"]);
    expect(parts[1]?.code).toContain("indicator('x')");
    expect(looksLikePine(parts[1]?.code, parts[1]?.lang)).toBe(true);
  });

  test("stripValidationNotes removes the worker footnote", () => {
    const raw = "Here is the script.\n\n_Validation: validated OK on PYNE after 1 attempt(s)._";
    expect(stripValidationNotes(raw)).toBe("Here is the script.");
  });

  test("presentReply reports failure once, in plain text", () => {
    const raw = "Try this.\n\n_Validation: still failing PYNE after 2 attempt(s): line 4._";
    const shown = presentReply(raw, {
      available: true,
      skipped: false,
      validated: false,
      last: { error: "line 4" },
    });
    expect(shown.status).toBe("validation failed");
    expect(shown.text).toContain("Validation failed: line 4");
    expect(shown.text).not.toContain("_Validation");
    expect(shown.text.match(/line 4/g)?.length).toBe(1);
  });

  test("presentReply stays quiet when validation was skipped", () => {
    const shown = presentReply("Hello.\n\n_Note: pyne-worker not configured._", {
      available: false,
      skipped: true,
      validated: false,
    });
    expect(shown.status).toBe("");
    expect(shown.text).toBe("Hello.");
  });

  test("a misconfigured backend note stays visible without underscores", () => {
    const shown = presentReply("Hello.\n\n_Note: AXIS MCP rejected the run._", {
      available: true,
      skipped: true,
      validated: false,
    });
    expect(shown.text).toBe("Hello.\n\nAXIS MCP rejected the run");
    expect(shown.text).not.toContain("_");
  });

  test("validated status drops the footnote", () => {
    const shown = presentReply("Done.\n\n_Validation: validated OK on PYNE after 1 attempt(s)._", {
      available: true,
      skipped: false,
      validated: true,
    });
    expect(shown).toEqual({ text: "Done.", status: "validated", detail: "" });
  });
});

describe("editor delivery", () => {
  test("host insertScript wins and does not need a DOM editor", () => {
    let got = "";
    const result = deliverScript(
      "insert",
      "indicator('RSI')",
      {
        insertScript(code) {
          got = code;
        },
      },
      "RSI"
    );
    expect(result).toBe("inserted");
    expect(got).toContain("indicator('RSI')");
  });

  test("missing editor is a failure, not a fake insert", () => {
    expect(() => deliverScript("open", "//@version=6\nindicator('x')", {})).toThrow(/editor/);
  });

  test("scriptNameFromPine reads a string title and falls back", () => {
    expect(scriptNameFromPine("indicator('Gap fill')")).toBe("Gap fill");
    expect(scriptNameFromPine("plot(close)")).toBe("Agent script");
  });
});

describe("chat errors", () => {
  test("session not found is recoverable copy, not the raw code", () => {
    const info = describeChatError(new Error("session not found"));
    expect(info.kind).toBe("session");
    expect(info.text.toLowerCase()).toContain("session expired");
  });

  test("a fetch TypeError is a reachability hint", () => {
    const info = describeChatError(new TypeError("Failed to fetch"));
    expect(info.kind).toBe("network");
    expect(info.text).toContain("endpoint");
  });

  test("abort is a timeout", () => {
    const info = describeChatError(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(info.kind).toBe("timeout");
    expect(info.status).toBe("timed out");
  });
});
