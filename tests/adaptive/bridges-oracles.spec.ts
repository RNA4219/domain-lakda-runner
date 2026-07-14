import { expect, test } from "@playwright/test";
import { AirtestPocoAdapter, SecurityAdapter, type ExternalToolBridge } from "../../src/adapters/external-bridges.js";
import { genericOracle } from "../../src/adaptive/oracles.js";
import type { ExecutionResult } from "../../src/adaptive/contracts.js";

const bridge: ExternalToolBridge = {
  capabilities: () => ({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "bridge", revision: "1", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen"], evidenceCapabilities: [], recoveryStrategies: [] }),
  observe: async () => { throw new Error("not used"); }, generateCandidates: async () => [], execute: async () => { throw new Error("not used"); },
  recover: async () => ({ recovered: false, strategy: "none", evidenceRefs: [] }), captureEvidence: async () => [],
};
function execution(status: ExecutionResult["status"]): ExecutionResult {
  return { schemaVersion: "lakda/adaptive-contracts/v1", executionId: "exec-1", candidateId: "candidate-1", preFingerprint: "state:one", startedAt: "2026-07-14T00:00:00Z", endedAt: "2026-07-14T00:00:01Z", status, recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] };
}
test("external tool bridges expose public contracts under their Lakda adapter identities", () => {
  expect(new AirtestPocoAdapter(bridge).capabilities().adapterId).toBe("airtest-poco");
  expect(new SecurityAdapter(bridge).capabilities().adapterId).toBe("security");
});
test("generic oracle is separate from product rules and reports execution failure", () => {
  expect(genericOracle(execution("executed")).verdict).toBe("pass");
  expect(genericOracle(execution("timeout")).oracleClass).toBe("generic");
  expect(genericOracle(execution("timeout")).verdict).toBe("fail");
});
