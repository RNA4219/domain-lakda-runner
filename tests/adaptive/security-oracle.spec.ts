import { expect, test } from "@playwright/test";
import type { ActionCandidate, ExecutionResult } from "../../src/adaptive/contracts.js";
import { securityOracle } from "../../src/adaptive/security-oracle.js";

const candidate: ActionCandidate = {
  schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "zap-alert-40012", adapterId: "security",
  targetRef: { targetId: "http-1", kind: "http", origin: "http://127.0.0.1/safe" }, sourceFingerprint: "state:zap",
  actionKind: "zap-alert", locatorRecipe: { strategy: "request", value: "alert:40012" },
  generatedBy: { ruleId: "zap-alert", observationId: "zap-observation", reason: "scanner-alert" },
  risk: { weight: 10, businessPriority: "P0" }, mutationKind: "none",
  contract: {
    requirementRefs: ["REQ-SECX-007"],
    ensures: {
      zapAlert: {
        alertId: "40012", pluginId: "40012", confidence: "high", risk: "high",
        requestRef: "request:redacted", responseRef: "response:redacted", discoveryState: "state:zap",
      },
    },
  },
};
const result: ExecutionResult = {
  schemaVersion: "lakda/adaptive-contracts/v1", executionId: "zap-execution", candidateId: candidate.candidateId,
  preFingerprint: "state:zap", postFingerprint: "state:zap", startedAt: "2026-07-15T00:00:00Z", endedAt: "2026-07-15T00:00:01Z",
  status: "executed", recoveryStatus: "not_required", targetChanges: [],
  settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [],
};

test("a ZAP alert remains a security candidate even when its scanner risk is high", () => {
  const oracle = securityOracle(candidate, result);
  expect(oracle).toMatchObject({
    oracleClass: "security", verdict: "candidate", severity: "critical", requirementRefs: ["REQ-SECX-007"],
  });
  expect(oracle?.sourceRefs).toEqual(expect.arrayContaining(["zap-alert:40012", "zap-plugin:40012", "request:redacted", "response:redacted", "state:zap"]));
  expect(oracle?.verdict).not.toBe("confirmed");
});

test("non-ZAP actions are not reclassified by the security oracle", () => {
  expect(securityOracle({ ...candidate, actionKind: "parameter-mutation" }, result)).toBeUndefined();
});
