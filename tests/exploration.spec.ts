import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { runCli } from "../src/cli.js";
import { startFixture } from "./fixtures/server.js";
import { assertAdaptiveContract, assertCandidateDiscoveryResult, type ActionCandidate, type EvidenceArtifactRef, type Observation, type OracleResult } from "../src/adaptive/contracts.js";
import { observeCandidateSet, type CandidateSnapshot } from "../src/adaptive/coordinator/observation.js";
import { StateGraph } from "../src/adaptive/graph.js";
import { type GeneratedInput } from "../src/adaptive/input.js";
import { evaluateAdaptiveSafety, KillSwitch } from "../src/adaptive/safety.js";
import { assertVisualCandidate, normalizeVisualRegion, visualCandidateId } from "../src/adaptive/visual.js";
import type { AdaptiveAdapter } from "../src/adapters/types.js";
import { ArtifactCollector } from "../src/core/artifacts.js";
import { fileDigest } from "../src/core/artifact-store.js";
import { loadConfig } from "../src/core/config.js";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import {
  adaptiveConfigFromCharter,
  assertExplorationCapabilityForCharter,
  assertExplorationCharter,
  capabilitySnapshotDigest,
  capabilitySnapshotFromAdapter,
  explorationDigest,
  type ExplorationCharter,
  type ExplorationCapabilitySnapshot,
} from "../src/exploration/contracts.js";
import {
  appendSessionEvent,
  buildExplorationReport,
  buildSessionHateManifest,
  copyTargetManifest,
  createExplorationSession,
  loadExplorationSession,
  registerRunManifest,
  resolveRunDirectoryReference,
  writeCheckpoint,
  writeCapabilitySnapshot,
  writeFinding,
} from "../src/exploration/session.js";
import { aggregateExplorationAcceptance, type ExplorationAcceptanceIndexEntry, REAL_LANE_ACCEPTANCE_REQUIRED } from "../src/exploration/acceptance.js";
import { loadSignedExplorationTargetManifest, type ExplorationTargetManifest, targetManifestSigningPayload } from "../src/exploration/target-manifest.js";
import { assertResumeCapabilityBinding, assertTemplateCorpusBinding } from "../src/commands/exploration.js";

const charter: ExplorationCharter = {
  schemaVersion: "lakda/exploration-charter/v1", charterId: "test-charter", targetRevision: "fixture-v1", platform: "android", executionMode: "fixture", adapter: { id: "airtest-poco", endpoint: "http://127.0.0.1:8765", initialTarget: { targetId: "device-1", kind: "device" } },
  persona: "guest", scope: { allowHosts: ["127.0.0.1"], native: { appId: "fixture.app", surfaces: ["android"], denyZones: [] } }, budget: { durationMs: 1000, maxActions: 2, maxActionsPerMinute: 10 }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
  generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" }, capture: { video: "retain-on-finding-or-non-pass", screenshot: "finding-non-pass-bookmark", sampledFrames: { enabled: true, intervalMs: 1000, maxFrames: 30, maxBytes: 10_000_000, source: "operator-bridge", stopTimeoutMs: 5_000 } }, templateCorpusVersion: "templates/v1", templateCorpus: { path: "examples/airtest-templates.json", version: "templates/v1", sha256: "sha256:fcc2937c3ef87cf75d67ba117950ab2ff32adea9a297feceeace8491a8aeca89" }, seed: 7,
};

type AcceptanceMutation = {
  technicalOutcome?: "failed" | "partial" | "error";
  captureFailure?: boolean;
  unexpectedBlocker?: boolean;
  omitTargetManifest?: boolean;
  targetManifestDigestMismatch?: boolean;
  capabilityDigestMismatch?: boolean;
  rawCapabilityDigestMismatch?: boolean;
  omitRunManifest?: boolean;
  runSetMismatch?: boolean;
  eventTamper?: boolean;
  securityFailure?: boolean;
  sessionJsonTamper?: boolean;
  sessionTargetDigestTamper?: boolean;
};

function acceptanceCharter(platform: ExplorationCharter["platform"], root: string): ExplorationCharter {
  const web = platform === "pc-web" || platform === "mobile-web";
  const result = {
    ...charter,
    charterId: `acceptance-${platform}`,
    platform,
    executionMode: "real",
    targetManifestPath: join(root, `${platform}-target-manifest.json`),
    trustStorePath: join(root, "trust-store.json"),
    ...(web ? {
      adapter: { id: "playwright" as const },
      baseUrl: "https://approved.example.test",
      scope: { allowHosts: ["approved.example.test"], pathPrefixes: ["/"] },
      templateCorpus: undefined,
    } : {
      adapter: { id: "airtest-poco" as const, endpoint: "http://127.0.0.1:8765", initialTarget: { targetId: `${platform}-device`, kind: "device" as const } },
      scope: { allowHosts: ["127.0.0.1"], native: { appId: "fixture.app", surfaces: [platform], denyZones: [] } },
    }),
  };
  if (web) delete (result as { templateCorpus?: ExplorationCharter["templateCorpus"] }).templateCorpus;
  return result as ExplorationCharter;
}

