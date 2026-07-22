import { chromium, type BrowserContext } from "playwright";
import { assertBuiltInAdapterCapabilities, createBuiltInAdapter } from "../../adapters/registry.js";
import type { LakdaConfig } from "../../core/types.js";
import { sha256 } from "../../core/redaction.js";
import type { ActionCandidate, ExecutionResult } from "../contracts.js";
import { shrinkFailure } from "../input.js";

export type ShrinkStep = {
  id: string;
  candidate: ActionCandidate;
  expectedStatus: Exclude<ExecutionResult["status"], "executed">;
};

export function isSafeForShrinking(steps: ShrinkStep[]): boolean {
  return steps.length > 0 && steps.every(step => step.candidate.mutationKind === "none" && ["click", "check"].includes(step.candidate.actionKind));
}

async function replayFailureForShrink(config: LakdaConfig, steps: ShrinkStep[], failure: ShrinkStep): Promise<{ reproduced: boolean; signature?: string }> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: !config.headed });
    context = await browser.newContext();
    const page = await context.newPage();
    const instance = createBuiltInAdapter("playwright", { kind: "playwright", options: {
      page,
      context,
      scopeHosts: config.safety.allowHosts,
      scopePathPrefixes: config.safety.pathPrefixes,
      actionContracts: config.adaptive!.actionContracts,
      settlePolicy: config.adaptive!.settlePolicy,
    } });
    if (instance.id !== "playwright") throw new Error("built-in adapter registry identity mismatch");
    assertBuiltInAdapterCapabilities(instance, config.adaptive!.safety.allowTargetKinds);
    const adapter = instance.adapter;
    await page.goto(config.baseUrl!, { waitUntil: "domcontentloaded", timeout: Math.min(30_000, config.durationMs) });
    for (const step of steps) {
      let resolved: ActionCandidate | undefined;
      for (const target of adapter.activeTargets()) {
        const observation = await adapter.observe(target, { runId: "shrink-replay", personaRef: config.persona, scopeHosts: config.safety.allowHosts });
        resolved = (await adapter.generateCandidates(observation)).find(candidate => candidate.candidateId === step.candidate.candidateId);
        if (resolved) break;
      }
      if (!resolved) return { reproduced: false };
      const result = await adapter.execute(resolved, { runId: "shrink-replay", personaRef: config.persona, timeoutMs: config.adaptive!.settlePolicy.maxWaitMs });
      if (result.status !== "executed") {
        return { reproduced: result.status === failure.expectedStatus, signature: result.failureSignature ?? result.status };
      }
    }
    return { reproduced: false };
  } catch {
    return { reproduced: false };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export async function shrinkAdaptiveFailure(
  config: LakdaConfig,
  trace: Array<Record<string, unknown>>,
  steps: ShrinkStep[],
  failure: ShrinkStep,
): Promise<Record<string, unknown>> {
  const parentTraceSha256 = sha256(JSON.stringify(trace));
  if (!isSafeForShrinking(steps)) {
    return { status: "skipped", reason: "unsafe-or-mutating-sequence", algorithmVersion: "delta-debug/1", parentTraceSha256, originalStepCount: steps.length };
  }
  let attempts = 0;
  let finalFailureSignature: string | undefined;
  const reduced = await shrinkFailure(steps, async candidate => {
    attempts += 1;
    const replay = await replayFailureForShrink(config, candidate, failure);
    if (replay.reproduced) finalFailureSignature = replay.signature;
    return replay.reproduced;
  });
  return {
    status: reduced.length < steps.length ? "shrunk" : "not_reduced",
    reason: reduced.length < steps.length ? "status-equivalent-failure-reproduced" : "no-smaller-reproducing-subsequence",
    algorithmVersion: "delta-debug/1",
    parentTraceSha256,
    comparison: "execution-status/v1",
    attempts,
    originalStepCount: steps.length,
    reducedStepCount: reduced.length,
    originalFailureSignature: failure.expectedStatus,
    finalFailureSignature: finalFailureSignature ?? failure.expectedStatus,
    derivedCandidateIds: reduced.map(step => step.candidate.candidateId),
  };
}
