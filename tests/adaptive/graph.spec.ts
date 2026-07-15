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
  expect(coverage.transitionPairCoverage).toBe(0.5);
  expect(coverage.transitionPair).toEqual({ numerator: 1, denominator: 2, ratio: 0.5 });
  expect(coverage.roundTripCoverage).toBe(1);
  expect(graph.snapshot().transitionPairs).toHaveLength(1);
});


test("coverage exposes stable discovered-model denominators and revision history", () => {
  const graph = new StateGraph();
  const action = candidate("open", "state:one");
  graph.recordFingerprint("state:one", { search: "unmet" }, 0);
  graph.recordOffered([action], 0);
  graph.recordTransition("state:one", action, result("open", "state:one", "state:two"), "state:two", 1);
  graph.recordTransition("state:one", action, result("open", "state:one", "state:alternate"), "state:alternate", 2);

  const coverage = graph.coverage();
  expect(coverage.model).toBe("discovered-model");
  expect(coverage.openWorld).toBe(true);
  expect(coverage.transition).toEqual({ numerator: 1, denominator: 1, ratio: 1 });
  expect(coverage.transitionCoverage).toBeLessThanOrEqual(1);
  expect(coverage.graphRevision).toBeGreaterThan(0);
  expect(graph.coverageTimeline()).toHaveLength(2);
  expect(graph.snapshot().revision).toBe(coverage.graphRevision);
});

test("novel candidate and obligation changes reset the plateau window", () => {
  const graph = new StateGraph();
  graph.recordFingerprint("state:one", { search: "unmet" }, 0);
  const first = candidate("first", "state:one");
  graph.recordOffered([first], 0);
  expect(graph.stop({ any: [{ type: "noveltyPlateau", windowActions: 2, minActions: 0 }] }, 2, 0).stop).toBe(true);

  graph.recordOffered([candidate("new", "state:one")], 2);
  expect(graph.stop({ any: [{ type: "noveltyPlateau", windowActions: 2, minActions: 0 }] }, 2, 0).stop).toBe(false);
  graph.recordFingerprint("state:one", { search: "met" }, 4);
  expect(graph.stop({ any: [{ type: "noveltyPlateau", windowActions: 2, minActions: 0 }] }, 4, 0).stop).toBe(false);
});