async function createSignedAcceptanceEntry(root: string, platform: ExplorationCharter["platform"], privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], mutation: AcceptanceMutation = {}): Promise<ExplorationAcceptanceIndexEntry> {
  const laneCharter = acceptanceCharter(platform, root);
  const config = { mode: "adaptive-explore", seed: laneCharter.seed };
  const created = await createExplorationSession(laneCharter, config, root);
  const native = platform === "windows" || platform === "android" || platform === "ios";
  const capability: ExplorationCapabilitySnapshot = capabilitySnapshotFromAdapter({
    charter: laneCharter,
    adapterId: native ? "airtest-poco" : "playwright",
    revision: native ? "airtest-poco-test" : "playwright-test",
    observedTargetRevision: laneCharter.targetRevision,
    runtimePlatform: native ? platform : undefined,
    targetKinds: [native ? "device" : "page"],
    observationCapabilities: native ? ["screen", "template-match"] : ["screen"],
    actionCapabilities: ["tap", "click"],
    evidenceCapabilities: ["screenshot", "video"],
    connected: true,
    liveness: { connected: true, responsive: true },
    bridgeDigest: native ? `sha256:${"b".repeat(64)}` : explorationDigest({ transport: "playwright/v1", origin: new URL(laneCharter.baseUrl!).origin, targetRevision: laneCharter.targetRevision }),
    ...(native ? { templateCorpusDigest: laneCharter.templateCorpus?.sha256, device: { appId: laneCharter.scope.native?.appId }, display: { width: 1080, height: 1920, orientation: "portrait" as const, surface: platform } } : {}),
  });
  await writeCapabilitySnapshot(created.paths, capability);
  // Native adapters retain the raw bridge capability digest separately from
  // the normalized session projection. This is intentionally different in
  // the positive fixture so the aggregator cannot accidentally require the
  // two bindings to be identical. Mutate only the persisted snapshot here;
  // the session event keeps the normalized digest produced by the writer.
  const nativeRawCapabilityDigest = native ? `sha256:${"c".repeat(64)}` : capability.rawCapabilityDigest!;
  if (native) {
    const storedCapability = JSON.parse(await readFile(created.paths.capability, "utf8")) as ExplorationCapabilitySnapshot;
    storedCapability.rawCapabilityDigest = nativeRawCapabilityDigest;
    await writeFile(created.paths.capability, `${JSON.stringify(storedCapability)}\n`, "utf8");
  }
  if (mutation.capabilityDigestMismatch) await appendSessionEvent(created.paths, { type: "capability-snapshot", payload: { capabilityDigest: `sha256:${"f".repeat(64)}` } });
  const targetManifestBase = {
    schemaVersion: "lakda/exploration-target-manifest/v1" as const,
    manifestId: `acceptance-target-${platform}`,
    status: "ready" as const,
    owner: "acceptance-test-operator",
    charterDigest: explorationDigest(laneCharter),
    configDigest: explorationDigest(config),
    targetRevision: laneCharter.targetRevision,
    platform,
    adapterId: native ? "airtest-poco" as const : "playwright" as const,
    executionMode: "real" as const,
    target: native ? {
      identity: { kind: "native" as const, appId: laneCharter.scope.native!.appId, appRevision: laneCharter.targetRevision, deviceAliasDigest: `sha256:${"d".repeat(64)}` },
      templateCorpusDigest: laneCharter.templateCorpus!.sha256,
    } : {
      identity: { kind: "web" as const, origin: new URL(laneCharter.baseUrl!).origin, pathPrefixes: ["/"], revisionProbe: { kind: "response-header" as const, name: "x-lakda-revision" } },
    },
    safety: { allowMutationKinds: ["none"], resetProcedureRef: "operator-reset", killSwitchRef: "operator-kill" },
    bridgeBinding: { capabilityDigest: mutation.rawCapabilityDigestMismatch ? `sha256:${"d".repeat(64)}` : nativeRawCapabilityDigest, bridgeDigest: native ? `sha256:${"b".repeat(64)}` : explorationDigest({ transport: "playwright/v1", origin: new URL(laneCharter.baseUrl!).origin, targetRevision: laneCharter.targetRevision }) },
  };
  const unsignedTarget = { ...targetManifestBase, signature: { algorithm: "ed25519" as const, keyId: "acceptance-test-key", validFrom: "2020-01-01T00:00:00.000Z", validUntil: "2099-01-01T00:00:00.000Z", approvalEvidenceRef: "acceptance-test-approval", signedPayloadDigest: `sha256:${"0".repeat(64)}`, valueBase64: "AA==" } } as ExplorationTargetManifest;
  const targetPayload = targetManifestSigningPayload(unsignedTarget);
  const targetManifest: ExplorationTargetManifest = { ...unsignedTarget, signature: { ...unsignedTarget.signature, signedPayloadDigest: `sha256:${sha256(targetPayload)}`, valueBase64: sign(null, Buffer.from(targetPayload, "utf8"), privateKey).toString("base64") } };
  await writeFile(laneCharter.targetManifestPath!, `${JSON.stringify(targetManifest)}\n`, "utf8");
  const targetManifestEvidence = await loadSignedExplorationTargetManifest(laneCharter.targetManifestPath!, laneCharter, explorationDigest(config));
  if (!mutation.omitTargetManifest) await copyTargetManifest(created.paths, laneCharter.targetManifestPath!, targetManifestEvidence.sha256);
  const runId = `acceptance-run-${platform}`;
  const runRoot = join(root, `${platform}-run`);
  const runArtifactPath = join(runRoot, "artifacts", "run-marker.txt");
  await mkdir(join(runRoot, "exports"), { recursive: true });
  await mkdir(join(runRoot, "artifacts"), { recursive: true });
  await writeFile(runArtifactPath, `real-run-${platform}\n`, "utf8");
  const runArtifactDigest = await fileDigest(runArtifactPath);
  const runManifestPath = join(runRoot, "exports", "artifact-manifest.json");
  const runManifest = {
    schema_version: "HATE/v1",
    run_id: runId,
    run_attempt: 1,
    commit_sha: "0000000",
    artifacts: [{
      artifact_id: "run-marker",
      kind: "other",
      path: "artifacts/run-marker.txt",
      sha256: `sha256:${runArtifactDigest.sha256}`,
      size_bytes: runArtifactDigest.size,
      classification: "internal",
      redaction_status: "not_required",
      redaction_rule_version: "lakda-redact-v1",
      safe_for_summary: false,
      public_exposure: "none",
      retention: { class: "default", days: 14 },
      security_checks: { secrets_scan: "pass", pii_scan: "pass" },
  }],
  };
  await writeFile(runManifestPath, `${JSON.stringify(runManifest)}\n`, "utf8");
  if (!mutation.omitRunManifest) await registerRunManifest(created.paths, runId, runManifestPath);
  if (mutation.runSetMismatch) await appendSessionEvent(created.paths, { type: "checkpoint", payload: { runId: "rogue-run" } });
  await writeCheckpoint(created.paths, { runId, actionCount: 0 });
  await appendSessionEvent(created.paths, { type: "session-started", status: "running", payload: { runId, targetManifestDigest: mutation.targetManifestDigestMismatch ? `sha256:${"e".repeat(64)}` : targetManifestEvidence.sha256 } });
  await appendSessionEvent(created.paths, { type: "session-completed", status: "completed", payload: { runId, technicalOutcome: mutation.technicalOutcome ?? "passed" } });
  await buildExplorationReport(created.paths);
  const report = JSON.parse(await readFile(created.paths.report, "utf8")) as Record<string, unknown>;
  if (mutation.captureFailure) report.capture = { ...(report.capture as Record<string, unknown>), failures: ["capture-timeout"] };
  if (mutation.unexpectedBlocker) report.blockers = [REAL_LANE_ACCEPTANCE_REQUIRED, "operator-unexpected-blocker"];
  if (mutation.captureFailure || mutation.unexpectedBlocker) {
    await writeFile(created.paths.report, `${JSON.stringify(report)}\n`, "utf8");
    await buildSessionHateManifest(created.paths, (await loadExplorationSession(created.paths.root)).session);
  }
  if (mutation.securityFailure) {
    const hate = JSON.parse(await readFile(created.paths.hateManifest, "utf8")) as { artifacts?: Array<{ security_checks?: { secrets_scan?: string } }> };
    if (hate.artifacts?.[0]?.security_checks) hate.artifacts[0].security_checks.secrets_scan = "fail";
    await writeFile(created.paths.hateManifest, `${JSON.stringify(hate)}\n`, "utf8");
  }
  if (mutation.eventTamper) {
    const lines = (await readFile(created.paths.events, "utf8")).split(/\r?\n/).filter(Boolean);
    const startedIndex = lines.findIndex(line => line.includes('"type":"session-started"'));
    if (startedIndex >= 0) lines[startedIndex] = lines[startedIndex]!.replace("session-started", "session-started-tampered");
    await writeFile(created.paths.events, `${lines.join("\n")}\n`, "utf8");
  }
  if (mutation.sessionJsonTamper) {
    const session = JSON.parse(await readFile(created.paths.session, "utf8")) as Record<string, unknown>;
    session.technicalOutcome = "failed";
    await writeFile(created.paths.session, `${JSON.stringify(session)}\n`, "utf8");
  }
  if (mutation.sessionTargetDigestTamper) {
    const session = JSON.parse(await readFile(created.paths.session, "utf8")) as Record<string, unknown>;
    session.targetManifestDigest = `sha256:${"d".repeat(64)}`;
    await writeFile(created.paths.session, `${JSON.stringify(session)}\n`, "utf8");
  }
  const reportDigest = await fileDigest(created.paths.report);
  const hateDigest = await fileDigest(created.paths.hateManifest);
  const unsigned = {
    sessionId: created.session.sessionId,
    platform,
    executionMode: "real" as const,
    targetRevision: laneCharter.targetRevision,
    sessionPath: created.session.sessionId,
    reportPath: `${created.session.sessionId}/report.json`,
    reportSha256: `sha256:${reportDigest.sha256}`,
    hateManifestPath: `${created.session.sessionId}/exports/artifact-manifest.json`,
    hateManifestSha256: `sha256:${hateDigest.sha256}`,
  };
  const payload = canonicalJson(unsigned);
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      keyId: "acceptance-test-key",
      signedPayloadDigest: `sha256:${sha256(payload)}`,
      valueBase64: sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64"),
    },
  };
}

