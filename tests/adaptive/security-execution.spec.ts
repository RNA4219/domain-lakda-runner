import { expect, test } from "@playwright/test";
import { loadConfig } from "../../src/core/config.js";
import type { ActionCandidate, ExecutionResult } from "../../src/adaptive/contracts.js";
import { KillSwitch } from "../../src/adaptive/safety.js";
import { SecurityExecutionController, type SecurityExecutionAdapter } from "../../src/adaptive/security-execution.js";

const target = { targetId: "security-target", kind: "http" as const, origin: "http://127.0.0.1/safe" };
function config() {
  return loadConfig(undefined, {
    baseUrl: "http://127.0.0.1:3000", outputDir: "artifacts", seed: 3, maxActions: 5, mode: "adaptive-explore",
    safety: { requireFixtureResetForMutations: false },
    adaptive: {
      schemaVersion: "lakda/adaptive-config/v1",
      adapter: { id: "security", endpoint: "http://127.0.0.1:9100", initialTarget: target },
      securityProfileRef: "security-profile",
      securityEnvironment: "staging",
      securityAuthorization: {
        schemaVersion: "lakda/security-authorization/v2",
        authorizationId: "auth-1", owner: "security", targets: { hosts: ["127.0.0.1"], pathPrefixes: ["/safe"], methods: ["GET"], requestTemplateDigests: ["sha256:" + "1".repeat(64)], targetRevision: "revision-1" },
        environment: "staging", validFrom: "2026-07-01T00:00:00Z", validUntil: "2026-08-01T00:00:00Z",
        allowedMutationKinds: ["parameter-mutation", "race"], maxRatePerMinute: 3, maxConcurrency: 2,
        cleanupRef: "cleanup-1", killSwitchRef: "kill-1", approvalEvidenceRef: "approval-1",
        dataPolicyRef: "data-policy-1", stopContactRef: "stop-contact-1",
        binding: { securityProfileDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), bridgeDigest: "sha256:" + "4".repeat(64) },
        signature: { algorithm: "ed25519", signedPayloadDigest: "sha256:" + "5".repeat(64), signatureRef: "signature-1" },
      },
      generator: { strategy: "least-visited-transition" }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
      settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 20 },
      fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
      recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
      safety: { allowTargetKinds: ["http"], denyActionIds: [], allowMutationKinds: ["none", "parameter-mutation", "race"] },
    },
  });
}
function candidate(kind: "parameter-mutation" | "race"): ActionCandidate {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", candidateId: kind, adapterId: "security", targetRef: target,
    sourceFingerprint: "state:security", actionKind: kind, locatorRecipe: { strategy: "request", value: "approved-request" },
    generatedBy: { ruleId: "fixture", observationId: "security-observation", reason: "authorized" },
    risk: { weight: 1 }, mutationKind: kind,
    contract: { ensures: { requestMethod: "GET", requestTemplateDigest: "sha256:" + "1".repeat(64), ...(kind === "race" ? { raceParticipants: 3 } : {}) } },
  };
}
function execution(candidateId: string): ExecutionResult {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", executionId: "execution-" + candidateId, candidateId,
    preFingerprint: "state:security", postFingerprint: "state:after", startedAt: "2026-07-15T00:00:00Z", endedAt: "2026-07-15T00:00:01Z",
    status: "executed", recoveryStatus: "not_required", targetChanges: [],
    settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [],
  };
}

test("race scheduler honors concurrency, stops queued participants after kill switch, and cleans up", async () => {
  let started = 0; let active = 0; let maxActive = 0; let cleanupCalls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter: SecurityExecutionAdapter = {
    checkKillSwitch: async () => ({ triggered: started >= 2, evidenceRefs: [] }),
    execute: async (action) => {
      started += 1; active += 1; maxActive = Math.max(maxActive, active);
      if (started === 2) release();
      await gate;
      active -= 1;
      return execution(action.candidateId);
    },
    cleanup: async () => { cleanupCalls += 1; return { completed: true, evidenceRefs: [] }; },
  };
  const controller = new SecurityExecutionController(config(), adapter, new KillSwitch(), "security-run");
  const result = await controller.execute(candidate("race"), { runId: "security-run", timeoutMs: 1_000 });

  expect(result.result.status).toBe("denied");
  expect(result.result.failureSignature).toBe("kill_switch");
  expect(started).toBe(2);
  expect(maxActive).toBe(2);
  expect(cleanupCalls).toBe(1);
  expect(result.trace.some(entry => entry.type === "race-participant-skipped" && entry.reason === "kill_switch")).toBe(true);
  expect(result.trace.some(entry => entry.type === "security-cleanup" && entry.completed === true)).toBe(true);
});

test("cleanup failure trips the kill switch and blocks a later active mutation", async () => {
  let executions = 0;
  const adapter: SecurityExecutionAdapter = {
    checkKillSwitch: async () => ({ triggered: false, evidenceRefs: [] }),
    execute: async action => { executions += 1; return execution(action.candidateId); },
    cleanup: async () => ({ completed: false, evidenceRefs: [] }),
  };
  const controller = new SecurityExecutionController(config(), adapter, new KillSwitch(), "security-run");
  const result = await controller.execute(candidate("parameter-mutation"), { runId: "security-run", timeoutMs: 1_000 });

  expect(result.result.status).toBe("action_failed");
  expect(result.result.failureSignature).toBe("cleanup_failed");
  await expect(controller.denyReason(candidate("parameter-mutation"))).resolves.toBe("kill_switch");
  expect(executions).toBe(1);
});

test("adapter execution error still records cleanup before returning an infrastructure failure", async () => {
  let cleanupCalls = 0;
  const adapter: SecurityExecutionAdapter = {
    checkKillSwitch: async () => ({ triggered: false, evidenceRefs: [] }),
    execute: async () => { throw new Error("bridge failure"); },
    cleanup: async () => { cleanupCalls += 1; return { completed: true, evidenceRefs: [] }; },
  };
  const controller = new SecurityExecutionController(config(), adapter, new KillSwitch(), "security-run");
  const result = await controller.execute(candidate("parameter-mutation"), { runId: "security-run", timeoutMs: 1_000 });

  expect(result.result.status).toBe("infrastructure_error");
  expect(result.result.failureSignature).toBe("security_execution_failed");
  expect(cleanupCalls).toBe(1);
});

test("passive security candidates still require authorization scope and kill-switch checks", async () => {
  let controlChecks = 0;
  let executions = 0;
  const adapter: SecurityExecutionAdapter = {
    checkKillSwitch: async () => { controlChecks += 1; return { triggered: false, evidenceRefs: [] }; },
    execute: async action => { executions += 1; return execution(action.candidateId); },
    cleanup: async () => ({ completed: true, evidenceRefs: [] }),
  };
  const controller = new SecurityExecutionController(config(), adapter, new KillSwitch(), "security-run");
  const passive: ActionCandidate = {
    ...candidate("parameter-mutation"),
    candidateId: "passive-outside-scope",
    mutationKind: "none",
    targetRef: { ...target, origin: "http://127.0.0.1/outside" },
  };

  await expect(controller.denyReason(passive)).resolves.toBe("scope_denied");
  const result = await controller.execute(passive, { runId: "security-run", timeoutMs: 1_000 });
  expect(result.result.status).toBe("denied");
  expect(executions).toBe(0);
  expect(controlChecks).toBe(2);
});
