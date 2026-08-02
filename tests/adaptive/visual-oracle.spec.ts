import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/core/config.js";
import { ArtifactCollector } from "../../src/core/artifacts.js";
import type { ActionCandidate, ExecutionResult, Observation } from "../../src/adaptive/contracts.js";
import type { AdaptiveAdapter } from "../../src/adapters/types.js";
import { explorationOracleResults } from "../../src/adaptive/visual.js";
import { StateGraph } from "../../src/adaptive/graph.js";
import { evaluateAndRecordOracles } from "../../src/adaptive/coordinator/oracle.js";
import { observeCandidateSet } from "../../src/adaptive/coordinator/observation.js";
import { KillSwitch } from "../../src/adaptive/safety.js";

const candidate: ActionCandidate = {
  schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "visual-tap", adapterId: "airtest-poco",
  targetRef: { targetId: "device-1", kind: "device" }, sourceFingerprint: "state:before", actionKind: "tap",
  locatorRecipe: { strategy: "image", value: "start" }, generatedBy: { ruleId: "test", observationId: "obs-before", reason: "test" },
  risk: { weight: 1 }, mutationKind: "none",
  visual: { source: "airtest-template", confidence: 0.9, region: { x: 0, y: 0, width: 0.2, height: 0.2 }, requiredCapabilities: ["screen"], identity: { resolution: "1080x1920", orientation: "portrait", surface: "android" } },
  contract: { requirementRefs: ["REQ-TEST-VISUAL"] },
};

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", observationId: "obs-before", observedAt: "2026-08-03T00:00:00.000Z",
    targetRef: { targetId: "device-1", kind: "device" }, completeness: "complete", ui: { screen: "home" }, forms: [], dialogs: [],
    topology: {}, obligations: {}, provenance: { adapterId: "airtest-poco", runtime: "test", capabilityRevision: "test" },
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", executionId: "exec-1", candidateId: candidate.candidateId,
    preFingerprint: "state:before", postFingerprint: "state:after", startedAt: "2026-08-03T00:00:00.000Z", endedAt: "2026-08-03T00:00:01.000Z",
    status: "executed", recoveryStatus: "not_required", targetChanges: [],
    settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [],
    ...overrides,
  };
}

function kinds(results: ReturnType<typeof explorationOracleResults>): string[] {
  return results.map(result => result.oracleId.split(":")[1] ?? "").sort();
}

test("探索visual oracleは5分類を個別に記録し、refsとcandidate requirementを維持する", () => {
  const positive = [
    { kind: "crash", execution: execution({ status: "infrastructure_error" }), after: observation({ observationId: "obs-after" }) },
    { kind: "freeze", execution: execution({ status: "timeout", settleResult: { policyVersion: "settle/v1", status: "timed_out", elapsedMs: 10, reasons: ["timeout"] } }), after: observation({ observationId: "obs-after" }) },
    { kind: "no-visual-change", execution: execution({ postFingerprint: "state:before" }), after: observation({ observationId: "obs-after", adapterDataRef: "screen:same" }) },
    { kind: "visual-anomaly", execution: execution(), after: observation({ observationId: "obs-after", ui: { screen: "home", visualAnomaly: true } }) },
    { kind: "unknown-screen", execution: execution(), after: observation({ observationId: "obs-after", completeness: "unavailable", ui: { screen: "unknown" } }) },
  ] as const;
  for (const [index, item] of positive.entries()) {
    const before = index === 2 ? observation({ adapterDataRef: "screen:same" }) : observation();
    const results = explorationOracleResults({ candidate, before, after: item.after, execution: item.execution });
    expect(kinds(results)).toEqual([item.kind]);
    expect(results[0]?.sourceRefs).toEqual(expect.arrayContaining([candidate.candidateId, item.execution.executionId, before.observationId, item.after.observationId]));
    expect(results[0]?.requirementRefs).toEqual(expect.arrayContaining(["REQ-AX-013", "REQ-GAME-004", "REQ-TEST-VISUAL"]));
    if (item.kind === "unknown-screen") expect(results[0]?.requirementRefs).toContain("REQ-AX-008");
    expect(results[0]?.evidenceRefs).toBe(item.execution.evidenceRefs);
  }
});