test("exploration charter and visual candidate contracts are versioned and normalized", () => {
  assertExplorationCharter(charter);
  const region = normalizeVisualRegion({ x: 100, y: 200, width: 200, height: 100 }, { width: 1000, height: 1000 });
  const candidate = {
    schemaVersion: "lakda/adaptive-contracts/v1" as const, candidateId: visualCandidateId({ sourceFingerprint: "state:test", actionKind: "tap", region, identity: { resolution: "1000x1000", orientation: "portrait", surface: "android" } }), adapterId: "airtest-poco", targetRef: { targetId: "device-1", kind: "device" as const }, sourceFingerprint: "state:test", actionKind: "tap", locatorRecipe: { strategy: "image" as const, value: "start-button" }, generatedBy: { ruleId: "airtest-template", observationId: "obs-1", reason: "template-match" }, risk: { weight: 1 }, mutationKind: "none" as const,
    visual: { source: "airtest-template" as const, confidence: 0.9, region, requiredCapabilities: ["screen", "template-match"], identity: { resolution: "1000x1000", orientation: "portrait" as const, surface: "android" } },
  };
  assertAdaptiveContract(candidate);
  assertVisualCandidate(candidate, ["screen", "template-match"]);
  expect(region).toEqual({ x: 0.1, y: 0.2, width: 0.2, height: 0.1 });
  expect(candidate.candidateId).toMatch(/^visual-/);
  assertCandidateDiscoveryResult({ candidates: [candidate], coverageDebt: [] });
});

