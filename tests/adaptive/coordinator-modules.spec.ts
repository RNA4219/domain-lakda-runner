import { expect, test } from "@playwright/test";
import { runAdaptiveExplore as facadeRunAdaptiveExplore } from "../../src/adaptive/coordinator.js";
import { runAdaptiveExplore as orchestratedRunAdaptiveExplore } from "../../src/adaptive/coordinator/orchestrator.js";
import { executionFailureCategory } from "../../src/adaptive/coordinator/recovery.js";
import { seededRandom } from "../../src/adaptive/coordinator/selection.js";
import { isSafeForShrinking, type ShrinkStep } from "../../src/adaptive/coordinator/shrinking.js";
import type { ActionCandidate } from "../../src/adaptive/contracts.js";

function candidate(mutationKind: ActionCandidate["mutationKind"]): ActionCandidate {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1",
    candidateId: "candidate-a",
    adapterId: "playwright",
    targetRef: { targetId: "page-1", kind: "page" },
    sourceFingerprint: "state:a",
    actionKind: "click",
    locatorRecipe: { strategy: "test-id", value: "next" },
    generatedBy: { ruleId: "visible-enabled", observationId: "observation-a", reason: "visible" },
    risk: { weight: 1 },
    mutationKind,
  };
}

test("coordinator facade keeps the existing runAdaptiveExplore import path", () => {
  expect(facadeRunAdaptiveExplore).toBe(orchestratedRunAdaptiveExplore);
});

test("selection module preserves deterministic seed draws", () => {
  const left = seededRandom(42);
  const right = seededRandom(42);
  expect(Array.from({ length: 8 }, () => left())).toEqual(Array.from({ length: 8 }, () => right()));
  expect(seededRandom(43)()).not.toBe(seededRandom(42)());
});

test("recovery and shrinking modules remain fail-closed at their responsibility boundaries", () => {
  expect(executionFailureCategory("timeout")).toBe("timeout");
  expect(executionFailureCategory("unexpected")).toBe("infrastructure_error");
  const safe: ShrinkStep = { id: "step-1", candidate: candidate("none"), expectedStatus: "timeout" };
  const mutating: ShrinkStep = { id: "step-2", candidate: candidate("update"), expectedStatus: "action_failed" };
  expect(isSafeForShrinking([safe])).toBe(true);
  expect(isSafeForShrinking([safe, mutating])).toBe(false);
});