test("複合シグナルは分類ごとに最大1件で、freeze/crash時のno-visual-changeを誤生成しない", () => {
  const before = observation({ adapterDataRef: "screen:same", ui: { screen: "home", events: [{ eventId: "crash-1", kind: "crash" }] } });
  const after = observation({ observationId: "obs-after", completeness: "unavailable", adapterDataRef: "screen:same", ui: { screen: "unknown", visualAnomalies: ["signal"] , events: [{ eventId: "crash-1", kind: "crash" }] } });
  const results = explorationOracleResults({
    candidate, before, after,
    execution: execution({ status: "timeout", postFingerprint: "state:before", settleResult: { policyVersion: "settle/v1", status: "timed_out", elapsedMs: 10, reasons: ["freeze"] } }),
  });
  expect(kinds(results)).toEqual(["crash", "freeze", "unknown-screen", "visual-anomaly"]);
  expect(new Set(results.map(result => result.oracleId)).size).toBe(results.length);
});

test("通常adaptiveではexploration oracleを生成しない", () => {
  const before = observation({ adapterDataRef: "screen:same" });
  const after = observation({ observationId: "obs-after", adapterDataRef: "screen:same" });
  const graph = new StateGraph();
  const result = execution({ postFingerprint: "state:after" });
  graph.recordTransition(candidate.sourceFingerprint, candidate, result, result.postFingerprint, 1);
  const oracleResults: ReturnType<typeof explorationOracleResults> = [];
  const trace: Array<Record<string, unknown>> = [];
  const evaluated = evaluateAndRecordOracles({ graph, candidate, oracleCandidate: candidate, before, after, execution: result, oracleResults, trace, exploration: false });
  expect(evaluated.stepOracles.some(oracle => oracle.oracleId.startsWith("exploration:"))).toBe(false);
  expect(oracleResults.some(oracle => oracle.oracleId.startsWith("exploration:"))).toBe(false);
});

test("通常adaptiveのAirtest候補なしではunknown-screen debt/findingを作らない", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-visual-oracle-normal-"));
  try {
    const config = loadConfig(undefined, {
      mode: "adaptive-explore", outputDir,
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "airtest-poco", endpoint: "http://127.0.0.1:8765", initialTarget: { targetId: "device-1", kind: "device" } },
        generator: { strategy: "least-visited-transition" }, stopWhen: { any: [{ type: "durationMs", atMost: 1000 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 100, stableWindowMs: 0 }, fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 }, safety: { allowTargetKinds: ["device"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const collector = await ArtifactCollector.create(config, config.mode);
    const adapter = {
      capabilities: () => ({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "test", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen"], evidenceCapabilities: ["screenshot"], recoveryStrategies: [] }),
      observe: async () => observation(),
      discoverCandidates: async () => ({ candidates: [], coverageDebt: [] }),
      generateCandidates: async () => [],
      execute: async () => execution(),
      recover: async () => ({ recovered: true, strategy: "none", evidenceRefs: [] }),
      captureEvidence: async () => [],
    } satisfies AdaptiveAdapter;
    const candidateSnapshots: Array<{ observationId: string; candidates: ActionCandidate[]; coverageDebt: never[]; coverageDebtSummary: Record<string, number> }> = [];
    const oracleResults: ReturnType<typeof explorationOracleResults> = [];
    await observeCandidateSet({
      config, collector, adapter, activeTargets: () => [candidate.targetRef], graph: new StateGraph(), trace: [], observations: [], observationsByFingerprint: new Map(),
      oracleResults, candidateSnapshots, generatedInputs: [], killSwitch: new KillSwitch(), timeoutQuarantine: new Map(), actions: 0, replay: false,
    });
    expect(candidateSnapshots[0]?.coverageDebt).toEqual([]);
    expect(oracleResults).toEqual([]);
    expect(collector.findingDetected).toBe(false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