test("exploration charter keeps its autonomous generator, scope, and capability binding fail-closed", () => {
  expect(adaptiveConfigFromCharter(charter).generator).toEqual(charter.generator);
  const outsideScope: ExplorationCharter = {
    ...charter,
    platform: "pc-web",
    adapter: { id: "playwright" },
    baseUrl: "http://127.0.0.1/outside",
    scope: { allowHosts: ["127.0.0.1"], pathPrefixes: ["/approved"] },
  };
  expect(() => assertExplorationCharter(outsideScope)).toThrow(/path/);

  const capability = capabilitySnapshotFromAdapter({
    charter,
    adapterId: "airtest-poco",
    revision: "bridge/v1",
    runtimePlatform: "android",
    targetKinds: ["device"],
    observationCapabilities: ["screen", "template-match"],
    actionCapabilities: ["tap", "back"],
    evidenceCapabilities: ["screenshot", "sampled-frames/v1"],
    device: { appId: "fixture.app" },
    display: { width: 1080, height: 1920, orientation: "portrait", surface: "android" },
    liveness: { connected: true, responsive: true },
    templateCorpusDigest: charter.templateCorpus?.sha256,
  });
  assertExplorationCapabilityForCharter(charter, capability);
  expect(capability.rawCapabilityDigest).toBe(capabilitySnapshotDigest({ ...capability, capturedAt: "2026-08-02T00:00:00.000Z" }));
  expect(() => assertExplorationCapabilityForCharter(charter, { ...capability, liveness: { connected: false, responsive: false } })).toThrow(/operator bridge/);
  expect(() => assertExplorationCapabilityForCharter(charter, { ...capability, device: { platform: "ios" } })).toThrow(/platform/);
  expect(() => assertExplorationCapabilityForCharter(charter, { ...capability, capture: { ...capability.capture, sampledFrames: false } })).toThrow(/videoまたは明示有効なsampled frames/);
  expect(() => assertExplorationCharter({ ...charter, executionMode: "real", targetManifestPath: "manifest.json" } as unknown)).toThrow(/trustStorePath/);
});

test("native template corpus binding rejects missing or mismatched observed digests", () => {
  const digest = charter.templateCorpus!.sha256;
  expect(() => assertTemplateCorpusBinding(charter, undefined)).toThrow(/実使用template corpus digest/);
  expect(() => assertTemplateCorpusBinding(charter, `sha256:${"0".repeat(64)}`)).toThrow(/Charterと不一致/);
  expect(() => assertTemplateCorpusBinding(charter, digest, { target: { templateCorpusDigest: `sha256:${"1".repeat(64)}` } } as ExplorationTargetManifest)).toThrow(/target manifestと不一致/);
  expect(() => assertTemplateCorpusBinding(charter, digest, { target: { templateCorpusDigest: digest } } as ExplorationTargetManifest)).not.toThrow();
});

test("raw bridge capability digest is retained and resume rejects unknown capability drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-raw-capability-"));
  try {
    const normalized = capabilitySnapshotFromAdapter({ charter, adapterId: "airtest-poco", revision: "bridge/v1", runtimePlatform: "android", targetKinds: ["device"], observationCapabilities: ["screen", "template-match"], actionCapabilities: ["tap"], evidenceCapabilities: ["screenshot", "sampled-frames/v1"], templateCorpusDigest: charter.templateCorpus!.sha256, rawCapabilityDigest: `sha256:${"a".repeat(64)}`, liveness: { connected: true, responsive: true } });
    const created = await createExplorationSession(charter, { mode: "adaptive-explore", seed: 7 }, root);
    await writeCapabilitySnapshot(created.paths, normalized);
    const loaded = await loadExplorationSession(created.paths.root);
    const persisted = JSON.parse(await readFile(loaded.paths.capability, "utf8")) as ExplorationCapabilitySnapshot;
    expect(persisted.rawCapabilityDigest).toBe(`sha256:${"a".repeat(64)}`);
    expect(loaded.session.capabilityDigest).toBe(capabilitySnapshotDigest(normalized));
    expect(loaded.session.capabilityDigest).not.toBe(persisted.rawCapabilityDigest);
    const changedRaw = { ...persisted, rawCapabilityDigest: `sha256:${"b".repeat(64)}` };
    expect(() => assertResumeCapabilityBinding(persisted, changedRaw)).toThrow(/raw capability digest/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native Charter deny zones reject overlapping visual candidates", () => {
  const config = loadConfig(undefined, {
    mode: "adaptive-explore",
    baseUrl: "http://127.0.0.1",
    explorationPlatform: "android",
    safety: { explorationDenyZones: [{ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }] },
    adaptive: adaptiveConfigFromCharter({ ...charter, scope: { ...charter.scope, native: { ...charter.scope.native!, denyZones: [{ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }] } } }),
  });
  const candidate: ActionCandidate = {
    schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "deny-zone-candidate", adapterId: "airtest-poco", targetRef: { targetId: "device-1", kind: "device" }, sourceFingerprint: "state:test", actionKind: "tap", locatorRecipe: { strategy: "image", value: "blocked" }, generatedBy: { ruleId: "airtest-template", observationId: "obs-1", reason: "template-match" }, risk: { weight: 1 }, mutationKind: "none",
    visual: { source: "airtest-template", confidence: 0.9, region: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 }, requiredCapabilities: ["screen", "template-match"], identity: { resolution: "1080x1920", orientation: "portrait", surface: "android" } },
  };
  expect(evaluateAdaptiveSafety(candidate, config, { actionCount: 0, artifactBytes: 0 })).toEqual({ allowed: false, reason: "native_deny_zone" });
});

