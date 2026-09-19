// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  detectPersona,
  listPersonas,
  looksActionable,
  normalizePersona,
  personaSystemSection,
} from "../src/agent/personas";

describe("normalizePersona", () => {
  test("accepts known ids, falls back to auto", () => {
    expect(normalizePersona("axis")).toBe("axis");
    expect(normalizePersona("TRADER")).toBe("trader");
    expect(normalizePersona("evil")).toBe("auto");
    expect(normalizePersona(undefined)).toBe("auto");
  });

  test("catalog lists three stances", () => {
    expect(listPersonas().map((p) => p.id).sort()).toEqual(["axis", "pine", "trader"]);
  });
});

describe("detectPersona", () => {
  test("explicit selection always wins", () => {
    expect(detectPersona("write an rsi indicator", "trader")).toBe("trader");
    expect(detectPersona("change the theme", "pine")).toBe("pine");
  });

  test("app talk → axis", () => {
    expect(detectPersona("how do I change the chart theme in AXIS")).toBe("axis");
    expect(detectPersona("where is the settings button")).toBe("axis");
    expect(detectPersona("switch to dark mode")).toBe("axis");
  });

  test("trading desk talk → trader", () => {
    expect(detectPersona("should I buy BTC here")).toBe("trader");
    expect(detectPersona("analyze the market regime")).toBe("trader");
    expect(detectPersona("how do I size positions by risk")).toBe("trader");
  });

  test("code shape → pine", () => {
    expect(detectPersona("write an ema crossover indicator")).toBe("pine");
    expect(detectPersona("v6 RSI strategy with ATR trailing stop")).toBe("pine");
  });

  test("chit-chat and empty default to pine", () => {
    expect(detectPersona("hi")).toBe("pine");
    expect(detectPersona("")).toBe("pine");
  });
});

describe("looksActionable", () => {
  test("axis persona + verb acts", () => {
    expect(looksActionable("change the theme to dark", "axis")).toBe(true);
    expect(looksActionable("load BTC on the 1h chart", "axis")).toBe(true);
  });

  test("prose without verbs never acts", () => {
    expect(looksActionable("what is RSI", "axis")).toBe(false);
    expect(looksActionable("hi", "axis")).toBe(false);
  });

  test("unspecified persona needs app-aimed verbs", () => {
    expect(looksActionable("set the chart theme to void dark", "auto")).toBe(true);
    expect(looksActionable("run the numbers for me", "auto")).toBe(false);
  });
});

describe("personaSystemSection", () => {
  test("axis composes control + operator policy", () => {
    const s = personaSystemSection("axis");
    expect(s).toContain("Active persona");
    expect(s).toContain("operator policy");
    expect(s).toContain("AXIS control");
  });

  test("trader composes desk + control, no code craft wall", () => {
    const s = personaSystemSection("trader");
    expect(s).toContain("Trader desk");
    expect(s).toContain("invalidation");
  });

  test("pine keeps craft + control", () => {
    const s = personaSystemSection("pine");
    expect(s).toContain("Trading craft");
    expect(s).toContain("AXIS control");
  });
});
