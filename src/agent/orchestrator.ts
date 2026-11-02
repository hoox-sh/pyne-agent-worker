// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Orchestrator tool wiring for SDK + REST `orchestrate: true`.
 * Builds a per-request quota and the full tool catalog (optional spawn).
 */

import { featureSubagents } from "../ai/routing";
import { createAgentTools, type AgentToolsCatalog } from "./tools";
import {
  concurrencyFromEnv,
  createQuota,
  maxSpecialistsFromEnv,
  type SpecialistQuota,
} from "./subagents/quota";

export type OrchestratorBundle = {
  tools: ReturnType<typeof createAgentTools>;
  quota: SpecialistQuota | null;
  catalog: AgentToolsCatalog;
  allowSpawn: boolean;
};

export function createOrchestratorTools(
  env: Env,
  opts?: {
    catalog?: AgentToolsCatalog;
    /** Max specialists this turn (0..5). */
    maxSubagents?: number;
    /** Force spawn off even if FEATURE_SUBAGENTS. */
    allowSpawn?: boolean;
  }
): OrchestratorBundle {
  const catalog = opts?.catalog ?? "full";
  const allowSpawn =
    catalog === "full" &&
    opts?.allowSpawn !== false &&
    featureSubagents(env);

  const quota = allowSpawn
    ? createQuota({
        maxSpecialists: maxSpecialistsFromEnv(env, opts?.maxSubagents),
        concurrency: concurrencyFromEnv(env),
      })
    : null;

  return {
    catalog,
    allowSpawn,
    quota,
    tools: createAgentTools(env, {
      catalog,
      allowSpawn,
      quota: quota ?? undefined,
    }),
  };
}