test("exploration session persists append-only lifecycle, finding, and report without a Gate verdict", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-session-"));
  try {
    const created = await createExplorationSession(charter, { mode: "adaptive-explore", seed: 7 }, root);
    expect(created.session.status).toBe("draft");
    expect(created.session.charterPath).toBe("charter.json");
    expect(() => resolveRunDirectoryReference(root, "../outside")).toThrow(/path traversal/);
    const capability = capabilitySnapshotFromAdapter({ charter, adapterId: "airtest-poco", revision: "bridge/v1", runtimePlatform: "android", targetKinds: ["device"], observationCapabilities: ["screen", "template-match"], actionCapabilities: ["tap"], evidenceCapabilities: ["screenshot", "sampled-frames/v1"], templateCorpusDigest: charter.templateCorpus!.sha256, liveness: { connected: true, responsive: true } });
    await writeCapabilitySnapshot(created.paths, capability);
    expect((await loadExplorationSession(created.paths.root)).session.capabilityDigest).toBe(capability.rawCapabilityDigest);
    await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
    await appendSessionEvent(created.paths, { type: "session-paused", status: "paused", payload: { actionCount: 1, lastFingerprint: "state:test" } });
    await writeFinding(created.paths, { schemaVersion: "lakda/exploration-finding/v1", findingId: "finding-1", sessionId: created.session.sessionId, platform: "android", kind: "unknown-screen", status: "exploratory-finding", severity: "warning", message: "unknown screen", observedAt: new Date().toISOString(), targetRevision: charter.targetRevision, oracleRefs: ["oracle:unknown"], evidenceRefs: [], requirementRefs: ["REQ-AX-008"] });
    const report = await buildExplorationReport(created.paths);
    expect(report.goNoGo).toBe("external-qeg-required");
    expect(report.findings).toHaveLength(1);
    expect(report.status).toBe("paused");
    expect(explorationDigest(charter)).toBe(created.session.charterDigest);
    const loaded = await loadExplorationSession(created.paths.session);
    expect(loaded.session.eventCount).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(await readFile(created.paths.report, "utf8")).goNoGo).toBe("external-qeg-required");
    expect(existsSync(created.paths.hateManifest)).toBe(true);
    const sessionManifest = JSON.parse(await readFile(created.paths.hateManifest, "utf8")) as { schema_version: string; run_id: string; artifacts: Array<{ path: string }> };
    expect(sessionManifest.schema_version).toBe("HATE/v1");
    expect(sessionManifest.run_id).toBe(created.session.sessionId);
    expect(sessionManifest.artifacts.some(artifact => artifact.path === "charter.json")).toBe(true);
    await expect(writeFinding(created.paths, { schemaVersion: "lakda/exploration-finding/v1", findingId: "foreign-finding", sessionId: "other-session", platform: "android", kind: "unknown-screen", status: "exploratory-finding", severity: "warning", message: "wrong session", observedAt: new Date().toISOString(), targetRevision: charter.targetRevision, oracleRefs: [], evidenceRefs: [], requirementRefs: [] })).rejects.toThrow(/sessionId/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exploration session recovers a projection when the append-only event log is ahead", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-session-recovery-"));
  try {
    const created = await createExplorationSession(charter, { mode: "adaptive-explore", seed: 7 }, root);
    const staleProjection = await readFile(created.paths.session);
    await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
    // Simulate a crash after the event append but before projection replacement.
    await writeFile(created.paths.session, staleProjection);
    const recovered = await loadExplorationSession(created.paths.root);
    expect(recovered.session.status).toBe("running");
    expect(recovered.session.eventCount).toBe(2);
    expect(JSON.parse(await readFile(created.paths.session, "utf8")).eventCount).toBe(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("session projection repair serializes with a concurrent append", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-session-concurrent-repair-"));
  try {
    const created = await createExplorationSession(charter, { mode: "adaptive-explore", seed: 7 }, root);
    const staleProjection = await readFile(created.paths.session);
    await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
    await writeFile(created.paths.session, staleProjection);
    await Promise.all([
      loadExplorationSession(created.paths.root),
      appendSessionEvent(created.paths, { type: "session-paused", status: "paused", payload: { actionCount: 1 } }),
    ]);
    const final = await loadExplorationSession(created.paths.root);
    expect(final.session.status).toBe("paused");
    expect(final.session.eventCount).toBe(3);
    expect((await readFile(created.paths.events, "utf8")).split(/\r?\n/).filter(Boolean)).toHaveLength(3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator controls are queued atomically and fork creates an explicit child session", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-control-"));
  try {
    const controlledCharter: ExplorationCharter = { ...charter, charterId: "control-charter", outputDir: join(root, "runs") };
    const sessionsRoot = join(root, "explorations");
    const created = await createExplorationSession(controlledCharter, { mode: "adaptive-explore", seed: controlledCharter.seed }, sessionsRoot);
    await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
    await expect(runCli(["explore", "pause", "--session", created.paths.root])).resolves.toBe(0);
    await expect(runCli(["explore", "bookmark", "--session", created.paths.root])).resolves.toBe(0);
    await expect(runCli(["explore", "kill", "--session", created.paths.root])).resolves.toBe(0);
    const controls = await Promise.all((await readdir(created.paths.control)).map(async name => JSON.parse(await readFile(join(created.paths.control, name), "utf8")) as { command: string; requestId: string }));
    expect(controls.map(control => control.command).sort()).toEqual(["bookmark", "kill", "pause"]);
    expect(new Set(controls.map(control => control.requestId)).size).toBe(3);

    await expect(runCli(["explore", "fork", "--session", created.paths.root])).resolves.toBe(0);
    const sessionDirectories = await readdir(sessionsRoot);
    expect(sessionDirectories).toHaveLength(2);
    const childDirectory = sessionDirectories.find(name => join(sessionsRoot, name) !== created.paths.root);
    if (!childDirectory) throw new Error("fork child session is missing");
    const child = await loadExplorationSession(join(sessionsRoot, childDirectory));
    const childEvents = (await readFile(child.paths.events, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line) as { type: string; payload?: Record<string, unknown> });
    expect(child.session.status).toBe("draft");
    expect(childEvents).toContainEqual(expect.objectContaining({ type: "session-forked", payload: expect.objectContaining({ parentSessionId: created.session.sessionId, blockers: ["operator-approved-fork"] }) }));
    expect((await loadExplorationSession(created.paths.root)).session.status).toBe("running");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bridge supplied unknown-screen coverage debt becomes a finding with screenshot evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-unknown-screen-"));
  const observation: Observation = {
    schemaVersion: "lakda/adaptive-contracts/v1", observationId: "unknown-observation", observedAt: "2026-08-02T00:00:00.000Z",
    targetRef: { targetId: "device-1", kind: "device" }, completeness: "complete", ui: { screen: "unknown" }, forms: [], dialogs: [],
    topology: { activeTargetId: "device-1" }, obligations: {}, provenance: { adapterId: "airtest-poco", runtime: "fixture", capabilityRevision: "bridge/v1" },
  };
  let evidence: EvidenceArtifactRef | undefined;
  const adapter: AdaptiveAdapter = {
    capabilities: () => ({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "bridge/v1", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen", "template-match", "candidate-discovery"], evidenceCapabilities: ["screenshot"], recoveryStrategies: ["back"] }),
    observe: async () => observation,
    generateCandidates: async () => [],
    discoverCandidates: async () => ({ candidates: [], coverageDebt: [{ schemaVersion: "lakda-coverage-debt/v1", debtId: "unknown-1", reason: "unknown-screen", actionKind: "visual-observation", scope: "unavailable", targetFingerprint: "state:unknown" }] }),
    execute: async () => { throw new Error("no candidate must execute on an unknown screen"); },
    recover: async () => ({ recovered: false, strategy: "back", evidenceRefs: [] }),
    captureEvidence: async request => {
      if (!request.stagingDir) throw new Error("capture stagingDir is required");
      const artifactDir = join(request.stagingDir, "artifacts");
      const artifactPath = join(artifactDir, "failure.png");
      await mkdir(artifactDir, { recursive: true });
      await writeFile(artifactPath, Buffer.from("fixture-screen"));
      const digest = await fileDigest(artifactPath);
      evidence = { schemaVersion: "lakda/adaptive-contracts/v1", artifactId: "screen-1", path: "artifacts/failure.png", sha256: digest.sha256, size: digest.size, classification: "internal", redactionStatus: "pending", securityStatus: "not_applicable" };
      return [evidence];
    },
  };
  try {
    const config = loadConfig(undefined, {
      baseUrl: "http://127.0.0.1", outputDir: root, mode: "adaptive-explore", explorationPlatform: "android", seed: 7,
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "airtest-poco", endpoint: "http://127.0.0.1:8765", initialTarget: observation.targetRef }, generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" },
        stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1_000, stableWindowMs: 20 }, fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" }, recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 }, safety: { allowTargetKinds: ["device"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const collector = await ArtifactCollector.create(config, "adaptive-explore");
    const observations: Observation[] = [];
    const oracleResults: OracleResult[] = [];
    const candidateSnapshots: CandidateSnapshot[] = [];
    const generatedInputs: GeneratedInput[] = [];
    const result = await observeCandidateSet({ config, collector, adapter, activeTargets: () => [observation.targetRef], graph: new StateGraph(), trace: [], observations, observationsByFingerprint: new Map(), oracleResults, candidateSnapshots, generatedInputs, killSwitch: new KillSwitch(), timeoutQuarantine: new Map(), actions: 0, replay: false });
    expect(result.safeCandidates).toEqual([]);
    expect(collector.findingDetected).toBe(true);
    expect(oracleResults).toHaveLength(1);
    expect(evidence).toBeDefined();
    expect(oracleResults[0]?.evidenceRefs).toEqual([evidence]);
    expect(candidateSnapshots[0]?.coverageDebt[0]?.reason).toBe("unknown-screen");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native fixture reports stay pending_external until real acceptance is attached", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-native-"));
  try {
    const created = await createExplorationSession(charter, { mode: "adaptive-explore", seed: 7 }, root);
    await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
    await appendSessionEvent(created.paths, { type: "session-completed", status: "completed" });
    const report = await buildExplorationReport(created.paths);
    expect(report.executionMode).toBe("fixture");
    expect(report.status).toBe("pending_external");
    expect(report.blockers).toContain("real-lane-acceptance-required");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explore run creates a report through the existing adaptive runner", async () => {
  const fixture = await startFixture(() => ({ body: "<main><h1>Exploration fixture</h1></main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-cli-"));
  const charterPath = join(root, "charter.json");
  try {
    await writeFile(charterPath, JSON.stringify({ ...charter, charterId: "cli-charter", platform: "pc-web", adapter: { id: "playwright" }, baseUrl: fixture.baseUrl, outputDir: join(root, "runs"), capture: { ...charter.capture, sampledFrames: { enabled: false, intervalMs: 1000, maxFrames: 1, maxBytes: 1_000_000, source: "playwright", stopTimeoutMs: 5_000 } } }), "utf8");
    await expect(runCli(["explore", "run", "--charter", charterPath])).resolves.toBe(0);
    const sessions = await (await import("node:fs/promises")).readdir(join(root, "explorations"));
    expect(sessions).toHaveLength(1);
    const session = await loadExplorationSession(join(root, "explorations", sessions[0]!));
    expect(session.session.lastRunDir).toMatch(/^lakda-run-/);
    expect(session.session.lastRunDir).not.toMatch(/[\\/]/);
    expect(session.session.runManifestRefs).toHaveLength(1);
    expect(existsSync(session.paths.hateManifest)).toBe(true);
    const manifest = JSON.parse(await readFile(session.paths.hateManifest, "utf8")) as { artifacts: Array<{ path: string; sha256: string }> };
    const copiedRunManifest = manifest.artifacts.find(artifact => artifact.path.startsWith("run-manifests/") && artifact.path.endsWith(".json"));
    expect(copiedRunManifest?.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("real Web exploration stays pending_external until the five-lane acceptance index verifies it", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-real-web-"));
  const realCharter: ExplorationCharter = {
    ...charter,
    charterId: "real-web-charter",
    platform: "pc-web",
    executionMode: "real",
    baseUrl: "https://approved.example.test",
    adapter: { id: "playwright" },
    scope: { allowHosts: ["approved.example.test"], pathPrefixes: ["/"] },
    targetManifestPath: join(root, "target-manifest.json"),
    trustStorePath: join(root, "trust-store.json"),
  };
  try {
    const created = await createExplorationSession(realCharter, { mode: "adaptive-explore", seed: 7 }, root);
    await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
    await appendSessionEvent(created.paths, { type: "session-completed", status: "completed" });
    const report = await buildExplorationReport(created.paths);
    expect(report.status).toBe("pending_external");
    expect(report.acceptanceStatus).toBe("pending_external");
    expect(report.blockers).toContain("real-lane-acceptance-required");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real exploration preflight rejection returns exit 2 before target connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-preflight-"));
  const charterPath = join(root, "charter.json");
  try {
    await writeFile(charterPath, JSON.stringify({ ...charter, charterId: "preflight-charter", platform: "pc-web", executionMode: "real", adapter: { id: "playwright" }, baseUrl: "https://approved.example.test", scope: { allowHosts: ["approved.example.test"], pathPrefixes: ["/"] }, targetManifestPath: join(root, "missing-manifest.json"), trustStorePath: join(root, "trust-store.json"), outputDir: join(root, "runs") }), "utf8");
    expect(await runCli(["explore", "run", "--charter", charterPath])).toBe(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("five-lane acceptance aggregator keeps missing real lanes pending_external", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-acceptance-index-"));
  try {
    const indexPath = join(root, "acceptance-index.json");
    const trustStorePath = join(root, "trust-store.json");
    await writeFile(indexPath, JSON.stringify({ schemaVersion: "lakda/exploration-acceptance-index/v1", indexId: "acceptance-index-test", requiredLanes: ["pc-web", "mobile-web", "windows", "android", "ios"], entries: [] }), "utf8");
    await writeFile(trustStorePath, JSON.stringify({ keys: [] }), "utf8");
    const aggregate = await aggregateExplorationAcceptance(indexPath, trustStorePath);
    expect(aggregate.status).toBe("pending_external");
    expect(aggregate.verifiedLanes).toEqual([]);
    expect(aggregate.blockers).toContain("pc-web:acceptance-required");
    expect(aggregate.blockers).toContain("ios:acceptance-required");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("five-lane acceptance aggregator resolves the real-lane self-reference sentinel", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-acceptance-real-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await writeFile(join(root, "trust-store.json"), JSON.stringify({ keys: [{ keyId: "acceptance-test-key", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }] }), "utf8");
    const entries: ExplorationAcceptanceIndexEntry[] = [];
    for (const platform of ["pc-web", "mobile-web", "windows", "android", "ios"] as const) entries.push(await createSignedAcceptanceEntry(root, platform, privateKey));
    const indexPath = join(root, "acceptance-index.json");
    await writeFile(indexPath, JSON.stringify({ schemaVersion: "lakda/exploration-acceptance-index/v1", indexId: "acceptance-index-real", requiredLanes: ["pc-web", "mobile-web", "windows", "android", "ios"], entries }), "utf8");
    const aggregate = await aggregateExplorationAcceptance(indexPath, join(root, "trust-store.json"));
    expect(aggregate.status).toBe("eligible");
    expect(aggregate.verifiedLanes).toEqual(["pc-web", "mobile-web", "windows", "android", "ios"]);
    expect(aggregate.blockers).toEqual([]);
    expect(aggregate.entries.every(entry => entry.status === "verified")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("acceptance aggregator rejects a session path redirected through a symlink or junction", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-acceptance-link-"));
  const outside = await mkdtemp(join(tmpdir(), "lakda-exploration-acceptance-outside-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trustStorePath = join(root, "trust-store.json");
    await writeFile(trustStorePath, JSON.stringify({ keys: [{ keyId: "acceptance-test-key", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }] }), "utf8");
    const entry = await createSignedAcceptanceEntry(root, "pc-web", privateKey);
    const sessionLink = join(root, entry.sessionPath);
    const outsideSession = join(outside, "session");
    await rename(sessionLink, outsideSession);
    await symlink(outsideSession, sessionLink, process.platform === "win32" ? "junction" : "dir");
    const indexPath = join(root, "acceptance-index.json");
    await writeFile(indexPath, JSON.stringify({ schemaVersion: "lakda/exploration-acceptance-index/v1", indexId: "acceptance-index-link", requiredLanes: ["pc-web", "mobile-web", "windows", "android", "ios"], entries: [entry] }), "utf8");
    await expect(aggregateExplorationAcceptance(indexPath, trustStorePath)).rejects.toThrow(/symlink|reparse|physical root/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("acceptance index rejects fixture execution mode instead of promoting it to a real lane", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-acceptance-fixture-"));
  try {
    const indexPath = join(root, "acceptance-index.json");
    const fixtureEntry = {
      sessionId: "fixture-session",
      platform: "pc-web",
      executionMode: "fixture",
      targetRevision: "fixture-v1",
      sessionPath: "fixture-session",
      reportPath: "fixture-session/report.json",
      reportSha256: `sha256:${"a".repeat(64)}`,
      hateManifestPath: "fixture-session/exports/artifact-manifest.json",
      hateManifestSha256: `sha256:${"b".repeat(64)}`,
      signature: { algorithm: "ed25519", keyId: "fixture", signedPayloadDigest: `sha256:${"c".repeat(64)}`, valueBase64: "AA==" },
    };
    await writeFile(indexPath, JSON.stringify({ schemaVersion: "lakda/exploration-acceptance-index/v1", indexId: "acceptance-index-fixture", requiredLanes: ["pc-web", "mobile-web", "windows", "android", "ios"], entries: [fixtureEntry] }), "utf8");
    await writeFile(join(root, "trust-store.json"), JSON.stringify({ keys: [] }), "utf8");
    await expect(aggregateExplorationAcceptance(indexPath, join(root, "trust-store.json"))).rejects.toThrow(/schema/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("acceptance aggregator rejects signed/HATE-valid entries with technical, capture, or unexpected report failures", async () => {
  const cases: Array<{ mutation: AcceptanceMutation; blocker: string }> = [
    { mutation: { technicalOutcome: "failed" }, blocker: "pc-web:technical-outcome-not-passed" },
    { mutation: { captureFailure: true }, blocker: "pc-web:capture-failures-present" },
    { mutation: { unexpectedBlocker: true }, blocker: "pc-web:unexpected-report-blocker" },
  ];
  for (const [index, current] of cases.entries()) {
    const root = await mkdtemp(join(tmpdir(), `lakda-exploration-acceptance-negative-${index}-`));
    try {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      await writeFile(join(root, "trust-store.json"), JSON.stringify({ keys: [{ keyId: "acceptance-test-key", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }] }), "utf8");
      const entry = await createSignedAcceptanceEntry(root, "pc-web", privateKey, current.mutation);
      const indexPath = join(root, "acceptance-index.json");
      await writeFile(indexPath, JSON.stringify({ schemaVersion: "lakda/exploration-acceptance-index/v1", indexId: `acceptance-index-negative-${index}`, requiredLanes: ["pc-web", "mobile-web", "windows", "android", "ios"], entries: [entry] }), "utf8");
      const aggregate = await aggregateExplorationAcceptance(indexPath, join(root, "trust-store.json"));
      expect(aggregate.status).toBe("rejected");
      expect(aggregate.entries[0]?.status).toBe("rejected");
      expect(aggregate.blockers).toContain(current.blocker);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("acceptance aggregator rejects real labels without bound target, capability, run, chain, or security evidence", async () => {
  const cases: Array<{ mutation: AcceptanceMutation; blocker: string; platform?: ExplorationCharter["platform"] }> = [
    { mutation: { omitTargetManifest: true }, blocker: "pc-web:target-manifest-invalid" },
    { mutation: { targetManifestDigestMismatch: true }, blocker: "pc-web:target-manifest-digest-mismatch" },
    { mutation: { capabilityDigestMismatch: true }, blocker: "pc-web:capability-digest-mismatch" },
    { mutation: { omitRunManifest: true }, blocker: "pc-web:run-manifest-ref-missing" },
    { mutation: { runSetMismatch: true }, blocker: "pc-web:run-manifest-set-mismatch" },
    { mutation: { eventTamper: true }, blocker: "pc-web:探索session event log" },
    { mutation: { securityFailure: true }, blocker: "pc-web:session-hate-security-security-scan" },
    { mutation: { sessionJsonTamper: true }, blocker: "session projection" },
    { mutation: { sessionTargetDigestTamper: true }, blocker: "session projection" },
    { mutation: { rawCapabilityDigestMismatch: true }, blocker: "android:target-manifest-capability-binding-mismatch", platform: "android" },
  ];
  for (const [index, current] of cases.entries()) {
    const root = await mkdtemp(join(tmpdir(), `lakda-exploration-acceptance-binding-${index}-`));
    try {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      await writeFile(join(root, "trust-store.json"), JSON.stringify({ keys: [{ keyId: "acceptance-test-key", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }] }), "utf8");
      const entry = await createSignedAcceptanceEntry(root, current.platform ?? "pc-web", privateKey, current.mutation);
      const indexPath = join(root, "acceptance-index.json");
      await writeFile(indexPath, JSON.stringify({ schemaVersion: "lakda/exploration-acceptance-index/v1", indexId: `acceptance-index-binding-${index}`, requiredLanes: ["pc-web", "mobile-web", "windows", "android", "ios"], entries: [entry] }), "utf8");
      const aggregate = await aggregateExplorationAcceptance(indexPath, join(root, "trust-store.json"));
      expect(aggregate.status).toBe("rejected");
      expect(aggregate.entries[0]?.status).toBe("rejected");
      expect(aggregate.blockers.some(blocker => blocker.includes(current.blocker)), `${index}:${current.blocker} blockers=${JSON.stringify(aggregate.blockers)}`).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("pre-hardening exploration session without an event-chain head is rejected without migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-exploration-old-session-"));
  try {
    await writeFile(join(root, "session.json"), JSON.stringify({ schemaVersion: "lakda/exploration-session/v1", sessionId: "old-session", charterDigest: "sha256:" + "a".repeat(64), configDigest: "sha256:" + "b".repeat(64), platform: "pc-web", lane: "pc-web", status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), eventCount: 0, actionCount: 0, runIds: [], findingIds: [] }), "utf8");
    await expect(loadExplorationSession(root)).rejects.toThrow(/旧v1 session/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
