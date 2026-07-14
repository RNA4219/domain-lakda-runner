import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/core/config.js";
import { runLakda } from "../../src/core/runner.js";
import { startFixture } from "../fixtures/server.js";
import { fingerprintObservation } from "../../src/adaptive/fingerprint.js";
import type { Observation } from "../../src/adaptive/contracts.js";

test("adaptive-explore writes a state graph and deterministic replay trace from a real browser run", async () => {
  const fixture = await startFixture(() => ({ body: `<main><button data-testid="next">Next</button></main><script>document.querySelector("button").addEventListener("click", () => document.querySelector("main").innerHTML = "<button data-testid='finish'>Finish</button>");</script>` }));
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 99, maxActions: 5, mode: "adaptive-explore",
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" },
        stopWhen: { any: [{ type: "noveltyPlateau", windowActions: 1, minActions: 2 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 20 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 2, maxAttemptsPerState: 3 },
        safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config);
    expect(result.outcome).toBe("passed");
    const runDir = dirname(result.actionSequencePath!);
    const manifest = JSON.parse(await readFile(result.artifactManifestPath!, "utf8")) as { artifacts: Array<{ path: string }> };
    expect(manifest.artifacts.map(artifact => artifact.path)).toContain("adaptive/trace.json");
    expect(manifest.artifacts.map(artifact => artifact.path)).toContain("adaptive/coverage.json");
    const adaptiveDir = join(runDir, "adaptive");
    const graph = JSON.parse(await readFile(join(adaptiveDir, "transition-graph.json"), "utf8"));
    const trace = JSON.parse(await readFile(join(adaptiveDir, "trace.json"), "utf8"));
    const coverage = JSON.parse(await readFile(join(adaptiveDir, "coverage.json"), "utf8"));
    const shrink = JSON.parse(await readFile(join(adaptiveDir, "shrink-report.json"), "utf8"));
    const observations = await readFile(join(adaptiveDir, "observations.jsonl"), "utf8");
    const candidates = await readFile(join(adaptiveDir, "candidate-snapshots.jsonl"), "utf8");
    const oracles = await readFile(join(adaptiveDir, "oracle-results.jsonl"), "utf8");
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
    expect(trace.schemaVersion).toBe("lakda/adaptive-trace/v1");
    expect(trace.seed).toBe(99);
    expect(trace.trace.some((entry: { type: string }) => entry.type === "execution")).toBe(true);
    expect(coverage.schemaVersion).toBe("lakda/coverage-report/v1");
    expect(shrink.schemaVersion).toBe("lakda/shrink-report/v1");
    expect(observations.trim()).not.toBe("");
    expect(candidates.trim()).not.toBe("");
    expect(oracles.trim()).not.toBe("");
    const replayed = await runLakda(config, join(adaptiveDir, "trace.json"));
    expect(replayed.outcome, JSON.stringify(replayed)).toBe("passed");
    const divergent = structuredClone(trace) as { trace: Array<{ type: string; candidate?: { sourceFingerprint: string } }> };
    const replayCandidate = divergent.trace.find(entry => entry.type === "candidate");
    if (!replayCandidate?.candidate) throw new Error("replay candidate missing");
    replayCandidate.candidate.sourceFingerprint = "state:deliberately-diverged";
    const divergentInput = join(runDir, "adaptive", "divergent-trace.json");
    await writeFile(divergentInput, JSON.stringify(divergent), "utf8");
    const diverged = await runLakda(config, divergentInput);
    expect(diverged.outcome).toBe("failed");
    const divergenceTrace = JSON.parse(await readFile(join(dirname(diverged.actionSequencePath!), "adaptive", "trace.json"), "utf8"));
    expect(divergenceTrace.trace.some((entry: { type: string }) => entry.type === "replay-divergence")).toBe(true);
  } finally {
    await fixture.close();
    await rm(outputDir, { recursive: true, force: true });
  }
});


