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
  test.setTimeout(60_000);
  let terminalTestId = "finish";
  const fixture = await startFixture(() => ({ body: `<main><button data-testid="next" data-lakda-mutation-kind="none">Next</button></main><script>document.querySelector("button").addEventListener("click", () => document.querySelector("main").innerHTML = "<button data-testid='${terminalTestId}' data-lakda-mutation-kind='none'>Finish</button>");</script>` }));
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
    expect(graph.edges.every((edge: { oracleRefs?: string[] }) => Array.isArray(edge.oracleRefs) && edge.oracleRefs.length >= 2)).toBe(true);
    expect(trace.schemaVersion).toBe("lakda/adaptive-trace/v1");
    expect(trace.seed).toBe(99);
    expect(trace.trace.some((entry: { type: string }) => entry.type === "execution")).toBe(true);
    expect(trace.trace.some((entry: { type: string; phase?: string }) => entry.type === "observation" && entry.phase === "post-action")).toBe(true);
    const candidateSnapshots = candidates.trim().split(/\r?\n/).map(line => JSON.parse(line) as { coverageDebt: unknown[]; coverageDebtSummary: Record<string, number> });
    expect(candidateSnapshots.every(snapshot => Array.isArray(snapshot.coverageDebt) && typeof snapshot.coverageDebtSummary === "object")).toBe(true);    const oracleEntries = oracles.trim().split(/\r?\n/).map(line => JSON.parse(line) as { oracleClass: string; sourceRefs: string[] });
    expect(oracleEntries.some(entry => entry.oracleClass === "generic" && entry.sourceRefs.length >= 3)).toBe(true);
    expect(coverage.schemaVersion).toBe("lakda/coverage-report/v1");
    expect(coverage.model).toBe("discovered-model");
    expect(coverage.openWorld).toBe(true);
    expect(coverage.timeline.length).toBeGreaterThanOrEqual(1);
    expect(coverage.timeline.every((point: { graphRevision: number }) => point.graphRevision > 0)).toBe(true);
    expect(shrink.schemaVersion).toBe("lakda/shrink-report/v1");
    expect(observations.trim()).not.toBe("");
    expect(candidates.trim()).not.toBe("");
    expect(oracles.trim()).not.toBe("");
    const replayed = await runLakda(config, join(adaptiveDir, "trace.json"));
    expect(replayed.outcome, JSON.stringify(replayed)).toBe("passed");

    const guarded = structuredClone(trace) as { trace: Array<{ type: string; candidate?: { contract?: Record<string, unknown> } }> };
    const guardedCandidate = guarded.trace.find(entry => entry.type === "candidate")?.candidate;
    if (!guardedCandidate) throw new Error("guarded replay candidate missing");
    guardedCandidate.contract = { enabledWhen: { state: "never-enabled" } };
    const guardedInput = join(adaptiveDir, "guarded-trace.json");
    await writeFile(guardedInput, JSON.stringify(guarded), "utf8");
    const guardDenied = await runLakda(config, guardedInput);
    expect(guardDenied.outcome).toBe("failed");
    const guardTrace = JSON.parse(await readFile(join(dirname(guardDenied.actionSequencePath!), "adaptive", "trace.json"), "utf8"));
    expect(guardTrace.trace.some((entry: { type: string; reason?: string }) => entry.type === "replay-divergence" && entry.reason === "guard-not-satisfied:state")).toBe(true);

    const postcondition = structuredClone(trace) as { trace: Array<{ type: string; candidate?: { contract?: Record<string, unknown> } }> };
    const postconditionCandidate = postcondition.trace.find(entry => entry.type === "candidate")?.candidate;
    if (!postconditionCandidate) throw new Error("postcondition replay candidate missing");
    postconditionCandidate.contract = { ensures: { state: "never-reached" }, invariants: { persona: "default" }, requirementRefs: ["REQ-ACT-008", "REQ-ACT-009"] };
    const postconditionInput = join(adaptiveDir, "postcondition-trace.json");
    await writeFile(postconditionInput, JSON.stringify(postcondition), "utf8");
    const postconditionFailed = await runLakda(config, postconditionInput);
    expect(postconditionFailed.outcome).toBe("failed");
    const postconditionTrace = JSON.parse(await readFile(join(dirname(postconditionFailed.actionSequencePath!), "adaptive", "trace.json"), "utf8"));
    expect(postconditionTrace.trace.some((entry: { type: string; result?: { oracleClass?: string; verdict?: string; message?: string } }) =>
      entry.type === "oracle" && entry.result?.oracleClass === "product" && entry.result.verdict === "fail" && entry.result.message?.startsWith("postcondition-mismatch:"))).toBe(true);

    terminalTestId = "changed-post-state";
    const postDiverged = await runLakda(config, join(adaptiveDir, "trace.json"));
    expect(postDiverged.outcome, JSON.stringify(postDiverged)).toBe("failed");
    const postDivergenceTrace = JSON.parse(await readFile(join(dirname(postDiverged.actionSequencePath!), "adaptive", "trace.json"), "utf8"));
    expect(postDivergenceTrace.trace.some((entry: { type: string; reason?: string }) => entry.type === "replay-divergence" && entry.reason === "post-fingerprint-mismatch")).toBe(true);
    terminalTestId = "finish";

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


