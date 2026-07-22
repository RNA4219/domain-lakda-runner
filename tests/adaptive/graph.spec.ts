import { expect, test } from "@playwright/test";
import { StateGraph } from "../../src/adaptive/graph.js";
import { selectAdaptiveGenerator } from "../../src/adaptive/generators.js";
import type { ActionCandidate, ExecutionResult, OracleResult } from "../../src/adaptive/contracts.js";

function candidate(id: string, sourceFingerprint: string, weight = 1): ActionCandidate {
  return { schemaVersion: "lakda/adaptive-contracts/v1", candidateId: id, adapterId: "playwright", targetRef: { targetId: "page-1", kind: "page" }, sourceFingerprint, actionKind: "click", locatorRecipe: { strategy: "test-id", value: id }, generatedBy: { ruleId: "test", observationId: "obs", reason: "test" }, risk: { weight }, mutationKind: "none" };
}
function result(candidateId: string, preFingerprint: string, postFingerprint: string): ExecutionResult {
  return { schemaVersion: "lakda/adaptive-contracts/v1", executionId: `exec-${candidateId}`, candidateId, preFingerprint, postFingerprint, startedAt: "2026-07-15T00:00:00Z", endedAt: "2026-07-15T00:00:01Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] };
}
function oracle(oracleId: string, oracleClass: OracleResult["oracleClass"]): OracleResult {
  return { schemaVersion: "lakda/adaptive-contracts/v1", oracleId, oracleClass, verdict: "pass", severity: "info", sourceRefs: [], requirementRefs: [], evidenceRefs: [], message: "ok" };
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
  graph.recordOracleResults("state:one", action.candidateId, "state:two", [oracle("product-2", "product"), oracle("generic-1", "generic"), oracle("product-2", "product")]);
  graph.recordTransition("state:one", action, result("open", "state:one", "state:alternate"), "state:alternate", 2);

  const coverage = graph.coverage();
  expect(coverage.model).toBe("discovered-model");
  expect(coverage.openWorld).toBe(true);
  expect(coverage.transition).toEqual({ numerator: 1, denominator: 1, ratio: 1 });
  expect(coverage.transitionCoverage).toBeLessThanOrEqual(1);
  expect(coverage.graphRevision).toBeGreaterThan(0);
  expect(graph.coverageTimeline()).toHaveLength(2);
  expect(graph.snapshot().revision).toBe(coverage.graphRevision);
  expect(graph.snapshot().edges.find(edge => edge.to === "state:two")?.oracleRefs).toEqual(["generic-1", "product-2"]);
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


test("graph separates action, timeout, and backtrack control transitions", () => {
  const graph = new StateGraph();
  const action = candidate("open", "state:one");
  graph.recordOffered([action], 0);
  const timedOut = { ...result("open", "state:one", "state:two"), status: "timeout" as const, failureSignature: "settle-timeout" };
  graph.recordTransition("state:one", action, timedOut, "state:two", 1);
  graph.recordTransition("state:one", action, result("open", "state:one", "state:two"), "state:two", 2);
  graph.recordControlTransition({
    from: "state:two",
    candidateId: "recovery:browser-back:open",
    to: "state:one",
    edgeKind: "backtrack",
    status: "recovered",
    actionIndex: 3,
  });

  const edges = graph.snapshot().edges;
  expect(edges.filter(edge => edge.from === "state:one" && edge.candidateId === "open").map(edge => edge.edgeKind).sort()).toEqual(["action", "timeout"]);
  expect(edges.find(edge => edge.edgeKind === "timeout")?.failureSignatures).toEqual(["settle-timeout"]);
  expect(edges.find(edge => edge.edgeKind === "backtrack")).toMatchObject({ from: "state:two", to: "state:one", statuses: { recovered: 1 } });
  expect(graph.coverage().action).toEqual({ numerator: 1, denominator: 1, ratio: 1 });
});

test("weighted-random uses one cumulative seeded draw over stable candidate order", async () => {
  const graph = new StateGraph();
  const candidates = [candidate("a", "state:one", 1), candidate("b", "state:one", 3)];
  let calls = 0;
  const first = await selectAdaptiveGenerator("weighted-random", { candidates, graph, random: () => { calls += 1; return 0.2; } });
  expect(first.kind === "candidate" ? first.candidate.candidateId : undefined).toBe("a");
  expect(calls).toBe(1);
  const second = await selectAdaptiveGenerator("weighted-random", { candidates, graph, random: () => 0.25 });
  expect(second.kind === "candidate" ? second.candidate.candidateId : undefined).toBe("b");
  const reversed = await selectAdaptiveGenerator("weighted-random", { candidates: [...candidates].reverse(), graph, random: () => 0.2 });
  expect(reversed.kind === "candidate" ? reversed.candidate.candidateId : undefined).toBe("a");
});