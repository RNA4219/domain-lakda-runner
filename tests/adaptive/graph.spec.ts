import { expect, test } from "@playwright/test";
import { StateGraph } from "../../src/adaptive/graph.js";
import type { ActionCandidate, ExecutionResult } from "../../src/adaptive/contracts.js";

function candidate(id: string, sourceFingerprint: string): ActionCandidate {
  return { schemaVersion: "lakda/adaptive-contracts/v1", candidateId: id, adapterId: "playwright", targetRef: { targetId: "page-1", kind: "page" }, sourceFingerprint, actionKind: "click", locatorRecipe: { strategy: "test-id", value: id }, generatedBy: { ruleId: "test", observationId: "obs", reason: "test" }, risk: { weight: 1 }, mutationKind: "none" };
}
function result(candidateId: string, preFingerprint: string, postFingerprint: string): ExecutionResult {
  return { schemaVersion: "lakda/adaptive-contracts/v1", executionId: `exec-${candidateId}`, candidateId, preFingerprint, postFingerprint, startedAt: "2026-07-15T00:00:00Z", endedAt: "2026-07-15T00:00:01Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] };
}
test("state graph reports transition pairs and round trips separately from action coverage", () => {
  const graph = new StateGraph(); const forward = candidate("forward", "state:one"); const back = candidate("back", "state:two");
  graph.recordOffered([forward, back]);
  graph.recordTransition("state:one", forward, result("forward", "state:one", "state:two"), "state:two", 1);
  graph.recordTransition("state:two", back, result("back", "state:two", "state:one"), "state:one", 2);
  const coverage = graph.coverage();
  expect(coverage.transitionPairCount).toBe(1);
  expect(coverage.roundTripCount).toBe(2);
  expect(coverage.transitionPairCoverage).toBe(1);
  expect(coverage.roundTripCoverage).toBe(1);
  expect(graph.snapshot().transitionPairs).toHaveLength(1);
});