test("adaptive recovery verifies the restored fingerprint and records a backtrack edge", async () => {
  const fixture = await startFixture(url => url.pathname === "/hang"
    ? { body: `<main>Hanging</main><script>setInterval(() => { document.querySelector("main").textContent = String(Date.now()); }, 1);</script>` }
    : { body: `<a data-testid="hang" data-lakda-mutation-kind="none" href="/hang">Hang</a>` });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-recovery-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 17, maxActions: 2, durationMs: 5_000, mode: "adaptive-explore",
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" },
        stopWhen: { any: [{ type: "noveltyPlateau", windowActions: 3, minActions: 2 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 150, stableWindowMs: 30 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 1, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config);
    expect(result.outcome).toBe("failed");
    const adaptiveDir = join(dirname(result.actionSequencePath!), "adaptive");
    const trace = JSON.parse(await readFile(join(adaptiveDir, "trace.json"), "utf8")) as { trace: Array<Record<string, unknown>> };
    const graph = JSON.parse(await readFile(join(adaptiveDir, "transition-graph.json"), "utf8")) as { edges: Array<Record<string, unknown>> };
    const execution = trace.trace.find(entry => entry.type === "execution")?.executionResult as { status: string; preFingerprint: string; postFingerprint?: string };
    expect(execution.status).toBe("timeout");
    const recovery = trace.trace.find(entry => entry.type === "recovery");
    expect(recovery).toMatchObject({
      recovered: true,
      strategy: "backtrack",
      expectedFingerprint: execution.preFingerprint,
      postFingerprint: execution.preFingerprint,
      matchedExpectedState: true,
    });
    expect(graph.edges.some(edge => edge.edgeKind === "backtrack" && edge.from === execution.postFingerprint && edge.to === execution.preFingerprint)).toBe(true);
    expect(trace.trace.some(entry => entry.type === "recovery-divergence")).toBe(false);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("adaptive recovery stops on a restored-state fingerprint divergence", async () => {
  const fixture = await startFixture(url => url.pathname === "/hang"
    ? { body: `<main>Hanging</main><script>localStorage.setItem("recovery-label", "Changed"); setInterval(() => { document.querySelector("main").textContent = String(Date.now()); }, 1);</script>` }
    : { body: `<a data-testid="hang" data-lakda-mutation-kind="none" href="/hang">Hang</a><script>addEventListener("pageshow", () => { document.querySelector("[data-testid=hang]").textContent = localStorage.getItem("recovery-label") || "Hang"; });</script>` });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-recovery-divergence-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 17, maxActions: 2, durationMs: 5_000, mode: "adaptive-explore",
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" },
        stopWhen: { any: [{ type: "noveltyPlateau", windowActions: 3, minActions: 2 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 150, stableWindowMs: 30 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 1, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config);
    expect(result.outcome).toBe("failed");
    const adaptiveDir = join(dirname(result.actionSequencePath!), "adaptive");
    const trace = JSON.parse(await readFile(join(adaptiveDir, "trace.json"), "utf8")) as { trace: Array<Record<string, unknown>> };
    const graph = JSON.parse(await readFile(join(adaptiveDir, "transition-graph.json"), "utf8")) as { edges: Array<{ edgeKind: string; statuses: Record<string, number> }> };
    expect(trace.trace.filter(entry => entry.type === "execution")).toHaveLength(1);
    expect(trace.trace.some(entry => entry.type === "recovery-divergence")).toBe(true);
    expect(graph.edges.some(edge => edge.edgeKind === "backtrack" && edge.statuses.diverged === 1)).toBe(true);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("adaptive failure shrinking replays only safe non-mutating candidates and records the derived trace", async () => {
  const fixture = await startFixture(() => ({ body: `<main><button data-testid="noise" data-lakda-mutation-kind="none">Noise</button><button data-testid="fail" data-lakda-mutation-kind="none">Fail</button></main><script>
    document.querySelector("[data-testid=noise]").addEventListener("click", () => undefined);
    document.querySelector("[data-testid=fail]").addEventListener("click", () => setInterval(() => { document.querySelector("main").textContent = String(Date.now()); }, 1));
  </script>` }));
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-shrink-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 1, maxActions: 3, mode: "adaptive-explore",
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


test("adaptive trace records the exact versioned InputCase and replays it", async () => {
  const fixture = await startFixture(() => ({ body: `<main><form><label>Email <input data-testid="email" type="email" required minlength="6" maxlength="64"></label></form></main>` }));
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-input-replay-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, seed: 17, maxActions: 2, mode: "adaptive-explore",
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" },
        stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 20 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config);
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
    const runDir = dirname(result.actionSequencePath!);
    const tracePath = join(runDir, "adaptive", "trace.json");
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as { trace: Array<{ type: string; candidate?: { inputProfileRef?: string }; inputCase?: { caseId: string; fieldId: string; generatorVersion: string; seed: number; domainRef: string; valueDigest: string } }> };
    const selected = trace.trace.find(entry => entry.type === "candidate");
    expect(selected?.inputCase?.generatorVersion).toBe("lakda-input-generator/v1");
    expect(selected?.inputCase?.seed).toBe(17);
    expect(selected?.inputCase?.domainRef).toBe("form:form-0/email");
    expect(selected?.candidate?.inputProfileRef).toBe(`input-field:${selected?.inputCase?.fieldId}`);
    expect(selected?.inputCase?.valueDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(selected?.inputCase).not.toHaveProperty("value");

    const replayed = await runLakda(config, tracePath);
    const replayTrace = JSON.parse(await readFile(join(dirname(replayed.actionSequencePath!), "adaptive", "trace.json"), "utf8")) as typeof trace;
    expect(replayed.outcome, JSON.stringify({ replayed, replayTrace })).toBe("passed");
    expect(replayTrace.trace.find(entry => entry.type === "candidate")?.inputCase).toEqual(selected?.inputCase);
  } finally {
    await fixture.close();
    await rm(outputDir, { recursive: true, force: true });
  }
});


test("adaptive timeout quarantines the timed-out candidate and records recovery safety evidence", async () => {
  const observation: Observation = {
    schemaVersion: "lakda/adaptive-contracts/v1",
    observationId: "quarantine-observation",
    observedAt: "2026-07-15T00:00:00Z",
    targetRef: { targetId: "device-1", kind: "device" },
    completeness: "complete",
    personaRef: "guest",
    ui: { screen: "root" },
    forms: [],
    dialogs: [],
    topology: { activeTargetId: "device-1" },
    obligations: {},
    provenance: { adapterId: "airtest-poco", runtime: "operator-bridge", capabilityRevision: "1" },
  };
  const fingerprint = fingerprintObservation(observation).value;
  const makeCandidate = (candidateId: string) => ({
    schemaVersion: "lakda/adaptive-contracts/v1",
    candidateId,
    adapterId: "airtest-poco",
    targetRef: observation.targetRef,
    sourceFingerprint: fingerprint,
    actionKind: "tap",
    locatorRecipe: { strategy: "image", value: candidateId },
    generatedBy: { ruleId: "fixture", observationId: observation.observationId, reason: "visible" },
    risk: { weight: 1 },
    mutationKind: "none",
  });
  const timeoutCandidate = makeCandidate("a-timeout");
  const safeCandidate = makeCandidate("b-safe");
  let timeoutExecutions = 0;
  const fixture = await startFixture((url, method, body) => {
    if (method !== "POST") return { status: 405, body: "POST required" };
    if (url.pathname === "/capabilities") return { contentType: "application/json", body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "1", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen"], evidenceCapabilities: ["screenshot", "trace", "network"], recoveryStrategies: ["backtrack"] }) };
    if (url.pathname === "/observe") return { contentType: "application/json", body: JSON.stringify(observation) };
    if (url.pathname === "/generate-candidates") return { contentType: "application/json", body: JSON.stringify([timeoutCandidate, safeCandidate]) };
    if (url.pathname === "/execute") {
      const request = JSON.parse(body) as { candidate: { candidateId: string } };
      if (request.candidate.candidateId === timeoutCandidate.candidateId) {
        timeoutExecutions += 1;
        return { contentType: "application/json", body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", executionId: "timeout-execution-" + timeoutExecutions, candidateId: timeoutCandidate.candidateId, preFingerprint: fingerprint, postFingerprint: "state:timeout", startedAt: "2026-07-15T00:00:01Z", endedAt: "2026-07-15T00:00:02Z", status: "timeout", failureSignature: "bridge-timeout", recoveryStatus: "not_attempted", targetChanges: [], settleResult: { policyVersion: "bridge/v1", status: "timed_out", elapsedMs: 1000, reasons: ["fixture-timeout"] }, evidenceRefs: [] }) };
      }
      return { contentType: "application/json", body: JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", executionId: "safe-execution", candidateId: safeCandidate.candidateId, preFingerprint: fingerprint, postFingerprint: "state:done", startedAt: "2026-07-15T00:00:03Z", endedAt: "2026-07-15T00:00:04Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "bridge/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] }) };
    }
    if (url.pathname === "/recover") return { contentType: "application/json", body: JSON.stringify({ recovered: true, strategy: "backtrack", targetRef: observation.targetRef, evidenceRefs: [] }) };
    if (url.pathname === "/capture-evidence") return { contentType: "application/json", body: JSON.stringify([]) };
    return { status: 404, body: "missing" };
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-adaptive-timeout-quarantine-"));
  try {
    const config = loadConfig(undefined, {
      baseUrl: fixture.baseUrl,
      outputDir,
      seed: 23,
      maxActions: 2,
      mode: "adaptive-explore",
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1",
        adapter: { id: "airtest-poco", endpoint: fixture.baseUrl, initialTarget: observation.targetRef },
        generator: { strategy: "least-visited-transition" },
        stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 20 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 1, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["device"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config);
    const trace = JSON.parse(await readFile(join(dirname(result.actionSequencePath!), "adaptive", "trace.json"), "utf8")) as { trace: Array<Record<string, unknown>> };
    const executions = trace.trace.filter(entry => entry.type === "execution").map(entry => (entry.executionResult as { candidateId: string; status: string }));
    expect(executions.map(entry => entry.candidateId)).toEqual([timeoutCandidate.candidateId, safeCandidate.candidateId]);
    expect(executions[0].status).toBe("timeout");
    expect(timeoutExecutions).toBe(1);
    expect(trace.trace.some(entry => entry.type === "candidate-quarantined" && entry.candidateId === timeoutCandidate.candidateId && entry.revisitBudget === 1)).toBe(true);
    expect(trace.trace.some(entry => entry.type === "timeout-evidence" && entry.candidateId === timeoutCandidate.candidateId && entry.preFingerprint === fingerprint && entry.captureRequested)).toBe(true);
    expect(trace.trace.some(entry => entry.type === "recovery" && entry.matchedExpectedState === true && entry.recoveryChecks)).toBe(true);
  } finally {
    await fixture.close();
    await rm(outputDir, { recursive: true, force: true });
  }
});