test("adaptive failure shrinking replays only safe non-mutating candidates and records the derived trace", async () => {
  const fixture = await startFixture(() => ({ body: `<main><button data-testid="noise">Noise</button><button data-testid="fail">Fail</button></main><script>
    document.querySelector("[data-testid=noise]").addEventListener("click", () => undefined);
    document.querySelector("[data-testid=fail]").addEventListener("click", () => setInterval(() => { document.querySelector("main").textContent = String(Date.now()); }, 1));
  </script>` }));
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-shrink-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 0, maxActions: 3, mode: "adaptive-explore",
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" },
        stopWhen: { any: [{ type: "durationMs", atMost: 5_000 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 300, stableWindowMs: 20 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config);
    expect(result.outcome).toBe("failed");
    const shrink = JSON.parse(await readFile(join(dirname(result.actionSequencePath!), "adaptive", "shrink-report.json"), "utf8"));
    expect(shrink.status, JSON.stringify(shrink)).toBe("shrunk");
    expect(shrink.originalStepCount).toBe(2);
    expect(shrink.reducedStepCount).toBe(1);
    expect(shrink.finalFailureSignature).toBe("timeout");
  } finally {
    await fixture.close();
    await rm(outputDir, { recursive: true, force: true });
  }
});


test("adaptive-explore executes an operator-managed Airtest/Poco loopback bridge without starting a process", async () => {
  const observation: Observation = {
    schemaVersion: "lakda/adaptive-contracts/v1", observationId: "device-observation", observedAt: "2026-07-15T00:00:00Z",
    targetRef: { targetId: "device-1", kind: "device" }, completeness: "complete", ui: { screen: "home" }, forms: [], dialogs: [],
    topology: { activeTargetId: "device-1" }, obligations: {}, provenance: { adapterId: "airtest-poco", runtime: "operator-bridge", capabilityRevision: "1" },
  };
  const fingerprint = fingerprintObservation(observation).value;
  const candidate = {
    schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "tap-next", adapterId: "airtest-poco", targetRef: observation.targetRef, sourceFingerprint: fingerprint,
    actionKind: "tap", locatorRecipe: { strategy: "image", value: "next" }, generatedBy: { ruleId: "bridge", observationId: observation.observationId, reason: "visible" },
    risk: { weight: 1 }, mutationKind: "none",
  };
  const fixture = await startFixture((url, method) => {
    if (method !== "POST") return { status: 405, body: "POST required" };
    if (url.pathname === "/capabilities") return { contentType: "application/json", body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "1", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen"], evidenceCapabilities: [], recoveryStrategies: ["backtrack"] }) };
    if (url.pathname === "/observe") return { contentType: "application/json", body: JSON.stringify(observation) };
    if (url.pathname === "/generate-candidates") return { contentType: "application/json", body: JSON.stringify([candidate]) };
    if (url.pathname === "/execute") return { contentType: "application/json", body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", executionId: "device-exec", candidateId: candidate.candidateId, preFingerprint: fingerprint, postFingerprint: "state:device-complete", startedAt: "2026-07-15T00:00:01Z", endedAt: "2026-07-15T00:00:02Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] }) };
    return { status: 404, body: "missing" };
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-bridge-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 11, maxActions: 2, mode: "adaptive-explore",
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1",
        adapter: { id: "airtest-poco", endpoint: fixture.baseUrl, initialTarget: observation.targetRef },
        generator: { strategy: "least-visited-transition" }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 20 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["device"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config);
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
    const trace = JSON.parse(await readFile(join(dirname(result.actionSequencePath!), "adaptive", "trace.json"), "utf8"));
    expect(trace.trace.some((entry: { type: string }) => entry.type === "execution")).toBe(true);
  } finally {
    await fixture.close();
    await rm(outputDir, { recursive: true, force: true });
  }
});


