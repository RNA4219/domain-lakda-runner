import { expect, test } from "@playwright/test";
import { AirtestPocoAdapter, SecurityAdapter, type ExternalToolBridge } from "../../src/adapters/external-bridges.js";
import { evaluateActionGuard, evaluateActionPostconditions, genericOracle } from "../../src/adaptive/oracles.js";
import type { ActionCandidate, ExecutionResult, Observation } from "../../src/adaptive/contracts.js";

const bridge: ExternalToolBridge = {
  capabilities: () => ({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "bridge", revision: "1", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen"], evidenceCapabilities: [], recoveryStrategies: [] }),
  observe: async () => { throw new Error("not used"); }, generateCandidates: async () => [], execute: async () => { throw new Error("not used"); },
  recover: async () => ({ recovered: false, strategy: "none", evidenceRefs: [] }), captureEvidence: async () => [],
};
function execution(status: ExecutionResult["status"]): ExecutionResult {
  return { schemaVersion: "lakda/adaptive-contracts/v1", executionId: "exec-1", candidateId: "candidate-1", preFingerprint: "state:one", startedAt: "2026-07-14T00:00:00Z", endedAt: "2026-07-14T00:00:01Z", status, recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] };
}
function observation(id: string, state: string, authenticated = true): Observation {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", observationId: id, observedAt: "2026-07-15T00:00:00Z",
    targetRef: { targetId: "page-1", kind: "page", origin: "https://example.test" }, completeness: "complete",
    url: `https://example.test/${state}`, personaRef: "member", ui: { state, authenticated, dataBoundary: "tenant-a", primaryElements: [{ testId: "submit", name: "Submit" }] },
    forms: [], dialogs: [], topology: { activeTargetId: "page-1" }, obligations: { checkout: state === "complete" ? "met" : "unmet" },
    provenance: { adapterId: "playwright", runtime: "playwright", capabilityRevision: "v1" },
  };
}
function candidate(contract?: ActionCandidate["contract"]): ActionCandidate {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "candidate-1", adapterId: "playwright",
    targetRef: { targetId: "page-1", kind: "page" }, sourceFingerprint: "state:one", actionKind: "click",
    locatorRecipe: { strategy: "test-id", value: "submit" }, generatedBy: { ruleId: "dom", observationId: "before", reason: "visible-enabled" },
    risk: { weight: 1 }, mutationKind: "none", ...(contract ? { contract } : {}),
  };
}
test("external tool bridges expose public contracts under their Lakda adapter identities", () => {
  expect(new AirtestPocoAdapter(bridge).capabilities().adapterId).toBe("airtest-poco");
  expect(new SecurityAdapter(bridge).capabilities().adapterId).toBe("security");
});
test("generic oracle is separate from product rules and reports common runtime failures", () => {
  const before = observation("before-runtime", "ready");
  before.ui.events = [];
  const after = observation("after-runtime", "ready");
  after.ui.events = [
    { eventId: "event-1", kind: "console-error", targetId: "page-1" },
    { eventId: "event-2", kind: "pageerror", targetId: "page-1" },
    { eventId: "event-3", kind: "http-error", targetId: "page-1", status: 500 },
  ];
  expect(genericOracle(execution("executed")).verdict).toBe("pass");
  expect(genericOracle(execution("timeout")).oracleClass).toBe("generic");
  expect(genericOracle(execution("timeout")).verdict).toBe("fail");
  expect(genericOracle(execution("executed"), before, after)).toMatchObject({
    oracleClass: "generic",
    verdict: "fail",
    message: "generic-failure:console-error,http-error,pageerror",
  });
  expect(genericOracle(execution("executed"), before, observation("auth-lost", "ready", false))).toMatchObject({
    verdict: "fail",
    message: "generic-failure:authentication-lost",
  });
  const artifactFailure = execution("executed");
  artifactFailure.evidenceRefs = [{
    schemaVersion: "lakda/adaptive-contracts/v1", artifactId: "artifact-1", path: "adaptive/event.json", sha256: "a".repeat(64), size: 1,
    classification: "internal", redactionStatus: "redacted", securityStatus: "fail",
  }];
  expect(genericOracle(artifactFailure)).toMatchObject({ verdict: "fail", message: "generic-failure:artifact-security-failure" });
});

test("ActionContract guard fails closed and postconditions stay separate from execution", () => {
  const before = observation("before", "ready");
  const after = observation("after", "complete");
  const action = candidate({
    enabledWhen: { urlPattern: "/ready$", state: "ready", visible: ["submit"], persona: "member", authenticated: true, host: "example.test" },
    ensures: { state: "complete", obligations: { checkout: "met" } },
    invariants: { persona: "member", authenticated: true, host: "example.test", dataBoundary: "tenant-a" },
    requirementRefs: ["REQ-ACT-007", "REQ-ACT-008", "REQ-ACT-009"],
  });
  expect(evaluateActionGuard(action, before).allowed).toBe(true);
  expect(evaluateActionGuard(action, observation("wrong", "other")).allowed).toBe(false);
  expect(evaluateActionGuard(candidate({ enabledWhen: { unknownClause: true } }), before)).toMatchObject({ allowed: false, result: { verdict: "inconclusive", message: "guard-unsupported:unknownClause" } });
  const results = evaluateActionPostconditions(action, before, after, execution("executed"));
  expect(results.map(result => [result.message, result.verdict])).toEqual([["postcondition-satisfied", "pass"], ["invariant-satisfied", "pass"]]);
  expect(evaluateActionPostconditions(action, before, observation("changed", "complete", false), execution("executed"))[1]).toMatchObject({ verdict: "fail", message: "invariant-mismatch:authenticated" });
  expect(evaluateActionPostconditions(candidate(), before, after, execution("executed"))[0]).toMatchObject({ verdict: "inconclusive", message: "product-contract-undefined" });
});
