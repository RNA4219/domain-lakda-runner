import { expect, test } from "@playwright/test";
import { loadConfig } from "../../src/core/config.js";
import { evaluateAdaptiveSafety, KillSwitch } from "../../src/adaptive/safety.js";
import { ADAPTIVE_SCHEMA_VERSION, type ActionCandidate, type AdaptiveConfig } from "../../src/adaptive/contracts.js";
import { mapAdapterError, type AdaptiveAdapter } from "../../src/adapters/types.js";

function adaptive(): AdaptiveConfig {
  return {
    schemaVersion: "lakda/adaptive-config/v1",
    adapter: { id: "playwright" },
    generator: { strategy: "least-visited-transition" },
    stopWhen: { any: [{ type: "noveltyPlateau", windowActions: 3, minActions: 1 }] },
    settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 50 },
    fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
    recovery: { maxBacktracks: 2, maxAttemptsPerState: 3 },
    safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
  };
}

function candidate(overrides: Partial<ActionCandidate> = {}): ActionCandidate {
  return {
    schemaVersion: ADAPTIVE_SCHEMA_VERSION,
    candidateId: "click-search",
    adapterId: "playwright",
    targetRef: { targetId: "page-1", kind: "page", origin: "http://127.0.0.1:3000" },
    sourceFingerprint: "state:one",
    actionKind: "click",
    locatorRecipe: { strategy: "test-id", value: "search" },
    generatedBy: { ruleId: "visible-enabled", observationId: "obs-1", reason: "fixture" },
    risk: { weight: 1 },
    mutationKind: "none",
    ...overrides,
  };
}

test("adaptive-explore requires a complete, fail-closed adaptive configuration", () => {
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", mode: "adaptive-explore" })).toThrow(/adaptive設定/);
  const config = loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", mode: "adaptive-explore", adaptive: adaptive() });
  expect(config.mode).toBe("adaptive-explore");
  expect(() => loadConfig(undefined, {
    baseUrl: "http://127.0.0.1:3000",
    mode: "adaptive-explore",
    safety: { requireFixtureResetForMutations: false },
    adaptive: {
      ...adaptive(),
      adapter: { id: "security", endpoint: "http://127.0.0.1:9100", initialTarget: { targetId: "http-1", kind: "http", origin: "http://127.0.0.1:3000" } },
      securityProfileRef: "security-profile",
      safety: { ...adaptive().safety, allowTargetKinds: ["http"], allowMutationKinds: ["none", "parameter-mutation"] },
    },
  })).toThrow(/securityAuthorization/);
  expect(() => loadConfig(undefined, {
    baseUrl: "http://127.0.0.1:3000",
    mode: "adaptive-explore",
    adaptive: { ...adaptive(), adapter: { id: "airtest-poco" }, safety: { ...adaptive().safety, allowTargetKinds: ["device"] } },
  })).toThrow(/external adaptive adapter/);
  expect(() => loadConfig(undefined, {
    baseUrl: "http://127.0.0.1:3000",
    mode: "adaptive-explore",
    adaptive: { ...adaptive(), safety: { ...adaptive().safety, allowMutationKinds: ["delete"] } },
  })).toThrow(/破壊的mutation/);
});

test("adaptive safety applies kill switch, scope, mutation, and resource checks before execution", () => {
  const config = loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", mode: "adaptive-explore", adaptive: adaptive() });
  expect(evaluateAdaptiveSafety(candidate(), config, { actionCount: 0, artifactBytes: 0 })).toEqual({ allowed: true });
  expect(evaluateAdaptiveSafety(candidate({ mutationKind: "delete" }), config, { actionCount: 0, artifactBytes: 0 })).toEqual({ allowed: false, reason: "mutation_denied" });
  expect(evaluateAdaptiveSafety(candidate({ targetRef: { targetId: "outside", kind: "page", origin: "http://example.com" } }), config, { actionCount: 0, artifactBytes: 0 })).toEqual({ allowed: false, reason: "host_denied" });
  const killSwitch = new KillSwitch(); killSwitch.request("operator");
  expect(evaluateAdaptiveSafety(candidate(), config, { actionCount: 0, artifactBytes: 0, killSwitch })).toEqual({ allowed: false, reason: "kill_switch" });
});

test("adapter SPI exposes capabilities and maps errors without leaking objects", async () => {
  const adapter: AdaptiveAdapter = {
    capabilities: () => ({ schemaVersion: ADAPTIVE_SCHEMA_VERSION, adapterId: "fake", revision: "1", targetKinds: ["page"], actionKinds: ["click"], observationCapabilities: [], evidenceCapabilities: [], recoveryStrategies: [] }),
    observe: async () => { throw new Error("not called"); },
    generateCandidates: async () => [],
    execute: async () => { throw new Error("not called"); },
    recover: async () => ({ recovered: false, strategy: "none", evidenceRefs: [] }),
    captureEvidence: async () => [],
  };
  expect(adapter.capabilities().adapterId).toBe("fake");
  expect(mapAdapterError("fake", new Error("browser object"), "timeout", "artifacts/error.txt")).toEqual({
    schemaVersion: ADAPTIVE_SCHEMA_VERSION,
    adapterId: "fake",
    category: "timeout",
    messageRef: "Error",
    originalErrorRef: "artifacts/error.txt",
    retryable: true,
  });
  await expect(adapter.generateCandidates({} as never)).resolves.toEqual([]);
});