test("Security bridge executes an authorized sequential parameter mutation only within declared scope", async () => {
  const observation: Observation = {
    schemaVersion: "lakda/adaptive-contracts/v1", observationId: "security-observation", observedAt: "2026-07-15T00:00:00Z",
    targetRef: { targetId: "http-1", kind: "http", origin: "http://127.0.0.1/safe" }, completeness: "complete", ui: {}, forms: [], dialogs: [],
    topology: { activeTargetId: "http-1" }, obligations: {}, provenance: { adapterId: "security", runtime: "operator-bridge", capabilityRevision: "1" },
  };
  const fingerprint = fingerprintObservation(observation).value;
  const candidate = {
    schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "parameter-mutation", adapterId: "security", targetRef: observation.targetRef, sourceFingerprint: fingerprint,
    actionKind: "parameter-mutation", locatorRecipe: { strategy: "request", value: "safe-request" }, generatedBy: { ruleId: "bridge", observationId: observation.observationId, reason: "authorized" },
    risk: { weight: 2 }, mutationKind: "parameter-mutation",
  };
  let executeCalls = 0; let cleanupCalls = 0;
  const fixture = await startFixture((url, method) => {
    if (method !== "POST") return { status: 405, body: "POST required" };
    if (url.pathname === "/capabilities") return { contentType: "application/json", body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "security", revision: "1", targetKinds: ["http"], actionKinds: ["parameter-mutation"], observationCapabilities: ["http"], evidenceCapabilities: ["security-control", "cleanup"], recoveryStrategies: ["backtrack"] }) };
    if (url.pathname === "/observe") return { contentType: "application/json", body: JSON.stringify(observation) };
    if (url.pathname === "/generate-candidates") return { contentType: "application/json", body: JSON.stringify([candidate]) };
    if (url.pathname === "/security-control") return { contentType: "application/json", body: JSON.stringify({ triggered: false, evidenceRefs: [] }) };
    if (url.pathname === "/cleanup") { cleanupCalls += 1; return { contentType: "application/json", body: JSON.stringify({ completed: true, evidenceRefs: [] }) }; }
    if (url.pathname === "/execute") { executeCalls += 1; return { contentType: "application/json", body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", executionId: "security-exec", candidateId: candidate.candidateId, preFingerprint: fingerprint, postFingerprint: "state:security-complete", startedAt: "2026-07-15T00:00:01Z", endedAt: "2026-07-15T00:00:02Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] }) }; }
    return { status: 404, body: "missing" };
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-security-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 12, maxActions: 2, mode: "adaptive-explore",
      safety: { requireFixtureResetForMutations: false },
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1",
        adapter: { id: "security", endpoint: fixture.baseUrl, initialTarget: observation.targetRef },
        securityProfileRef: "security-profile",
        securityAuthorization: { authorizationId: "auth-1", owner: "security", targets: { hosts: ["127.0.0.1"], pathPrefixes: ["/safe"] }, environment: "staging", validFrom: "2026-07-01T00:00:00Z", validUntil: "2026-08-01T00:00:00Z", allowedMutationKinds: ["parameter-mutation"], maxRatePerMinute: 1, maxConcurrency: 1, cleanupRef: "cleanup-1", killSwitchRef: "kill-1", approvalEvidenceRef: "approval-1" },
        generator: { strategy: "least-visited-transition" }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 20 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["http"], denyActionIds: [], allowMutationKinds: ["none", "parameter-mutation"] },
      },
    });
    const result = await runLakda(config);
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
    expect(executeCalls).toBe(1);
    expect(cleanupCalls).toBe(1);
    const scopedOut = structuredClone(config);
    scopedOut.adaptive!.securityAuthorization!.targets.pathPrefixes = ["/outside"];
    const denied = await runLakda(scopedOut);
    expect(denied.outcome, JSON.stringify(denied)).toBe("passed");
    expect(executeCalls).toBe(1);
    expect(cleanupCalls).toBe(1);
    const deniedTrace = JSON.parse(await readFile(join(dirname(denied.actionSequencePath!), "adaptive", "trace.json"), "utf8"));
    expect(deniedTrace.trace.some((entry: { type: string; reason?: string }) => entry.type === "candidate-denied" && entry.reason === "scope_denied")).toBe(true);
  } finally {
    await fixture.close();
    await rm(outputDir, { recursive: true, force: true });
  }
});
