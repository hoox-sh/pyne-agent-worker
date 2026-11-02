// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetIsolateSubagentFuse,
  createQuota,
  isolateSubagentInflight,
  maxSpecialistsFromEnv,
} from "../src/agent/subagents/quota";
import { createAgentTools } from "../src/agent/tools";
import { createOrchestratorTools } from "../src/agent/orchestrator";
import { toolsForRole } from "../src/agent/subagents/runner";

beforeEach(() => {
  _resetIsolateSubagentFuse();
});

describe("createQuota", () => {
  test("caps specialists and in-flight", () => {
    const q = createQuota({ maxSpecialists: 5, concurrency: 3 });
    const ok: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      ok.push(q.tryAcquire().ok);
    }
    // First 3 acquire (in-flight cap); 4th–6th fail while 3 in flight.
    expect(ok.filter(Boolean).length).toBe(3);
    expect(q.active).toBe(3);
    expect(q.inFlight).toBe(3);

    q.release();
    q.release();
    q.release();
    expect(q.inFlight).toBe(0);
    // Active slots remain; two more can start (up to 5 total).
    expect(q.tryAcquire().ok).toBe(true);
    expect(q.tryAcquire().ok).toBe(true);
    expect(q.tryAcquire().ok).toBe(false); // active == 5
    expect(q.active).toBe(5);
  });

  test("two quotas are independent (overlapping REST turns)", () => {
    const a = createQuota({ maxSpecialists: 5, concurrency: 3 });
    const b = createQuota({ maxSpecialists: 5, concurrency: 3 });
    expect(a.tryAcquire().ok).toBe(true);
    expect(a.tryAcquire().ok).toBe(true);
    expect(a.tryAcquire().ok).toBe(true);
    expect(b.tryAcquire().ok).toBe(true);
    expect(b.tryAcquire().ok).toBe(true);
    expect(b.tryAcquire().ok).toBe(true);
    expect(a.inFlight).toBe(3);
    expect(b.inFlight).toBe(3);
    expect(isolateSubagentInflight()).toBe(6);
  });

  test("isolate fuse skips without failing fairness of other quotas", () => {
    const a = createQuota({
      maxSpecialists: 5,
      concurrency: 3,
      isolateCap: 2,
    });
    const b = createQuota({
      maxSpecialists: 5,
      concurrency: 3,
      isolateCap: 2,
    });
    expect(a.tryAcquire().ok).toBe(true);
    expect(a.tryAcquire().ok).toBe(true);
    const fail = b.tryAcquire();
    expect(fail.ok).toBe(false);
    if (!fail.ok) {
      expect(fail.skipped).toBe(true);
      expect(fail.error).toMatch(/isolate busy/);
    }
  });
});

describe("maxSpecialistsFromEnv", () => {
  test("clamps request to MAX_SUBAGENTS-1", () => {
    expect(maxSpecialistsFromEnv({ MAX_SUBAGENTS: "6" } as Env, 9)).toBe(5);
    expect(maxSpecialistsFromEnv({ MAX_SUBAGENTS: "6" } as Env, 0)).toBe(0);
    expect(maxSpecialistsFromEnv({ MAX_SUBAGENTS: "4" } as Env)).toBe(3);
  });
});

describe("tool catalogs", () => {
  test("FEATURE_SUBAGENTS off → no subagent_spawn", () => {
    const tools = createOrchestratorTools(
      { FEATURE_SUBAGENTS: "false" } as Env,
      { catalog: "full", allowSpawn: true }
    );
    expect(tools.allowSpawn).toBe(false);
    expect(tools.tools).not.toHaveProperty("subagent_spawn");
    expect(tools.tools).toHaveProperty("pyne_parse");
  });

  test("FEATURE_SUBAGENTS on → spawn attached with quota", () => {
    const tools = createOrchestratorTools(
      { FEATURE_SUBAGENTS: "true" } as Env,
      { catalog: "full", allowSpawn: true, maxSubagents: 5 }
    );
    expect(tools.allowSpawn).toBe(true);
    expect(tools.quota).toBeTruthy();
    expect(tools.tools).toHaveProperty("subagent_spawn");
  });

  test("axis catalog has no pyne_* or spawn", () => {
    const tools = createAgentTools({ FEATURE_SUBAGENTS: "true" } as Env, {
      catalog: "axis",
      allowSpawn: true,
      quota: createQuota({ maxSpecialists: 5, concurrency: 3 }),
    });
    expect(tools).toHaveProperty("axis_chart_load");
    expect(tools).not.toHaveProperty("pyne_parse");
    expect(tools).not.toHaveProperty("subagent_spawn");
  });

  test("specialist axis role omits axis_control", () => {
    const tools = toolsForRole({} as Env, "axis");
    expect(tools).toHaveProperty("axis_run_pine");
    expect(tools).not.toHaveProperty("axis_control");
    expect(tools).not.toHaveProperty("subagent_spawn");
  });
});
