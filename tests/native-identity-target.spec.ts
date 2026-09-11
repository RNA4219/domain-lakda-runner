import { expect, test } from "@playwright/test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mock } from "node:test";
import type { NativeActionRequest, NativeActionResult } from "../src/exploration/native-identity-actions.js";
import { nativeActionLease } from "../src/exploration/native-identity-actions.js";
import type { NativeCaptureRequest, NativeCaptureResult } from "../src/exploration/native-identity-capture.js";
import { readFileSync } from "node:fs";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { adaptiveConfigFromCharter, capabilitySnapshotFromAdapter, type ExplorationCharter } from "../src/exploration/contracts.js";
import { appendSessionEvent, createExplorationSession, writeCapabilitySnapshot } from "../src/exploration/session.js";
import { exploreRunCommand, exploreResumeCommand } from "../src/commands/exploration.js";
import { LoopbackJsonBridge } from "../src/adapters/loopback-json.js";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { loadSignedExplorationTargetManifest, verifySignedExplorationTargetManifestSnapshot, targetManifestSigningPayload, type ExplorationTargetManifest } from "../src/exploration/target-manifest.js";
import { verifyNativeIdentityForTarget, type NativeExplorationTargetManifest } from "../src/exploration/native-identity-target.js";
import { nativeBuildMappingDigest, nativeIdentityDigest, NATIVE_IDENTITY_SOURCES, type NativePlatform, type NativeIdentityObservation } from "../src/exploration/native-identity-contracts.js";
import type { NativeIdentityAcquisition } from "../src/exploration/native-identity-exchange.js";
import { NativeEvidenceVerifier, assertNativeEvidenceEnvelope } from "../src/exploration/native-identity-evidence.js";
import type { ExternalToolBridge } from "../src/adapters/external-bridges.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const trustKeys = [{ keyId: "fixture-operator", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }];
const at = "2026-09-10T12:00:00.000Z", now = Date.parse(at);
const hash = (value: string) => "sha256:" + sha256(value);
const digest = (value: string) => "sha256:" + value.repeat(64);
const missing = Symbol("missing");
function executorFixture() {
  const data = fixture();
  data.manifest.signature.validUntil = new Date(now + 5000).toISOString();
  data.manifest = signed(data.manifest);
  const clock = { wall: now + 1, mono: 100 };
  const wallMock = mock.method(Date, "now", () => clock.wall);
  const monoMock = mock.method(performance, "now", () => clock.mono);
  const sent: NativeActionRequest[] = [];
  let observations = 0;
  const hooks = { observe: () => {}, action: () => {} };
  const bridge = {
    async observeNativeIdentity() { observations++; hooks.observe(); return structuredClone(data.acquisition); },
    async nativeAction(request: NativeActionRequest): Promise<NativeActionResult> {
      sent.push(structuredClone(request));
      const result = { schemaVersion: "lakda/native-action-result/v2" as const, approvalWindow: request.approvalWindow!,
        lease: request.lease, ordinal: request.ordinal, checkedAt: new Date(clock.wall).toISOString(), actionAttempted: true };
      hooks.action();
      return request.operation === "recover" ? { ...result, operation: "recover", result: { recovered: true, strategy: "back", evidenceRefs: [] } }
        : { ...result, operation: "execute", result: { schemaVersion: "lakda/adaptive-contracts/v1", executionId: "execution-1",
          candidateId: request.payload.candidate.candidateId, preFingerprint: request.payload.candidate.sourceFingerprint,
          startedAt: result.checkedAt, endedAt: result.checkedAt, status: "executed", recoveryStatus: "not_required", targetChanges: [],
          settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] } };
    },
  };
  const input = { targetBytes: Buffer.from(JSON.stringify(data.manifest)), charter: data.charter, configDigest: digest("c"), trustKeys: structuredClone(trustKeys), bridge };
  const action = { operation: "recover" as const, payload: { failure: { category: "timeout" as const, messageRef: "fixture-failure" }, context: { runId: "fixture-run", strategy: "back" } } };
  const create = async () => (await import("../src/exploration/native-identity-executor.js")).createNativeIdentityExecutor(input);
  return { data, clock, hooks, input, action, sent, create, observations: () => observations, close: () => { wallMock.mock.restore(); monoMock.mock.restore(); } };
}

test("native executor records observation, intent and receipt without the request body", async () => {
  const context = executorFixture(), records: Array<Record<string, unknown>> = [];
  try {
    Object.assign(context.input, { evidence: { async record(value: Record<string, unknown>) { records.push(structuredClone(value)); } } });
    context.action.payload.failure.messageRef = "fixture-private-failure-body";
    const executor = await context.create();
    await executor.perform(context.action);
    expect(records.map(value => value.kind)).toEqual(["observation", "action-requested", "action-finished"]);
    expect(records[1]).toMatchObject({ requestSha256: nativeIdentityDigest(context.sent[0]) });
    expect(records[2]).toMatchObject({ executionStatus: "completed", actionAttempted: true, receipt: { ordinal: 1 } });
    expect(JSON.stringify(records)).not.toContain("fixture-private-failure-body");
  } finally { context.close(); }
});

test("native executor stops on each evidence failure without retrying the SDK or persistence", async () => {
  for (const phase of ["observation", "action-requested", "action-finished"]) {
    const context = executorFixture(), phases: string[] = [];
    try {
      Object.assign(context.input, { evidence: { async record(value: { kind: string }) {
        phases.push(value.kind);
        if (value.kind === phase) throw new Error("private-storage-error");
      } } });
      if (phase === "observation") await expect(context.create()).rejects.toThrow("native-execution-unavailable");
      else {
        const executor = await context.create();
        await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: phase === "action-finished" });
        await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
      }
      expect(phases.filter(value => value === phase)).toHaveLength(1);
      expect(context.sent).toHaveLength(phase === "action-finished" ? 1 : 0);
    } finally { context.close(); }
  }
});

test("native executor rechecks approval after intent persistence and records a zero-attempt failure", async () => {
  const context = executorFixture(), records: Array<Record<string, unknown>> = [];
  try {
    Object.assign(context.input, { evidence: { async record(value: Record<string, unknown>) {
      records.push(structuredClone(value));
      if (value.kind === "action-requested") context.clock.wall = now + 5000;
    } } });
    const executor = await context.create();
    await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: false });
    expect(context.sent).toHaveLength(0);
    expect(records.at(-1)).toMatchObject({ kind: "action-finished", executionStatus: "failed", actionAttempted: false, receipt: null });
  } finally { context.close(); }
});

async function persistentExecutor(root: string, config: object = {}, captureOverrides: Partial<ExplorationCharter["capture"]> = {}) {
  const context = executorFixture();
  try {
    Object.assign(context.input.charter, { targetManifestPath: "target.json", trustStorePath: "trust.json",
      templateCorpus: { path: "templates.json", version: context.input.charter.templateCorpusVersion, sha256: hash("[]") } });
    context.input.charter.capture.sampledFrames.source = "operator-bridge";
    Object.assign(context.input.charter.capture, captureOverrides);
    context.data.manifest.charterDigest = nativeIdentityDigest(context.input.charter);
    context.data.manifest.target.templateCorpusDigest = context.input.charter.templateCorpus!.sha256;
    context.input.configDigest = nativeIdentityDigest(config);
    context.data.manifest.configDigest = context.input.configDigest;
    context.data.manifest = signed(context.data.manifest);
    context.input.targetBytes = Buffer.from(JSON.stringify(context.data.manifest));
    const created = await createExplorationSession(context.input.charter, config, root);
    const target = { manifest: context.data.manifest, sha256: hash(context.input.targetBytes.toString()) };
    await writeFile(created.paths.targetManifest, context.input.targetBytes);
    await appendSessionEvent(created.paths, { type: "checkpoint", payload: { targetManifestDigest: target.sha256 } });
    const api = await import("../src/exploration/native-identity-evidence-store.js");
    const sink = await api.createSessionNativeEvidenceSink(created.paths, target);
    Object.assign(context.input, { evidence: sink });
    return { ...context, ...created, target, sink, api };
  } catch (error) { context.close(); throw error; }
}

function captureRequest(context: Awaited<ReturnType<typeof persistentExecutor>>, operation: NativeCaptureRequest["operation"], ordinal: number, captureOrdinal = ordinal): NativeCaptureRequest {
  return { schemaVersion: "lakda/native-capture-request/v1", operation, ordinal, captureOrdinal,
    lease: nativeActionLease(context.data.acquisition.observation), approvalWindow: { targetManifestSha256: context.target.sha256,
      validFrom: context.target.manifest.signature.validFrom, validUntil: context.target.manifest.signature.validUntil },
    payload: { runId: "fixture-run", stagingDir: "C:/private-capture-fixture/recording", ...(operation === "screenshot" ? {} : { mode: "video", stopTimeoutMs: 500 }) } };
}

function nativeCaptureFixture(context: Pick<ReturnType<typeof executorFixture>, "clock">) {
  const requests: NativeCaptureRequest[] = [];
  const hooks: { respond(request: NativeCaptureRequest): Promise<void> } = { async respond() {} };
  const send = async (request: NativeCaptureRequest): Promise<NativeCaptureResult> => {
    requests.push(structuredClone(request));
    await hooks.respond(request);
    const cleanup = request.operation === "stop" || request.operation === "discard";
    const refs = request.operation === "start" || request.operation === "discard" ? [] : [{ schemaVersion: "lakda/adaptive-contracts/v1" as const,
      artifactId: "capture-fixture", path: request.operation === "screenshot" ? "artifacts/screenshot.png" : "artifacts/video/0001.mp4",
      sha256: "a".repeat(64), size: 12, classification: "confidential" as const, redactionStatus: "pending" as const, securityStatus: "not_applicable" as const }];
    return { schemaVersion: "lakda/native-capture-result/v1", operation: request.operation, ordinal: request.ordinal, captureOrdinal: request.captureOrdinal,
      requestSha256: nativeIdentityDigest(request), completedAt: new Date(context.clock.wall).toISOString(), result: { accepted: true,
        mode: request.payload.mode ?? "screenshot", artifactRefs: refs, ...(cleanup ? { stopped: true } : {}),
        ...(cleanup && request.payload.mode === "sampled-frames/v1" ? { frameCount: refs.length, byteCount: refs.length * 12 } : {}) } };
  };
  return { send, requests, hooks };
}

test("native capture executor persists capture and action order with independent ordinals", async () => {
  const context = await persistentExecutor(test.info().outputPath("capture-executor")), capture = nativeCaptureFixture(context);
  try {
    Object.assign(context.input.bridge, { nativeCapture: capture.send });
    const executor = await context.create(), payload = captureRequest(context, "start", 1).payload;
    await executor.capture({ operation: "start", payload });
    expect((await context.api.readSessionNativeEvidence(context.paths, context.target)).complete).toBe(false);
    await executor.perform(context.action);
    await executor.capture({ operation: "screenshot", payload: { runId: payload.runId, stagingDir: payload.stagingDir } });
    await executor.capture({ operation: "stop", payload });
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    expect(saved.complete).toBe(true);
    expect(saved.records.map(value => value.evidence.kind)).toEqual(["observation", "capture-requested", "capture-finished", "action-requested", "action-finished", "capture-requested", "capture-finished", "capture-requested", "capture-finished"]);
    expect(capture.requests.map(value => [value.operation, value.ordinal, value.captureOrdinal])).toEqual([["start", 1, 1], ["screenshot", 2, 2], ["stop", 3, 1]]);
    expect(context.sent[0].ordinal).toBe(1);
    expect(JSON.stringify(saved)).not.toContain(payload.stagingDir);
  } finally { context.close(); }
});

test("native capture executor stops an unknown or late start and persists the failed outcome", async () => {
  for (const failure of ["unknown", "late"]) {
    const context = await persistentExecutor(test.info().outputPath("capture-executor-" + failure)), capture = nativeCaptureFixture(context);
    try {
      capture.hooks.respond = async request => {
        if (request.operation !== "start") return;
        if (failure === "unknown") throw new Error("private-capture-error");
        context.clock.wall = now + 6000;
      };
      Object.assign(context.input.bridge, { nativeCapture: capture.send });
      const executor = await context.create();
      await expect(executor.capture({ operation: "start", payload: captureRequest(context, "start", 1).payload })).rejects.toMatchObject({ captureStopped: true });
      expect(capture.requests.map(value => value.operation)).toEqual(["start", "stop"]);
      const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
      expect(saved.complete).toBe(true);
      expect(saved.records[2].evidence).toMatchObject({ kind: "capture-finished", executionStatus: "failed" });
      expect(JSON.stringify(saved)).not.toContain("private-capture-error");
      await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
    } finally { context.close(); }
  }
});

test("native capture executor attempts original cleanup even when evidence storage fails", async () => {
  for (const phase of ["capture-requested", "capture-finished"]) {
    const context = await persistentExecutor(test.info().outputPath("capture-storage-" + phase)), capture = nativeCaptureFixture(context);
    try {
      Object.assign(context.input.bridge, { nativeCapture: capture.send });
      Object.assign(context.input, { evidence: { async record(value: Parameters<typeof context.sink.record>[0]) {
        if (value.kind === phase && (phase === "capture-finished" || (value.kind === "capture-requested" && value.expectation.operation === "screenshot"))) throw new Error("private-storage-error");
        await context.sink.record(value);
      } } });
      const executor = await context.create(), payload = captureRequest(context, "start", 1).payload;
      if (phase === "capture-requested") await executor.capture({ operation: "start", payload });
      await expect(executor.capture({ operation: phase === "capture-requested" ? "screenshot" : "start",
        payload: phase === "capture-requested" ? { runId: payload.runId, stagingDir: payload.stagingDir } : payload })).rejects.toMatchObject({ captureStopped: true });
      expect(capture.requests.map(value => value.operation)).toEqual(["start", "stop"]);
      expect((await context.api.readSessionNativeEvidence(context.paths, context.target)).complete).toBe(false);
      await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
    } finally { context.close(); }
  }
});

test("native capture executor and saved reader enforce the signed capture policy", async () => {
  const context = await persistentExecutor(test.info().outputPath("capture-policy"), {}, { video: "off" }), capture = nativeCaptureFixture(context);
  try {
    Object.assign(context.input.bridge, { nativeCapture: capture.send });
    const executor = await context.create();
    await expect(executor.capture({ operation: "start", payload: captureRequest(context, "start", 1).payload })).rejects.toThrow(/native/);
    expect(capture.requests).toHaveLength(0);
    await expect(saveCapturePair(context, captureRequest(context, "start", 1))).rejects.toThrow(/native/);
  } finally { context.close(); }
});

test("native capture executor accepts sampled frame bounds and refuses an increased budget", async () => {
  const frames = { enabled: true, intervalMs: 1000, maxFrames: 3, maxBytes: 10000, source: "operator-bridge" as const, stopTimeoutMs: 500 };
  for (const variant of ["valid", "interval", "frames", "bytes", "timeout", "disabled", "source"]) {
    const configured = { ...frames, ...(variant === "disabled" ? { enabled: false } : {}), ...(variant === "source" ? { source: "playwright" as const } : {}) };
    const context = await persistentExecutor(test.info().outputPath("capture-budget-" + variant), {}, { sampledFrames: configured }), capture = nativeCaptureFixture(context);
    try {
      Object.assign(context.input.bridge, { nativeCapture: capture.send });
      const executor = await context.create();
      const payload = { ...captureRequest(context, "start", 1).payload, mode: "sampled-frames/v1" as const,
        intervalMs: variant === "interval" ? 999 : 1000, maxFrames: variant === "frames" ? 4 : 3,
        maxBytes: variant === "bytes" ? 10001 : 10000, stopTimeoutMs: variant === "timeout" ? 501 : 500 };
      if (variant === "valid") {
        await executor.capture({ operation: "start", payload });
        await executor.capture({ operation: "discard", payload });
        expect((await context.api.readSessionNativeEvidence(context.paths, context.target)).complete).toBe(true);
      } else {
        await expect(executor.capture({ operation: "start", payload })).rejects.toThrow(/native/);
        expect(capture.requests).toHaveLength(0);
      }
    } finally { context.close(); }
  }
});

async function saveCapturePair(context: Awaited<ReturnType<typeof persistentExecutor>>, request: NativeCaptureRequest, unknown = false) {
  const { nativeCaptureReceiptExpectation } = await import("../src/exploration/native-identity-capture-evidence.js");
  const requestSha256 = nativeIdentityDigest(request);
  await context.sink.record({ kind: "capture-requested", requestSha256, requestedAt: context.clock.wall, expectation: nativeCaptureReceiptExpectation(request) });
  const refs = request.operation === "start" || request.operation === "discard" ? [] : [{ schemaVersion: "lakda/adaptive-contracts/v1" as const,
    artifactId: "capture-fixture", path: "artifacts/video/0001.mp4", sha256: "a".repeat(64), size: 12,
    classification: "confidential" as const, redactionStatus: "pending" as const, securityStatus: "not_applicable" as const }];
  const receipt: NativeCaptureResult = { schemaVersion: "lakda/native-capture-result/v1", operation: request.operation, ordinal: request.ordinal,
    captureOrdinal: request.captureOrdinal, requestSha256, completedAt: new Date(context.clock.wall).toISOString(),
    result: { accepted: true, mode: request.payload.mode ?? "screenshot", artifactRefs: refs, ...(["stop", "discard"].includes(request.operation) ? { stopped: true } : {}) } };
  await context.sink.record({ kind: "capture-finished", requestSha256, ordinal: request.ordinal, startedAt: context.clock.wall,
    finishedAt: context.clock.wall, executionStatus: unknown ? "failed" : "completed", receipt: unknown ? null : receipt });
}

test("native journal v2 preserves capture lifecycle without saving private staging paths", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-capture-journal"));
  try {
    await context.create();
    await saveCapturePair(context, captureRequest(context, "start", 1));
    expect((await context.api.readSessionNativeEvidence(context.paths, context.target)).complete).toBe(false);
    await saveCapturePair(context, captureRequest(context, "stop", 2, 1));
    const proof = await context.api.readSessionNativeEvidence(context.paths, context.target);
    expect(proof.complete).toBe(true); expect(proof.records).toHaveLength(5);
    expect(proof.records.every(record => record.schemaVersion === "lakda/native-execution-evidence/v2")).toBe(true);
    expect(proof.references.every(ref => ref.schemaVersion === "lakda/native-evidence-ref/v2")).toBe(true);
    expect(JSON.stringify(proof)).not.toContain("private-capture-fixture");
  } finally { context.close(); }
});

test("native capture evidence permits original cleanup after expiry and rejects a changed staging binding", async () => {
  for (const changed of [false, true]) {
    const context = await persistentExecutor(test.info().outputPath("native-capture-expiry-" + changed));
    try {
      await context.create(); await saveCapturePair(context, captureRequest(context, "start", 1));
      context.clock.wall = now + 6000;
      const stop = captureRequest(context, "stop", 2, 1);
      if (changed) stop.payload.stagingDir += "-changed";
      if (changed) await expect(saveCapturePair(context, stop)).rejects.toThrow(/native/);
      else { await saveCapturePair(context, stop); expect((await context.api.readSessionNativeEvidence(context.paths, context.target)).complete).toBe(true); }
    } finally { context.close(); }
  }
});

test("native capture evidence can confirm an unknown start stopped but cannot invent an unknown screenshot", async () => {
  for (const screenshot of [false, true]) {
    const context = await persistentExecutor(test.info().outputPath("native-capture-unknown-" + screenshot));
    try {
      await context.create(); await saveCapturePair(context, captureRequest(context, "start", 1), !screenshot);
      if (screenshot) await saveCapturePair(context, captureRequest(context, "screenshot", 2), true);
      await saveCapturePair(context, captureRequest(context, "stop", screenshot ? 3 : 2, 1));
      expect((await context.api.readSessionNativeEvidence(context.paths, context.target)).complete).toBe(!screenshot);
    } finally { context.close(); }
  }
});

test("native journal reader preserves legacy v1 files and refuses mixed versions", async () => {
  const context = await persistentExecutor(test.info().outputPath("journal-current"));
  try {
    const executor = await context.create(); await executor.perform(context.action);
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    for (const mode of ["legacy", "mixed"]) {
      const copy = await createExplorationSession(context.input.charter, {}, test.info().outputPath("journal-" + mode));
      await writeFile(copy.paths.targetManifest, context.input.targetBytes);
      await appendSessionEvent(copy.paths, { type: "checkpoint", payload: { targetManifestDigest: context.target.sha256 } });
      const journalId = randomUUID(); await mkdir(join(copy.paths.root, "native-identity", journalId), { recursive: true });
      for (const record of saved.records) {
        const version = mode === "mixed" && record.sequence === 2 ? "v2" : "v1";
        const value = { ...record, schemaVersion: "lakda/native-execution-evidence/" + version, journalId,
          binding: { ...record.binding, sessionId: copy.session.sessionId } };
        const bytes = Buffer.from(canonicalJson(value) + "\n"), path = `native-identity/${journalId}/${String(record.sequence).padStart(6, "0")}.json`;
        await writeFile(join(copy.paths.root, path), bytes);
        await appendSessionEvent(copy.paths, { type: "checkpoint", payload: { nativeEvidenceRef: { schemaVersion: "lakda/native-evidence-ref/" + version,
          path, sha256: "sha256:" + sha256(bytes), size: bytes.length, journalId, sequence: record.sequence } } });
      }
      if (mode === "mixed") await expect(context.api.readSessionNativeEvidence(copy.paths, context.target)).rejects.toThrow(/native/);
      else {
        const result = await context.api.readSessionNativeEvidence(copy.paths, context.target);
        expect(result.complete).toBe(true); expect(result.records).toHaveLength(3);
        expect(result.records.every(value => value.schemaVersion === "lakda/native-execution-evidence/v1")).toBe(true);
      }
    }
  } finally { context.close(); }
});

test("native capture journals store large receipts without increasing the old record limit", async () => {
  const context = await persistentExecutor(test.info().outputPath("capture-large")), capture = nativeCaptureFixture(context);
  try {
    Object.assign(context.input.bridge, { async nativeCapture(request: NativeCaptureRequest) {
      const receipt = await capture.send(request);
      if (request.operation === "stop") receipt.result.artifactRefs = Array.from({ length: 2000 }, (_, index) => ({ ...receipt.result.artifactRefs[0]!,
        artifactId: "capture-" + index, path: `artifacts/video/${index}.mp4` }));
      return receipt;
    } });
    const executor = await context.create(), payload = captureRequest(context, "start", 1).payload;
    await executor.perform(context.action);
    await executor.capture({ operation: "start", payload }); await executor.capture({ operation: "stop", payload });
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    expect(saved.complete).toBe(true); expect(saved.references.at(-1)!.size).toBeGreaterThan(131072);
    expect(() => assertNativeEvidenceEnvelope({ ...saved.records.at(-1), schemaVersion: "lakda/native-execution-evidence/v1" })).toThrow();
    const receipt = saved.records.at(-1)!.evidence;
    expect(receipt.kind === "capture-finished" && receipt.receipt?.result.artifactRefs.length).toBe(2000);
    const legacy = { ...structuredClone(saved.records[2]!), schemaVersion: "lakda/native-execution-evidence/v1" as const };
    expect(() => assertNativeEvidenceEnvelope(legacy)).not.toThrow();
    if (legacy.evidence.kind !== "action-finished" || legacy.evidence.receipt?.operation !== "recover" || receipt.kind !== "capture-finished") throw new Error("fixture receipt missing");
    legacy.evidence.receipt.result.evidenceRefs = structuredClone(receipt.receipt!.result.artifactRefs);
    expect(Buffer.byteLength(JSON.stringify(legacy))).toBeGreaterThan(131072);
    expect(() => assertNativeEvidenceEnvelope(legacy)).toThrow();
  } finally { context.close(); }
});

test("native session persists immutable phase records and verifies them from session events", async () => {
  const info = test.info();
  const context = await persistentExecutor(info.outputPath("native-sessions"));
  try {
    context.action.payload.failure.messageRef = "fixture-unpublished-request";
    const executor = await context.create();
    await executor.perform(context.action);
    await executor.perform(context.action);
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    expect(saved.complete).toBe(true);
    expect(saved.records.map(record => record.evidence.kind)).toEqual(["observation", "action-requested", "action-finished", "action-requested", "action-finished"]);
    expect(JSON.stringify(saved)).not.toContain("fixture-unpublished-request");
    expect(saved.records.every(record => record.binding.sessionId === context.session.sessionId)).toBe(true);
    const before = await readFile(join(context.paths.root, "native-identity", context.sink.journalId, "000001.json"));
    await expect(context.api.createSessionNativeEvidenceSink(context.paths, { ...context.target, sha256: digest("f") })).rejects.toThrow();
    expect(await readFile(join(context.paths.root, "native-identity", context.sink.journalId, "000001.json"))).toEqual(before);
  } finally { context.close(); }
});

test("native session stops when its evidence deadline expires during checkpoint append", async () => {
  const info = test.info();
  const fs = (await import("node:fs/promises")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  for (const expireAt of [1, 2]) {
    const context = await persistentExecutor(info.outputPath(`native-deadline-${expireAt}`));
    const controller = new AbortController();
    let appendCount = 0;
    try {
      const executor = await context.create(), originalAppend = fs.appendFile;
      const append = mock.method(fs, "appendFile", async (...args: Parameters<typeof fs.appendFile>) => {
        await originalAppend(...args);
        if (++appendCount === expireAt) controller.abort();
      });
      const timeout = mock.method(AbortSignal, "timeout", () => controller.signal);
      syncBuiltinESMExports();
      try {
        await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: expireAt === 2 });
        expect(context.sent).toHaveLength(expireAt - 1);
        await expect(executor.perform(context.action)).rejects.toThrow(/native-execution-stopped/);
      } finally { append.mock.restore(); timeout.mock.restore(); syncBuiltinESMExports(); }
      const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
      expect(saved.records).toHaveLength(expireAt + 1);
      expect(saved.complete).toBe(expireAt === 2);
    } finally { context.close(); }
  }
});

test("native session readers return exact source binding and respect the caller cancellation", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-source-binding"));
  try {
    await context.create();
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    const sources = await Promise.all([context.paths.session, context.paths.events, context.paths.targetManifest, context.paths.charter].map(path => readFile(path)));
    expect(saved.sourceDigest).toBe(nativeIdentityDigest(sources.map(bytes => sha256(bytes))));
    await expect(context.api.readSessionNativeEvidence(context.paths, context.target, AbortSignal.abort())).rejects.toThrow(/native-evidence/);
  } finally { context.close(); }
});

test("stored native evidence verifies its historical approval with explicit trusted keys", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-signed-archive"));
  try {
    await context.create();
    const { readSignedSessionNativeEvidence } = await import("../src/exploration/native-identity-evidence-target.js");
    const options = { charter: context.input.charter, configDigest: context.input.configDigest, trustKeys };
    context.clock.wall = now + 60000;
    const saved = await readSignedSessionNativeEvidence(context.paths, options);
    expect(saved.target.sha256).toBe(context.target.sha256);
    expect(saved.complete).toBe(true);
    expect(context.sent).toHaveLength(0);
    await expect(readSignedSessionNativeEvidence(context.paths, { ...options, trustKeys: [] })).rejects.toThrow(/native-evidence/);
    const other = generateKeyPairSync("ed25519");
    await expect(readSignedSessionNativeEvidence(context.paths, { ...options, trustKeys: [{ keyId: trustKeys[0]!.keyId,
      publicKeyPem: other.publicKey.export({ type: "spki", format: "pem" }).toString() }] })).rejects.toThrow(/native-evidence/);
    await expect(readSignedSessionNativeEvidence(context.paths, { ...options, signal: AbortSignal.abort() })).rejects.toThrow(/native-evidence/);
  } finally { context.close(); }
});

test("stored native evidence requires a bounded explicit trust file and an observation", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-signed-trust"));
  try {
    const { readSignedSessionNativeEvidence } = await import("../src/exploration/native-identity-evidence-target.js");
    const path = test.info().outputPath("operator-trust.json");
    const options = { charter: context.input.charter, configDigest: context.input.configDigest, trustStorePath: path };
    await writeFile(path, JSON.stringify({ keys: trustKeys }));
    await expect(readSignedSessionNativeEvidence(context.paths, options)).rejects.toThrow(/native-evidence/);
    await context.create();
    expect((await readSignedSessionNativeEvidence(context.paths, options)).complete).toBe(true);
    await expect(readSignedSessionNativeEvidence(context.paths, { ...options, trustKeys })).rejects.toThrow(/native-evidence/);
    await expect(readSignedSessionNativeEvidence(context.paths, { ...options, trustStorePath: undefined })).rejects.toThrow(/native-evidence/);
    for (const value of [{ keys: [...trustKeys, ...trustKeys] }, { keys: trustKeys, extra: true }, { keys: [] }]) {
      await writeFile(path, JSON.stringify(value));
      await expect(readSignedSessionNativeEvidence(context.paths, options)).rejects.toThrow(/native-evidence/);
    }
    await writeFile(path, Buffer.alloc(131073, 32));
    await expect(readSignedSessionNativeEvidence(context.paths, options)).rejects.toThrow(/native-evidence/);
  } finally { context.close(); }
});

test("stored native approval does not make an unknown action result complete", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-signed-unknown"));
  try {
    const executor = await context.create();
    context.hooks.action = () => { throw new Error("fixture response unavailable"); };
    await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: "unknown" });
    const { readSignedSessionNativeEvidence } = await import("../src/exploration/native-identity-evidence-target.js");
    const saved = await readSignedSessionNativeEvidence(context.paths, { charter: context.input.charter,
      configDigest: context.input.configDigest, trustKeys });
    expect(saved.complete).toBe(false);
    expect(saved.records.at(-1)?.evidence).toMatchObject({ actionAttempted: "unknown", receipt: null });
  } finally { context.close(); }
});

test("native HATE export rejects changed and orphaned records before replacing a valid manifest", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-hate-validation"));
  try {
    await context.create();
    await writeFile(join(context.paths.root, "trust.json"), JSON.stringify({ keys: trustKeys }));
    const { buildSessionHateManifest, loadExplorationSession } = await import("../src/exploration/session.js");
    const session = (await loadExplorationSession(context.paths.root)).session;
    await buildSessionHateManifest(context.paths, session);
    const originalManifest = await readFile(context.paths.hateManifest);
    const path = join(context.paths.root, "native-identity", context.sink.journalId, "000001.json");
    const originalRecord = await readFile(path);
    await writeFile(path, Buffer.concat([originalRecord, Buffer.from(" ")]));
    await expect(buildSessionHateManifest(context.paths, session)).rejects.toThrow(/native-evidence/);
    expect(await readFile(context.paths.hateManifest)).toEqual(originalManifest);
    await writeFile(path, originalRecord);
    await writeFile(join(context.paths.root, "native-identity", context.sink.journalId, "000002.json"), originalRecord);
    await expect(buildSessionHateManifest(context.paths, session)).rejects.toThrow(/native-evidence/);
    expect(await readFile(context.paths.hateManifest)).toEqual(originalManifest);
  } finally { context.close(); }
});

test("native text-only reports require operator trust and preserve unknown action results", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-report-unknown"));
  try {
    const executor = await context.create();
    context.hooks.action = () => { throw new Error("fixture response unavailable"); };
    await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: "unknown" });
    const trustStorePath = join(context.paths.root, "trust.json");
    await writeFile(trustStorePath, JSON.stringify({ keys: trustKeys }));
    await appendSessionEvent(context.paths, { type: "session-started", status: "running" });
    await appendSessionEvent(context.paths, { type: "session-paused", status: "paused" });
    const { buildExplorationReport } = await import("../src/exploration/session.js");
    await buildExplorationReport(context.paths);
    const { generateReport } = await import("../src/reporting/generation.js");
    const selector = { session: context.paths.root };
    const options = { producerVersion: "0.5.0-rc.1", profile: "local" as const, timeoutMs: 10000, textOnly: true };
    const missing = await generateReport(selector, { ...options, output: test.info().outputPath("report-without-trust") });
    expect(missing.receipt.generationStatus).toBe("error");
    expect(missing.receipt.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-native-evidence" })]));
    const valid = await generateReport(selector, { ...options, trustStorePath, output: test.info().outputPath("report-with-trust") });
    expect(valid.receipt.generationStatus).toBe("degraded");
    expect(valid.receipt.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "native-evidence-incomplete", severity: "warning" })]));
    const manifest = JSON.parse(await readFile(context.paths.hateManifest, "utf8"));
    manifest.artifacts = manifest.artifacts.filter((artifact: { path: string }) => !artifact.path.startsWith("native-identity/"));
    await writeFile(context.paths.hateManifest, JSON.stringify(manifest));
    const omitted = await generateReport(selector, { ...options, trustStorePath, output: test.info().outputPath("report-missing-records") });
    expect(omitted.receipt.generationStatus).toBe("error");
    expect(omitted.receipt.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-native-evidence" })]));
  } finally { context.close(); }
});

test("native report media targets use observed approval and final readers detect newly orphaned files", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-report-complete"));
  try {
    const executor = await context.create();
    await executor.perform(context.action);
    const charter = context.input.charter;
    await writeCapabilitySnapshot(context.paths, capabilitySnapshotFromAdapter({ charter, adapterId: "airtest-poco", revision: "fixture-v1",
      observedTargetRevision: charter.targetRevision, runtimePlatform: "android", targetKinds: ["device"],
      observationCapabilities: ["screen", "template-match"], actionCapabilities: ["tap", "click"], evidenceCapabilities: ["screenshot"],
      connected: true, rawCapabilityDigest: digest("b"), bridgeDigest: digest("a") }));
    const trustStorePath = join(context.paths.root, "trust.json");
    await writeFile(trustStorePath, JSON.stringify({ keys: trustKeys }));
    await appendSessionEvent(context.paths, { type: "session-started", status: "running" });
    await appendSessionEvent(context.paths, { type: "session-paused", status: "paused" });
    const { buildExplorationReport } = await import("../src/exploration/session.js");
    await buildExplorationReport(context.paths);
    const { loadReportTrustStore } = await import("../src/reporting/trust-store.js");
    const { loadReportSourceCollection } = await import("../src/reporting/source-collection.js");
    const { verifyReportSourcesUnchanged } = await import("../src/reporting/source-verifier.js");
    const { verifyReportMediaTarget } = await import("../src/reporting/media-target.js");
    const trust = await loadReportTrustStore(trustStorePath);
    const collection = await loadReportSourceCollection({ entries: [{ kind: "session", root: context.paths.root }], duplicatePaths: 0, indexBytes: 0 }, undefined, trust);
    expect(collection.sessions[0]!.nativeEvidence?.complete).toBe(true);
    expect(collection.sessions[0]!.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "native-evidence-incomplete" })]));
    context.clock.wall = now + 60000;
    expect((await verifyReportMediaTarget(collection.sessions[0]!, trust)).manifestSha256).toBe(context.target.sha256);
    await expect(verifyReportMediaTarget(collection.sessions[0]!, { ...trust, keys: [] })).rejects.toThrow();
    await verifyReportSourcesUnchanged(collection);
    const path = join(context.paths.root, "native-identity", context.sink.journalId);
    await writeFile(join(path, "000004.json"), await readFile(join(path, "000001.json")));
    await expect(verifyReportSourcesUnchanged(collection)).rejects.toThrow(/入力の更新または不一致/);
  } finally { context.close(); }
});

function bridgeFixture(context: Pick<ReturnType<typeof executorFixture>, "input" | "data" | "clock">) {
  let legacy = 0, reads = 0;
  const controls: string[] = [], capture = nativeCaptureFixture(context);
  const bridge: ExternalToolBridge = { ...context.input.bridge,
    capabilities: () => ({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "fixture",
      targetKinds: ["device"], actionKinds: ["back"], observationCapabilities: ["screen"], evidenceCapabilities: ["screenshot"], recoveryStrategies: ["back"] }),
    binding: () => structuredClone(context.data.manifest.bridgeBinding),
    async observe() { throw new Error("unused fixture observation"); },
    async generateCandidates() { return []; },
    async execute() { legacy++; throw new Error("legacy execute must not run"); },
    async recover() { legacy++; throw new Error("legacy recover must not run"); },
    async captureEvidence() { legacy++; throw new Error("legacy screenshot must not run"); },
    async captureControl() { legacy++; throw new Error("legacy recording must not run"); },
    async nativeCapture(request) {
      if (request.operation === "screenshot") reads++; else controls.push(request.operation);
      return capture.send(request);
    },
  };
  return { bridge, controls, capture, legacy: () => legacy, reads: () => reads };
}

test("native runner bridge persists execute and recovery while leaving legacy endpoints unused", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-runner-bridge")), fixture = bridgeFixture(context);
  try {
    const { createNativeIdentityBridge } = await import("../src/exploration/native-identity-bridge.js");
    const bridge = await createNativeIdentityBridge({ ...context.input, bridge: fixture.bridge, evidence: context.sink });
    const candidate = { schemaVersion: "lakda/adaptive-contracts/v1" as const, candidateId: "candidate-1", adapterId: "airtest-poco",
      targetRef: { targetId: "fixture-device", kind: "device" as const }, sourceFingerprint: "source-1", actionKind: "back" as const,
      locatorRecipe: { strategy: "image" as const, value: "back" }, generatedBy: { ruleId: "fixture", observationId: "observation-1", reason: "fixture" },
      risk: { weight: 1 }, mutationKind: "none" as const };
    expect(await bridge.execute(candidate, { runId: "fixture-run", timeoutMs: 1000 })).toMatchObject({ status: "executed" });
    expect(await bridge.recover(context.action.payload.failure, context.action.payload.context)).toMatchObject({ recovered: true });
    expect(fixture.legacy()).toBe(0);
    expect(context.sent.map(request => request.operation)).toEqual(["execute", "recover"]);
    expect((await context.api.readSessionNativeEvidence(context.paths, context.target)).records).toHaveLength(5);
    expect(bridge).not.toHaveProperty("nativeAction");
    expect(bridge).not.toHaveProperty("nativeCapture");
    expect(bridge).not.toHaveProperty("observeNativeIdentity");
  } finally { context.close(); }
});

test("native runner bridge requires evidence and stops new work after expiry while allowing capture cleanup", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-runner-stop")), fixture = bridgeFixture(context);
  try {
    const { createNativeIdentityBridge } = await import("../src/exploration/native-identity-bridge.js");
    await expect(createNativeIdentityBridge({ ...context.input, bridge: fixture.bridge, evidence: undefined! })).rejects.toThrow(/native/);
    expect(context.observations()).toBe(0);
    const bridge = await createNativeIdentityBridge({ ...context.input, bridge: fixture.bridge, evidence: context.sink });
    const request = { runId: "fixture-run", stagingDir: test.info().outputPath("capture"), mode: "video" as const };
    await bridge.captureControl!({ ...request, action: "start" });
    await bridge.captureEvidence({ runId: "fixture-run", kinds: ["screenshot"], stagingDir: request.stagingDir });
    context.clock.wall = now + 5000;
    await expect(bridge.recover(context.action.payload.failure, context.action.payload.context)).rejects.toThrow(/native/);
    await expect(bridge.captureEvidence({ runId: "fixture-run", kinds: ["screenshot"], stagingDir: request.stagingDir })).rejects.toThrow(/native/);
    await expect(bridge.execute(undefined!, undefined!)).rejects.toThrow(/native/);
    await expect(bridge.captureControl!({ ...request, action: "start" })).rejects.toThrow(/native/);
    await bridge.captureControl!({ ...request, action: "stop" });
    expect(fixture.controls).toEqual(["start", "stop"]);
    expect(fixture.reads()).toBe(1);
    expect(fixture.legacy()).toBe(0);
    expect(context.sent).toHaveLength(0);
  } finally { context.close(); }
});

test("native runner stops a capture whose start completes after approval expiry", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-runner-late-capture")), fixture = bridgeFixture(context);
  try {
    const control = fixture.bridge.nativeCapture!;
    fixture.bridge.nativeCapture = async request => {
      const response = await control(request);
      if (request.operation === "start") context.clock.wall = now + 5000;
      return response;
    };
    const { createNativeIdentityBridge } = await import("../src/exploration/native-identity-bridge.js");
    const bridge = await createNativeIdentityBridge({ ...context.input, bridge: fixture.bridge, evidence: context.sink });
    await expect(bridge.captureControl!({ runId: "fixture-run", stagingDir: test.info().outputPath("capture"), mode: "video", action: "start" })).rejects.toThrow(/native/);
    expect(fixture.controls).toEqual(["start", "stop"]);
    expect(context.sent).toHaveLength(0);
  } finally { context.close(); }
});

test("native runner rejects concurrent work and keeps bound methods after caller mutation", async () => {
  const context = await persistentExecutor(test.info().outputPath("native-runner-concurrency")), fixture = bridgeFixture(context);
  try {
    let enter!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const completed = new Promise<void>(resolve => { finish = resolve; });
    const capture = fixture.bridge.nativeCapture!;
    fixture.bridge.nativeCapture = async request => { enter(); await completed; return capture(request); };
    const { createNativeIdentityBridge } = await import("../src/exploration/native-identity-bridge.js");
    const bridge = await createNativeIdentityBridge({ ...context.input, bridge: fixture.bridge, evidence: context.sink });
    fixture.bridge.nativeAction = async () => { throw new Error("replacement must not run"); };
    fixture.bridge.nativeCapture = async () => { throw new Error("replacement must not run"); };
    const reading = bridge.captureEvidence({ runId: "fixture-run", kinds: ["screenshot"], stagingDir: test.info().outputPath("capture") });
    await entered;
    await expect(bridge.recover(context.action.payload.failure, context.action.payload.context)).rejects.toThrow("native-bridge-busy");
    finish(); await reading;
    expect(await bridge.recover(context.action.payload.failure, context.action.payload.context)).toMatchObject({ recovered: true });
    expect(context.sent).toHaveLength(1);
    const capabilities = bridge.capabilities(); capabilities.actionKinds.length = 0;
    expect(bridge.capabilities().actionKinds).toEqual(["back"]);
  } finally { context.close(); }
});

test("native runner refuses binding changes and reports an unconfirmed capture stop", async () => {
  for (const mode of ["binding", "cleanup"]) {
    const context = await persistentExecutor(test.info().outputPath("native-runner-" + mode)), fixture = bridgeFixture(context);
    try {
      const control = fixture.bridge.nativeCapture!;
      fixture.bridge.nativeCapture = async request => {
        const result = await control(request);
        if (mode === "cleanup" && request.operation === "start") context.clock.wall = now + 5000;
        if (mode === "cleanup" && request.operation === "stop") return { ...result, result: { ...result.result, accepted: false, stopped: false, artifactRefs: [] } };
        return result;
      };
      const { createNativeIdentityBridge } = await import("../src/exploration/native-identity-bridge.js");
      const bridge = await createNativeIdentityBridge({ ...context.input, bridge: fixture.bridge, evidence: context.sink });
      if (mode === "binding") {
        context.data.manifest.bridgeBinding.bridgeDigest = digest("f");
        await expect(bridge.recover(context.action.payload.failure, context.action.payload.context)).rejects.toThrow(/native/);
      } else {
        await expect(bridge.captureControl!({ runId: "fixture-run", stagingDir: test.info().outputPath("capture"), mode: "video", action: "start" })).rejects.toThrow("native-bridge-capture-stop-unconfirmed");
        expect(fixture.controls).toEqual(["start", "stop"]);
      }
      expect(context.sent).toHaveLength(0);
      expect(fixture.legacy()).toBe(0);
    } finally { context.close(); }
  }
});

test("adaptive exploration consumes the native runner bridge and records the selected action", async () => {
  const { loadConfig } = await import("../src/core/config.js");
  const { runLakda } = await import("../src/core/runner.js");
  const { fingerprintObservation } = await import("../src/adaptive/fingerprint.js");
  const observation = { schemaVersion: "lakda/adaptive-contracts/v1" as const, observationId: "fixture-screen", observedAt: at,
    targetRef: { targetId: "fixture-device", kind: "device" as const }, completeness: "complete" as const, ui: { screen: "home" },
    forms: [], dialogs: [], topology: { activeTargetId: "fixture-device" }, obligations: {},
    provenance: { adapterId: "airtest-poco", runtime: "fixture", capabilityRevision: "fixture" } };
  const config = loadConfig(undefined, { baseUrl: "http://127.0.0.1", outputDir: test.info().outputPath("adaptive-native-runs"), mode: "adaptive-explore", maxActions: 2,
    artifacts: { video: false }, adaptive: { schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "airtest-poco", endpoint: "http://127.0.0.1:8765", initialTarget: observation.targetRef },
      generator: { strategy: "least-visited-transition" }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
      settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1000, stableWindowMs: 20 },
      fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
      recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 }, safety: { allowTargetKinds: ["device"], denyActionIds: [], allowMutationKinds: ["none"] } } });
  const context = await persistentExecutor(test.info().outputPath("adaptive-native-sessions"), config), fixture = bridgeFixture(context);
  try {
    const candidate = { schemaVersion: "lakda/adaptive-contracts/v1" as const, candidateId: "candidate-1", adapterId: "airtest-poco",
      targetRef: observation.targetRef, sourceFingerprint: fingerprintObservation(observation).value, actionKind: "back" as const,
      locatorRecipe: { strategy: "image" as const, value: "back" }, generatedBy: { ruleId: "fixture", observationId: observation.observationId, reason: "fixture" }, risk: { weight: 1 }, mutationKind: "none" as const };
    fixture.bridge.observe = async () => structuredClone(observation);
    fixture.bridge.generateCandidates = async () => [structuredClone(candidate)];
    const { createNativeIdentityBridge } = await import("../src/exploration/native-identity-bridge.js");
    const bridge = await createNativeIdentityBridge({ ...context.input, bridge: fixture.bridge, evidence: context.sink });
    const result = await runLakda(config, undefined, { adaptiveBridge: bridge, explorationCapture: { sampledFrames: { enabled: false, intervalMs: 1000 } } });
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
    expect(context.sent.map(request => request.operation)).toEqual(["execute"]);
    expect(fixture.legacy()).toBe(0);
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    expect(saved.complete).toBe(true);
    expect(saved.records.map(record => record.evidence.kind)).toEqual(["observation", "action-requested", "action-finished"]);
  } finally { context.close(); }
});

test("native session refuses altered evidence bytes", async () => {
  const info = test.info();
  const context = await persistentExecutor(info.outputPath("native-sessions"));
  try {
    const executor = await context.create();
    await executor.perform(context.action);
    const artifact = join(context.paths.root, "native-identity", context.sink.journalId, "000003.json");
    const bytes = await readFile(artifact);
    await writeFile(artifact, Buffer.concat([bytes, Buffer.from(" ")]));
    await expect(context.api.readSessionNativeEvidence(context.paths, context.target)).rejects.toThrow("native-evidence");
  } finally { context.close(); }
});

test("native session records an unknown response and refuses another journal without reconciliation", async () => {
  const info = test.info();
  const context = await persistentExecutor(info.outputPath("native-sessions"));
  try {
    const original = context.input.bridge.nativeAction;
    context.input.bridge.nativeAction = async request => { await original(request); throw new Error("private-network-error"); };
    const executor = await context.create();
    await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: "unknown" });
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    expect(saved.complete).toBe(false);
    expect(saved.records.at(-1)!.evidence).toMatchObject({ kind: "action-finished", actionAttempted: "unknown", receipt: null });
    expect(JSON.stringify(saved)).not.toContain("private-network-error");
    await expect(context.api.createSessionNativeEvidenceSink(context.paths, context.target)).rejects.toThrow();
    expect(context.sent).toHaveLength(1);
  } finally { context.close(); }
});

test("native session does not reuse an observation in a new journal", async () => {
  const info = test.info();
  const context = await persistentExecutor(info.outputPath("native-sessions"));
  try {
    const executor = await context.create();
    await executor.perform(context.action);
    const next = await context.api.createSessionNativeEvidenceSink(context.paths, context.target);
    Object.assign(context.input, { evidence: next });
    await expect(context.create()).rejects.toThrow("native-execution-unavailable");
    expect(context.sent).toHaveLength(1);
  } finally { context.close(); }
});

test("native evidence sink fixes its session paths before the caller can change them", async () => {
  const info = test.info();
  const context = await persistentExecutor(info.outputPath("native-sessions"));
  const savedPaths = { ...context.paths };
  try {
    context.paths.root = info.outputPath("other-session");
    context.paths.events = join(context.paths.root, "other-events.jsonl");
    const executor = await context.create();
    await executor.perform(context.action);
    expect((await context.api.readSessionNativeEvidence(savedPaths, context.target)).records).toHaveLength(3);
  } finally { context.close(); }
});

test("native session leaves an unresolved intent when a receipt cannot be published", async () => {
  const info = test.info();
  const context = await persistentExecutor(info.outputPath("native-sessions"));
  try {
    const original = context.input.bridge.nativeAction;
    context.input.bridge.nativeAction = async request => {
      const result = await original(request);
      if (result.operation === "recover") result.result.strategy = "token=fixture-private-secret";
      return result;
    };
    const executor = await context.create();
    await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: true });
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    expect(saved.complete).toBe(false);
    expect(saved.records.map(value => value.evidence.kind)).toEqual(["observation", "action-requested"]);
    const folder = join(context.paths.root, "native-identity", context.sink.journalId);
    for (const name of await readdir(folder)) expect(await readFile(join(folder, name), "utf8")).not.toContain("fixture-private-secret");
    await expect(context.api.createSessionNativeEvidenceSink(context.paths, context.target)).rejects.toThrow();
  } finally { context.close(); }
});

test("native stored phases verify semantics independently of file hashes", async () => {
  const info = test.info();
  const context = await persistentExecutor(info.outputPath("native-sessions"));
  try {
    const executor = await context.create();
    await executor.perform(context.action);
    const saved = await context.api.readSessionNativeEvidence(context.paths, context.target);
    for (const mode of ["order", "ordinal", "lease", "window", "request-digest", "receipt", "session-extra"]) {
      const records = structuredClone(saved.records);
      if (mode === "order") [records[1], records[2]] = [records[2]!, records[1]!];
      const request = records[1]!.evidence, result = records[2]!.evidence;
      if (mode === "session-extra") Object.assign(records[0]!.binding, { extra: true });
      if (request.kind === "action-requested") {
        if (mode === "ordinal") request.expectation.ordinal++;
        if (mode === "lease") request.expectation.lease.observationDigest = digest("f");
        if (mode === "window" && request.expectation.schemaVersion === "lakda/native-action-request/v2") request.expectation.approvalWindow.targetManifestSha256 = digest("f");
      }
      if (result.kind === "action-finished") {
        if (mode === "request-digest") result.requestSha256 = digest("f");
        if (mode === "receipt" && result.receipt) result.receipt.ordinal++;
      }
      expect(() => { const verifier = new NativeEvidenceVerifier(context.target); for (const record of records) { assertNativeEvidenceEnvelope(record); verifier.accept(record.evidence); } }).toThrow();
    }
  } finally { context.close(); }
});

test("native session storage conflicts preserve the SDK attempt boundary and block continuation", async () => {
  const info = test.info();
  for (const sequence of [2, 3]) {
    const context = await persistentExecutor(info.outputPath(`native-sessions-${sequence}`));
    try {
      const executor = await context.create();
      await mkdir(join(context.paths.root, "native-identity", context.sink.journalId, `${String(sequence).padStart(6, "0")}.json`));
      await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: sequence === 3 });
      expect(context.sent).toHaveLength(sequence === 3 ? 1 : 0);
      await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
      await expect(context.api.readSessionNativeEvidence(context.paths, context.target)).rejects.toThrow("native-evidence");
    } finally { context.close(); }
  }
});

test("native executor verifies the signed snapshot before observation and binds both window and lease", async () => {
  const context = executorFixture();
  try {
    const executor = await context.create();
    const receipt = await executor.perform(context.action);
    expect(receipt).toMatchObject({ schemaVersion: "lakda/native-action-result/v2", ordinal: 1, result: { recovered: true } });
    expect(context.sent[0]).toMatchObject({ approvalWindow: { targetManifestSha256: hash(context.input.targetBytes.toString()), validUntil: context.data.manifest.signature.validUntil },
      lease: { observationDigest: nativeIdentityDigest(context.data.acquisition.observation) } });
    expect(context.observations()).toBe(1);
    await executor.perform(context.action);
    expect(context.sent.map(item => item.ordinal)).toEqual([1, 2]);
  } finally { context.close(); }
});

test("native executor refuses untrusted or altered targets before the identity provider", async () => {
  for (const kind of ["signature", "trust", "charter"]) {
    const context = executorFixture();
    try {
      if (kind === "signature") { context.data.manifest.signature.validUntil = new Date(now + 10000).toISOString(); context.input.targetBytes = Buffer.from(JSON.stringify(context.data.manifest)); }
      if (kind === "trust") context.input.trustKeys = [];
      if (kind === "charter") context.input.charter.targetRevision = "other";
      await expect(context.create()).rejects.toThrow();
      expect(context.observations()).toBe(0);
      expect(context.sent).toHaveLength(0);
    } finally { context.close(); }
  }
});

test("native executor preserves the original approval deadline and stops on wall reversal", async () => {
  for (const kind of ["wall", "monotonic", "reverse"]) {
    const context = executorFixture();
    try {
      const executor = await context.create();
      await executor.perform(context.action);
      if (kind === "wall") context.clock.wall = now + 5000;
      if (kind === "monotonic") context.clock.mono += 5000;
      if (kind === "reverse") context.clock.wall--;
      await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: false });
      context.clock.wall = now + 2; context.clock.mono = 101;
      await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
      expect(context.sent).toHaveLength(1);
    } finally { context.close(); }
  }
});

test("native executor counts time spent awaiting observation without a renewed age budget", async () => {
  const context = executorFixture();
  try {
    context.hooks.observe = () => { context.clock.mono += 60000; };
    await expect(context.create()).rejects.toThrow();
    expect(context.sent).toHaveLength(0);
  } finally { context.close(); }
});

test("native executor retains a receipt when approval expires after dispatch", async () => {
  const context = executorFixture();
  try {
    const executor = await context.create();
    context.hooks.action = () => { context.clock.wall = now + 5000; };
    await expect(executor.perform(context.action)).rejects.toMatchObject({ actionAttempted: true, receipt: { ordinal: 1, actionAttempted: true } });
    await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
    expect(context.sent).toHaveLength(1);
  } finally { context.close(); }
});

test("native executor refuses concurrency and does not retry an uncertain transport failure", async () => {
  const context = executorFixture();
  try {
    context.input.bridge.nativeAction = async request => { context.sent.push(request); throw new Error("private-transport-message"); };
    const executor = await context.create();
    const running = executor.perform(context.action);
    await expect(executor.perform(context.action)).rejects.toThrow("native-execution-busy");
    await expect(running).rejects.toMatchObject({ actionAttempted: "unknown", message: "native-identity: native-execution-failed" });
    await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
    expect(context.sent).toHaveLength(1);
  } finally { context.close(); }
});

test("native executor snapshots initialization and action inputs before yielding", async () => {
  const context = executorFixture();
  try {
    const { createNativeIdentityExecutor } = await import("../src/exploration/native-identity-executor.js");
    const originalDigest = hash(context.input.targetBytes.toString());
    const creating = createNativeIdentityExecutor(context.input);
    context.input.targetBytes.fill(0); context.input.trustKeys.length = 0; context.input.charter.targetRevision = "changed";
    const executor = await creating;
    executor.observation.fields.deviceDigest.value = digest("f");
    const running = executor.perform(context.action);
    context.action.payload.context.runId = "changed-run";
    await running;
    expect(context.sent[0]).toMatchObject({ approvalWindow: { targetManifestSha256: originalDigest }, payload: { context: { runId: "fixture-run" } } });
  } finally { context.close(); }
});

test("native executor refuses an identity mismatch after observation", async () => {
  const context = executorFixture();
  try {
    context.data.acquisition.observation.fields.deviceDigest.value = digest("f");
    await expect(context.create()).rejects.toThrow("native-execution-unavailable");
    expect(context.observations()).toBe(1); expect(context.sent).toHaveLength(0);
  } finally { context.close(); }
});

test("native executor verifies custom bridge receipts and stops after a negative result", async () => {
  for (const mode of ["ordinal", "negative", "oversized"]) {
    const context = executorFixture();
    try {
      const original = context.input.bridge.nativeAction.bind(context.input.bridge);
      context.input.bridge.nativeAction = async request => {
        const receipt = await original(request);
        if (mode === "ordinal") receipt.ordinal++;
        if (receipt.operation === "recover") {
          if (mode === "negative") { receipt.result.recovered = false; receipt.actionAttempted = false; }
          if (mode === "oversized") receipt.result.strategy = "x".repeat(65536);
        }
        return receipt;
      };
      const executor = await context.create();
      const running = executor.perform(context.action);
      if (mode === "negative") expect(await running).toMatchObject({ actionAttempted: false, result: { recovered: false } });
      else await expect(running).rejects.toMatchObject({ actionAttempted: "unknown" });
      await expect(executor.perform(context.action)).rejects.toThrow("native-execution-stopped");
      expect(context.sent).toHaveLength(1);
    } finally { context.close(); }
  }
});
function change<T>(value: T, path: string, replacement: unknown = missing): T {
  const copy = structuredClone(value);
  let parent = copy as unknown as Record<string, unknown>;
  const parts = path.split(".");
  for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
  const key = parts.at(-1)!;
  if (replacement === missing) delete parent[key]; else parent[key] = replacement;
  return copy;
}
function signed<T extends ExplorationTargetManifest | NativeExplorationTargetManifest>(value: T): T {
  const result = structuredClone(value);
  const payloadObject = structuredClone(result) as unknown as Record<string, unknown>;
  if (result.schemaVersion === "lakda/exploration-target-manifest/v2") {
    const metadata = payloadObject.signature as Record<string, unknown>;
    delete metadata.signedPayloadDigest; delete metadata.valueBase64;
  } else delete payloadObject.signature;
  const payload = canonicalJson(payloadObject);
  result.signature.signedPayloadDigest = hash(payload);
  result.signature.valueBase64 = sign(null, Buffer.from(payload), privateKey).toString("base64");
  return result;
}
function fixture(platform: NativePlatform = "android") {
  const appId = platform === "windows" ? "fixture.exe" : "org.example.fixture";
  const appBuild = platform === "windows" ? digest("f") : platform === "android" ? "42" : "4.2";
  const provider = { name: "fixture-" + platform, version: "1.0" };
  const charter = JSON.parse(readFileSync("examples/exploration-charter.playwright.json", "utf8")) as ExplorationCharter;
  delete charter.baseUrl;
  Object.assign(charter, { platform, executionMode: "real", targetRevision: "approved-revision",
    adapter: { id: "airtest-poco", endpoint: "http://127.0.0.1:8765", initialTarget: { targetId: "fixture-device", kind: "device" } },
    scope: { allowHosts: ["127.0.0.1"], native: { appId, surfaces: [platform], denyZones: [] } } });
  const mapping = { schemaVersion: "lakda/native-build-mapping/v1" as const, mappingId: "00000000-0000-4000-8000-000000000004",
    platform, appId, provider, entries: [{ observedBuild: appBuild, targetRevision: charter.targetRevision }] };
  const manifest: NativeExplorationTargetManifest = signed({
    schemaVersion: "lakda/exploration-target-manifest/v2", manifestId: "native-target-fixture", status: "ready", owner: "fixture",
    charterDigest: nativeIdentityDigest(charter), configDigest: digest("c"), targetRevision: charter.targetRevision, platform,
    adapterId: "airtest-poco", executionMode: "real", target: { identity: { kind: "native", appId } },
    bridgeBinding: { bridgeDigest: digest("a"), capabilityDigest: digest("b") },
    safety: { allowMutationKinds: ["none"], resetProcedureRef: "fixture-reset", killSwitchRef: "fixture-kill" },
    nativeIdentity: { deviceDigest: digest("d"), allowedProviders: [provider], requiredFields: ["appId", "appBuild", "deviceDigest"], maxAgeMs: 60000,
      buildMappings: [{ mapping, mappingDigest: nativeBuildMappingDigest(mapping) }] },
    signature: { algorithm: "ed25519", keyId: "fixture-operator", validFrom: "2026-09-10T00:00:00.000Z", validUntil: "2026-09-11T00:00:00.000Z",
      approvalEvidenceRef: "fixture-approval", signedPayloadDigest: digest("0"), valueBase64: "AA==" },
  });
  const sources = NATIVE_IDENTITY_SOURCES[platform];
  const observation: NativeIdentityObservation = {
    schemaVersion: "lakda/native-identity-observation/v1", observationId: "00000000-0000-4000-8000-000000000001",
    challenge: "00000000-0000-4000-8000-000000000002", platform,
    bridgeBinding: { ...manifest.bridgeBinding, connectionId: "00000000-0000-4000-8000-000000000003" },
    provider, observedAt: at, expiresAt: new Date(now + 60000).toISOString(),
    fields: { appId: { status: "observed", source: sources.appId, value: appId },
      appBuild: { status: "observed", source: sources.appBuild, value: appBuild },
      deviceDigest: { status: "observed", source: sources.deviceDigest, value: digest("d") },
      platformVersion: { status: "unavailable", source: "unavailable", value: null } },
    declared: { appId: null, appRevision: null, deviceDigest: null, platformVersion: null },
  };
  const acquisition: NativeIdentityAcquisition = { observation, requestedAt: now, now: now + 1, elapsedMs: 1 };
  const verify = (value: unknown, time = at, keys = trustKeys) =>
    verifySignedExplorationTargetManifestSnapshot(Buffer.from(JSON.stringify(value)), charter, digest("c"), { at: time, trustKeys: keys, nativeIdentityPolicy: "validate-only" });
  return { charter, manifest, acquisition, verify };
}

test("native target v2 verifies actual fixture signatures and observations for each platform", async () => {
  for (const platform of ["windows", "android", "ios"] as const) {
    const { manifest, acquisition, verify } = fixture(platform);
    const loaded = await verify(manifest);
    expect(loaded.sha256).toBe(hash(JSON.stringify(manifest)));
    expect(hash(targetManifestSigningPayload(manifest))).toBe(manifest.signature.signedPayloadDigest);
    expect(verifyNativeIdentityForTarget(loaded.manifest as NativeExplorationTargetManifest, acquisition)).toMatchObject({
      platform, targetRevision: "approved-revision", deviceDigest: digest("d"), appBuild: acquisition.observation.fields.appBuild.value,
    });
  }
});

test("native target policy and approval metadata are bound by the v2 signature", async () => {
  const { manifest, verify } = fixture();
  for (const [path, replacement] of [
    ["nativeIdentity.deviceDigest", digest("e")], ["nativeIdentity.maxAgeMs", 10000],
    ["nativeIdentity.requiredFields", ["appId", "appBuild", "deviceDigest", "platformVersion"]],
    ["signature.validFrom", "2026-09-09T00:00:00.000Z"], ["signature.validUntil", "2026-09-12T00:00:00.000Z"],
    ["signature.approvalEvidenceRef", "changed-approval"], ["signature.keyId", "second-key"],
  ] as Array<[string, unknown]>) {
    const changed = change(manifest, path, replacement);
    await expect(verify(changed, at, [...trustKeys, { ...trustKeys[0]!, keyId: "second-key" }])).rejects.toThrow(/digest/);
    const payload = targetManifestSigningPayload(changed);
    changed.signature.signedPayloadDigest = hash(payload);
    await expect(verify(changed, at, [...trustKeys, { ...trustKeys[0]!, keyId: "second-key" }])).rejects.toThrow(/署名検証/);
  }
});

test("native target rejects malformed and weakened policies even when fixture-signed", async () => {
  const { manifest, verify } = fixture();
  for (const [path, replacement] of [
    ["nativeIdentity", missing], ["nativeIdentity.maxAgeMs", 999], ["nativeIdentity.maxAgeMs", 300001],
    ["nativeIdentity.maxAgeMs", true], ["nativeIdentity.requiredFields", ["appId", "appBuild"]],
    ["nativeIdentity.requiredFields", ["appId", "appBuild", "deviceDigest", "appId"]],
    ["nativeIdentity.allowedProviders", []], ["nativeIdentity.allowedProviders", [manifest.nativeIdentity.allowedProviders[0], manifest.nativeIdentity.allowedProviders[0]]],
    ["nativeIdentity.buildMappings", []], ["nativeIdentity.buildMappings.0.mappingDigest", digest("e")],
    ["nativeIdentity.buildMappings.0.mapping.entries", [{ observedBuild: "42", targetRevision: "other" }]],
    ["nativeIdentity.buildMappings.0.mappingPath", "../untrusted.json"], ["nativeIdentity.rawSerial", "private-canary"],
    ["target.identity.origin", "https://example.test"], ["adapterId", "playwright"], ["platform", "pc-web"],
  ] as Array<[string, unknown]>) {
    await expect(verify(signed(change(manifest, path, replacement)))).rejects.toThrow();
  }
});

test("each allowed provider has exactly one matching embedded build mapping", async () => {
  const { manifest, verify } = fixture();
  const second = { name: "fixture-android", version: "2.0" };
  const mapping = { ...manifest.nativeIdentity.buildMappings[0]!.mapping, provider: second };
  const dual = structuredClone(manifest);
  dual.nativeIdentity.allowedProviders.push(second);
  await expect(verify(signed(dual))).rejects.toThrow(/mapping/);
  dual.nativeIdentity.buildMappings.push({ mapping, mappingDigest: nativeBuildMappingDigest(mapping) });
  await expect(verify(signed(dual))).resolves.toMatchObject({ manifest: { nativeIdentity: { allowedProviders: [manifest.nativeIdentity.allowedProviders[0], second] } } });
  dual.nativeIdentity.buildMappings.push(structuredClone(dual.nativeIdentity.buildMappings[1]!));
  await expect(verify(signed(dual))).rejects.toThrow(/mapping/);
});

test("native target uses strict exclusive expiry and rejects ambiguous trust keys", async () => {
  const { manifest, verify } = fixture();
  await expect(verify(manifest, manifest.signature.validFrom)).resolves.toBeTruthy();
  await expect(verify(manifest, manifest.signature.validUntil)).rejects.toThrow(/期限/);
  await expect(verify(manifest, "2026-09-09T23:59:59.999Z")).rejects.toThrow(/期限/);
  for (const until of [manifest.signature.validFrom, "2026-09-09T00:00:00.000Z", "2026-09-11T00:00:00Z"]) {
    await expect(verify(signed(change(manifest, "signature.validUntil", until)))).rejects.toThrow(/期限/);
  }
  await expect(verify(manifest, at, [trustKeys[0]!, trustKeys[0]!])).rejects.toThrow(/keyId/);
});

test("native observations cannot override signed target policy and remain bounded by approval time", async () => {
  const { manifest, acquisition, verify } = fixture();
  const loaded = (await verify(manifest)).manifest as NativeExplorationTargetManifest;
  for (const [path, replacement] of [
    ["observation.fields.deviceDigest.value", digest("e")], ["observation.fields.appBuild.value", "43"],
    ["observation.bridgeBinding.bridgeDigest", digest("e")], ["observation.provider.version", "99"],
    ["observation.fields.appId", { status: "declared-only", source: "operator-declaration", value: null }],
    ["now", Date.parse(manifest.signature.validUntil)],
  ] as Array<[string, unknown]>) expect(() => verifyNativeIdentityForTarget(loaded, change(acquisition, path, replacement))).toThrow();
  const shorter = (await verify(signed(change(manifest, "nativeIdentity.maxAgeMs", 1000)))).manifest as NativeExplorationTargetManifest;
  expect(() => verifyNativeIdentityForTarget(shorter, acquisition)).toThrow(/expired/);
});

test("native target v1 signatures remain readable and cannot acquire v2 policy by extension", async () => {
  const { manifest, verify } = fixture();
  const old = change(change(manifest, "schemaVersion", "lakda/exploration-target-manifest/v1"), "nativeIdentity") as unknown as ExplorationTargetManifest;
  old.target.identity.appRevision = old.targetRevision;
  old.target.identity.deviceAliasDigest = digest("e");
  const legacy = signed(old);
  expect(hash(targetManifestSigningPayload(legacy))).toBe(legacy.signature.signedPayloadDigest);
  await expect(verify(legacy)).resolves.toMatchObject({ manifest: { schemaVersion: "lakda/exploration-target-manifest/v1" } });
  await expect(verify({ ...legacy, nativeIdentity: manifest.nativeIdentity })).rejects.toThrow(/schema/);
  await expect(verify(change(manifest, "schemaVersion", "lakda/exploration-target-manifest/v1"))).rejects.toThrow(/schema/);
});

test("native target v2 enforces document capacity and the file loader matches snapshot verification", async ({ browserName }, testInfo) => {
  const { manifest, charter, verify } = fixture();
  const root = testInfo.outputPath(browserName, "operator");
  await mkdir(root, { recursive: true });
  const targetPath = join(root, "target.json"), trustPath = join(root, "trust.json");
  await writeFile(targetPath, JSON.stringify(manifest));
  await writeFile(trustPath, JSON.stringify({ keys: trustKeys }));
  await expect(loadSignedExplorationTargetManifest(targetPath, charter, digest("c"), { at, trustStorePath: trustPath })).rejects.toThrow(/native.*v2.*読取/);
  await expect(loadSignedExplorationTargetManifest(targetPath, charter, digest("c"), { at, trustStorePath: trustPath, nativeIdentityPolicy: "validate-only" })).resolves.toEqual(await verify(manifest));
  await expect(verify(signed(change(manifest, "owner", "x".repeat(262144))))).rejects.toThrow(/size|capacity/);
  await writeFile(trustPath, JSON.stringify({ keys: [trustKeys[0], trustKeys[0]] }));
  await expect(loadSignedExplorationTargetManifest(targetPath, charter, digest("c"), { at, trustStorePath: trustPath, nativeIdentityPolicy: "validate-only" })).rejects.toThrow(/keyId/);
});

test("native mapping semantics are checked after their digests and signatures are valid", async () => {
  const { manifest, acquisition, verify } = fixture();
  for (const [path, replacement] of [
    ["platform", "ios"], ["appId", "other.app"], ["provider.version", "other-version"],
    ["entries", [{ observedBuild: "42", targetRevision: "other-revision" }]],
    ["entries", [{ observedBuild: "42", targetRevision: "approved-revision" }, { observedBuild: "42", targetRevision: "other-revision" }]],
  ] as Array<[string, unknown]>) {
    const changed = structuredClone(manifest);
    const entry = changed.nativeIdentity.buildMappings[0]!;
    entry.mapping = change(entry.mapping, path, replacement);
    entry.mappingDigest = nativeIdentityDigest(entry.mapping);
    await expect(verify(signed(changed))).rejects.toThrow(/mapping/);
  }
  const second = { name: "fixture-android", version: "2.0" };
  const dual = structuredClone(manifest), mapping = { ...dual.nativeIdentity.buildMappings[0]!.mapping, provider: second };
  dual.nativeIdentity.allowedProviders.push(second);
  dual.nativeIdentity.buildMappings.push({ mapping, mappingDigest: nativeBuildMappingDigest(mapping) });
  const loaded = (await verify(signed(dual))).manifest as NativeExplorationTargetManifest;
  expect(verifyNativeIdentityForTarget(loaded, change(acquisition, "observation.provider", second)).provider).toEqual(second);
  const other = structuredClone(manifest);
  other.nativeIdentity.buildMappings[0]!.mapping.entries.push({ observedBuild: "43", targetRevision: "other-revision" });
  other.nativeIdentity.buildMappings[0]!.mappingDigest = nativeBuildMappingDigest(other.nativeIdentity.buildMappings[0]!.mapping);
  const approved = (await verify(signed(other))).manifest as NativeExplorationTargetManifest;
  expect(() => verifyNativeIdentityForTarget(approved, change(acquisition, "observation.fields.appBuild.value", "43"))).toThrow(/build-mismatch/);
});

test("native target raw bytes reject invalid UTF-8, excess padding, and unknown versions", async () => {
  const { manifest, charter, verify } = fixture();
  const validate = (bytes: Buffer) => verifySignedExplorationTargetManifestSnapshot(bytes, charter, digest("c"), { at, trustKeys, nativeIdentityPolicy: "validate-only" });
  const json = Buffer.from(JSON.stringify(manifest));
  await expect(validate(Buffer.concat([json, Buffer.from([0xff])]))).rejects.toThrow(/JSON/);
  await expect(validate(Buffer.concat([json, Buffer.alloc(262144, 32)]))).rejects.toThrow(/capacity/);
  await expect(verify(change(manifest, "schemaVersion", "lakda/exploration-target-manifest/v3"))).rejects.toThrow(/schema/);
});

async function nativeCliFixture(root: string, options: { manualPause?: boolean; video?: boolean; sampled?: boolean; handoff?: boolean } = {}) {
  const context = executorFixture(), data = context.data, charter = context.input.charter;
  try {
    await mkdir(root, { recursive: true });
    Object.assign(charter, { configPath: join(root, "config.json"), outputDir: join(root, "runs"),
      targetManifestPath: join(root, "target.json"), trustStorePath: "trust.json",
      templateCorpus: { path: join(root, "templates.json"), version: charter.templateCorpusVersion, sha256: hash("[]") },
      stopWhen: { any: options.manualPause ? [{ type: "noveltyPlateau", windowActions: 20, minActions: 20 }] : [{ type: "actionCoverage", atLeast: 1 }] } });
    charter.capture.video = options.video ? "retain-on-finding-or-non-pass" : "off";
    charter.capture.sampledFrames.enabled = options.sampled ?? false; charter.capture.sampledFrames.source = "operator-bridge";
    if (options.handoff) {
      const stagingRoot = join(root, "private"); await mkdir(stagingRoot);
      charter.capture.binaryAttestation = { stagingRoot, policyDigest: digest("f"), timeoutMs: 1000 };
    }
    await writeFile(charter.configPath!, "{}"); await writeFile(charter.templateCorpus!.path, "[]");
    await writeFile(join(root, "trust.json"), JSON.stringify({ keys: trustKeys }));
    const { loadConfig } = await import("../src/core/config.js");
    const config = loadConfig(charter.configPath, { baseUrl: charter.baseUrl, mode: "adaptive-explore", seed: charter.seed, persona: charter.persona,
      durationMs: charter.budget.durationMs, maxActions: charter.budget.maxActions, outputDir: charter.outputDir,
      explorationPlatform: charter.platform, adaptive: adaptiveConfigFromCharter(charter),
      safety: { allowHosts: charter.scope.allowHosts, pathPrefixes: charter.scope.pathPrefixes, maxActionsPerMinute: charter.budget.maxActionsPerMinute, explorationDenyZones: charter.scope.native!.denyZones },
      artifacts: { video: options.video ? "retain-on-non-pass" : false, trace: "retain-on-non-pass", screenshot: "retain-on-non-pass" } });
    data.manifest.charterDigest = nativeIdentityDigest(charter); data.manifest.configDigest = nativeIdentityDigest(config);
    data.manifest.target.templateCorpusDigest = charter.templateCorpus!.sha256;
    data.manifest.artifactAttestorKeyIds = ["fixture-operator"];
    const persist = async () => {
      data.manifest.charterDigest = nativeIdentityDigest(charter);
      await writeFile(join(root, "charter.json"), JSON.stringify(charter));
      await writeFile(charter.targetManifestPath!, JSON.stringify(signed(data.manifest)));
    };
    await persist();
    const bridge = bridgeFixture(context), basic = bridge.bridge.capabilities();
    bridge.bridge.capabilities = () => ({ ...basic, revision: "fixture-v1", targetRevision: charter.targetRevision, platform: "android",
      liveness: { connected: true, responsive: true }, templateCorpusDigest: charter.templateCorpus!.sha256,
      actionKinds: ["tap", "click", "back"], observationCapabilities: ["screen", "template-match"], device: { appId: charter.scope.native!.appId },
      display: { width: 1080, height: 1920, orientation: "portrait", surface: "android" } });
    const acquire = bridge.bridge.observeNativeIdentity!;
    bridge.bridge.observeNativeIdentity = async age => {
      const result = await acquire(age);
      result.observation.observationId = randomUUID(); result.observation.challenge = randomUUID(); result.observation.bridgeBinding.connectionId = randomUUID();
      return result;
    };
    const observation = { schemaVersion: "lakda/adaptive-contracts/v1" as const, observationId: "fixture-screen", observedAt: at,
      targetRef: { targetId: "fixture-device", kind: "device" as const }, completeness: "complete" as const, ui: { screen: "home" },
      forms: [], dialogs: [], topology: { activeTargetId: "fixture-device" }, obligations: {},
      provenance: { adapterId: "airtest-poco", runtime: "fixture", capabilityRevision: "fixture-v1" } };
    const { fingerprintObservation } = await import("../src/adaptive/fingerprint.js");
    bridge.bridge.observe = async () => structuredClone(observation);
    const capture = bridge.bridge.nativeCapture!;
    bridge.bridge.nativeCapture = async request => {
      const receipt = await capture(request);
      if (request.operation !== "screenshot") return receipt;
      const stagingDir = request.payload.stagingDir;
      const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
      const path = "artifacts/failure.png";
      await mkdir(join(stagingDir, "artifacts"), { recursive: true });
      await mkdir(join(stagingDir, "attestations"), { recursive: true });
      await writeFile(join(stagingDir, path), bytes);
      const proof = { schemaVersion: "lakda/binary-artifact-attestation/v1", sourcePath: path, sourceSha256: "sha256:" + sha256(bytes), sourceSize: bytes.length,
        decision: "no-sensitive-content", redactionRuleVersion: "fixture/v1", secretScan: "pass", piiScan: "pass", tool: { name: "fixture", version: "1", policyDigest: digest("f") } };
      const payload = canonicalJson(proof);
      await writeFile(join(stagingDir, "attestations/binary-artifacts.jsonl"), JSON.stringify({ ...proof,
        signature: { algorithm: "ed25519", keyId: "fixture-operator", signedPayloadDigest: hash(payload), valueBase64: sign(null, Buffer.from(payload), privateKey).toString("base64") } }) + "\n");
      return { ...receipt, result: { ...receipt.result, artifactRefs: [{ schemaVersion: "lakda/adaptive-contracts/v1", artifactId: "fixture-screen", path, sha256: sha256(bytes), size: bytes.length,
        classification: "internal", redactionStatus: "not_required", securityStatus: "pass" }] } };
    };
    bridge.bridge.generateCandidates = async () => [{ schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "candidate-1", adapterId: "airtest-poco",
      targetRef: observation.targetRef, sourceFingerprint: fingerprintObservation(observation).value, actionKind: "back",
      locatorRecipe: { strategy: "image", value: "back" }, generatedBy: { ruleId: "fixture", observationId: observation.observationId, reason: "fixture" }, risk: { weight: 1 }, mutationKind: "none" }];
    const connect = LoopbackJsonBridge.connect; let connections = 0;
    LoopbackJsonBridge.connect = async () => { connections++; return bridge.bridge as LoopbackJsonBridge; };
    return { ...context, ...bridge, charterPath: join(root, "charter.json"), config, persist, connections: () => connections,
      close() { LoopbackJsonBridge.connect = connect; context.close(); } };
  } catch (error) { context.close(); throw error; }
}

test("native CLI initial execution saves identity and action proof with target-relative trust", async () => {
  const root = test.info().outputPath("native-cli-initial"), fixture = await nativeCliFixture(root);
  const output = mock.method(console, "log", () => {});
  try {
    expect(await exploreRunCommand({ charter: fixture.charterPath, report: "off" })).toBe(0);
    expect(fixture.connections()).toBe(1); expect(fixture.observations()).toBe(1); expect(fixture.legacy()).toBe(0);
    expect(fixture.sent.map(value => value.operation)).toEqual(["execute"]);
    const { loadExplorationSession } = await import("../src/exploration/session.js");
    const session = await loadExplorationSession(join(root, "explorations", (await readdir(join(root, "explorations")))[0]!));
    const { readSignedSessionNativeEvidence } = await import("../src/exploration/native-identity-evidence-target.js");
    const proof = await readSignedSessionNativeEvidence(session.paths, { charter: fixture.input.charter, configDigest: session.session.configDigest, trustKeys });
    expect(session.session).toMatchObject({ status: "completed", actionCount: 1 });
    expect(proof.complete).toBe(true); expect(proof.records.map(value => value.evidence.kind)).toEqual(["observation", "action-requested", "action-finished"]);
    expect(output.mock.calls).toHaveLength(1);
    fixture.clock.wall = now + 5000;
    const { exploreReportCommand } = await import("../src/commands/exploration.js");
    const reportPath = join(root, "saved-report.json");
    expect(await exploreReportCommand({ session: session.paths.root, out: reportPath })).toBe(0);
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({ sessionStatus: "completed", technicalOutcome: "passed", acceptanceStatus: "pending_external" });
  } finally { output.mock.restore(); fixture.close(); }
});

test("native CLI attestation setup resolves operator trust relative to the original target", async () => {
  const root = test.info().outputPath("native-cli-attestation-setup"), fixture = await nativeCliFixture(root, { handoff: true });
  const output = mock.method(console, "log", () => {});
  try {
    expect(await exploreRunCommand({ charter: fixture.charterPath, report: "off" })).toBe(0);
    expect(fixture.connections()).toBe(1); expect(fixture.sent).toHaveLength(1); expect(fixture.legacy()).toBe(0);
    expect(await readdir(join(root, "private"))).not.toHaveLength(0);
  } finally { output.mock.restore(); fixture.close(); }
});

test("native CLI rejects invalid preflight and identity without executing an action", async () => {
  for (const reason of ["config", "trust", "expired", "app", "device", "build", "unavailable", "video", "sampled"]) {
    const root = test.info().outputPath("native-cli-denied", reason), fixture = await nativeCliFixture(root, { video: reason === "video", sampled: reason === "sampled" });
    try {
      if (reason === "config") { fixture.data.manifest.configDigest = digest("f"); await fixture.persist(); }
      if (reason === "trust") await writeFile(join(root, "trust.json"), JSON.stringify({ keys: [...trustKeys, ...trustKeys] }));
      if (reason === "expired") fixture.clock.wall = now + 5000;
      if (reason === "app") fixture.data.acquisition.observation.fields.appId.value = "org.example.wrong";
      if (reason === "device") fixture.data.acquisition.observation.fields.deviceDigest.value = digest("e");
      if (reason === "build") fixture.data.acquisition.observation.fields.appBuild.value = "wrong-build";
      if (reason === "unavailable") fixture.data.acquisition.observation.fields.appBuild = { status: "unavailable", source: "unavailable", value: null };
      await expect(exploreRunCommand({ charter: fixture.charterPath, report: "off" })).rejects.toThrow();
      expect(fixture.sent, reason).toHaveLength(0); expect(fixture.legacy(), reason).toBe(0);
      expect(fixture.connections(), reason).toBe(["app", "device", "build", "unavailable"].includes(reason) ? 1 : 0);
    } finally { fixture.close(); }
  }
});

test("native CLI pauses and resumes with a new identity journal before replay", async () => {
  const root = test.info().outputPath("native-cli-resume"), fixture = await nativeCliFixture(root, { manualPause: true });
  const output = mock.method(console, "log", () => {});
  try {
    const { explorePauseCommand } = await import("../src/commands/exploration.js");
    const { loadExplorationSession } = await import("../src/exploration/session.js");
    const send = fixture.bridge.nativeAction!;
    fixture.bridge.nativeAction = async request => {
      const result = await send(request);
      if (fixture.sent.length === 1 || fixture.sent.length === 3) await explorePauseCommand({ session: join(root, "explorations", (await readdir(join(root, "explorations")))[0]!) });
      return result;
    };
    await exploreRunCommand({ charter: fixture.charterPath, report: "off" });
    const path = join(root, "explorations", (await readdir(join(root, "explorations")))[0]!);
    const paused = await loadExplorationSession(path);
    expect(paused.session).toMatchObject({ status: "paused", actionCount: 1 });
    fixture.clock.wall = now + 5000;
    await expect(exploreResumeCommand({ session: path, report: "off" })).rejects.toThrow();
    expect(fixture.connections()).toBe(1); expect(fixture.sent).toHaveLength(1);
    fixture.clock.wall = now + 1;
    await exploreResumeCommand({ session: path, report: "off" });
    expect(fixture.connections()).toBe(2); expect(fixture.observations()).toBe(2); expect(fixture.legacy()).toBe(0);
    expect(fixture.sent).toHaveLength(3);
    const current = await loadExplorationSession(path);
    expect(current.session).toMatchObject({ status: "paused", actionCount: 2 });
    const { readSignedSessionNativeEvidence } = await import("../src/exploration/native-identity-evidence-target.js");
    const saved = await readSignedSessionNativeEvidence(current.paths, { charter: fixture.input.charter, configDigest: current.session.configDigest, trustKeys });
    expect(saved.complete).toBe(true); expect(new Set(saved.records.map(value => value.journalId)).size).toBe(2);
    expect(saved.records).toHaveLength(12);
    expect(saved.records.filter(value => value.evidence.kind === "capture-requested")).toHaveLength(2);
    expect(saved.records.filter(value => value.evidence.kind === "capture-finished")).toHaveLength(2);
    expect(fixture.legacy()).toBe(0);
    const { generateReport } = await import("../src/reporting/generation.js");
    const report = await generateReport({ session: path }, { output: test.info().outputPath("native-capture-report"), profile: "local",
      producerVersion: "0.5.0-rc.1", timeoutMs: 10000, trustStorePath: join(root, "trust.json") });
    expect(report.receipt.generationStatus, JSON.stringify(report.receipt.issues)).toBe("ready");
    expect(report.receipt.issues.some(issue => issue.code === "invalid-native-evidence")).toBe(false);
    const { checkpointFromRun, resolveRunDirectoryReference } = await import("../src/exploration/session.js");
    const runDir = resolveRunDirectoryReference(fixture.input.charter.outputDir!, current.session.lastRunDir!);
    const tracePath = join(runDir, "adaptive/trace.json"), traceBytes = await readFile(tracePath);
    const trace = JSON.parse(traceBytes.toString()) as { trace: Array<Record<string, unknown>> };
    const lastExecution = trace.trace.findLastIndex(value => value.type === "execution");
    trace.trace.find(value => value.type === "execution")!.postFingerprint = "state:older-operation";
    trace.trace = trace.trace.filter((value, index) => !(index > lastExecution && value.type === "observation" && value.phase === "post-action"));
    await writeFile(tracePath, JSON.stringify(trace));
    await expect(checkpointFromRun(current.paths, { runId: current.session.runIds.at(-1)!, runDir })).rejects.toThrow(/postFingerprint/);
    await writeFile(tracePath, traceBytes);
    const changed = join(path, saved.references[0]!.path);
    const original = await readFile(changed);
    await writeFile(changed, original.toString() + " ");
    await expect(exploreResumeCommand({ session: path, report: "off" })).rejects.toThrow(/native/);
    expect(fixture.connections()).toBe(2); expect(fixture.sent).toHaveLength(3);
    await writeFile(changed, original);
    fixture.data.acquisition.observation.fields.deviceDigest.value = digest("e");
    await expect(exploreResumeCommand({ session: path, report: "off" })).rejects.toThrow(/native/);
    expect(fixture.connections()).toBe(3); expect(fixture.observations()).toBe(3); expect(fixture.sent).toHaveLength(3);
  } finally { output.mock.restore(); fixture.close(); }
});

test("native CLI draft starts with fresh proof and paused sessions require complete prior proof", async () => {
  for (const mode of ["draft", "paused-empty", "paused-unknown"]) {
    const root = test.info().outputPath("native-cli-draft", mode), fixture = await nativeCliFixture(root);
    const output = mock.method(console, "log", () => {});
    try {
      const charter = fixture.input.charter, created = await createExplorationSession(charter, fixture.config, join(root, "drafts"));
      const { copyTargetManifest, loadExplorationSession } = await import("../src/exploration/session.js");
      const sha256 = await copyTargetManifest(created.paths, charter.targetManifestPath!);
      await appendSessionEvent(created.paths, { type: "checkpoint", payload: { targetManifestDigest: sha256 } });
      const caps = fixture.bridge.capabilities();
      await writeCapabilitySnapshot(created.paths, capabilitySnapshotFromAdapter({ charter, adapterId: caps.adapterId, revision: caps.revision,
        observedTargetRevision: caps.targetRevision, runtimePlatform: caps.platform, targetKinds: caps.targetKinds, observationCapabilities: caps.observationCapabilities,
        actionCapabilities: caps.actionKinds, evidenceCapabilities: caps.evidenceCapabilities, liveness: caps.liveness, templateCorpusDigest: caps.templateCorpusDigest,
        device: caps.device, display: caps.display, rawCapabilityDigest: digest("b"), bridgeDigest: digest("a") }));
      if (mode !== "draft") await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
      if (mode === "paused-unknown") {
        const { createSessionNativeEvidenceSink } = await import("../src/exploration/native-identity-evidence-store.js");
        const manifest = signed(fixture.data.manifest);
        const evidence = await createSessionNativeEvidenceSink(created.paths, { manifest, sha256 });
        const { createNativeIdentityExecutor } = await import("../src/exploration/native-identity-executor.js");
        const executor = await createNativeIdentityExecutor({ ...fixture.input, targetBytes: await readFile(created.paths.targetManifest),
          configDigest: nativeIdentityDigest(fixture.config), evidence, bridge: { observeNativeIdentity: fixture.bridge.observeNativeIdentity, nativeAction: async () => { throw new Error("fixture response lost"); } } });
        await expect(executor.perform(fixture.action)).rejects.toMatchObject({ actionAttempted: "unknown" });
      }
      if (mode !== "draft") await appendSessionEvent(created.paths, { type: "session-paused", status: "paused" });
      if (mode === "draft") {
        expect(await exploreResumeCommand({ session: created.paths.root, report: "off" })).toBe(0);
        expect((await loadExplorationSession(created.paths.root)).session).toMatchObject({ status: "completed", actionCount: 1 });
        expect(fixture.observations()).toBe(1); expect(fixture.sent).toHaveLength(1);
      } else {
        await expect(exploreResumeCommand({ session: created.paths.root, report: "off" })).rejects.toThrow(/native/);
        expect(fixture.connections()).toBe(0); expect(fixture.sent).toHaveLength(0);
      }
      expect(fixture.legacy()).toBe(0);
    } finally { output.mock.restore(); fixture.close(); }
  }
});

test("native target policy accepts its age and provider-count boundaries without weakening required fields", async () => {
  const { manifest, acquisition, verify } = fixture();
  for (const age of [1000, 300000]) await expect(verify(signed(change(manifest, "nativeIdentity.maxAgeMs", age)))).resolves.toBeTruthy();
  const providers = structuredClone(manifest);
  for (let index = 1; index < 16; index += 1) {
    const provider = { name: "fixture-android", version: String(index + 1) };
    const mapping = { ...providers.nativeIdentity.buildMappings[0]!.mapping, provider };
    providers.nativeIdentity.allowedProviders.push(provider);
    providers.nativeIdentity.buildMappings.push({ mapping, mappingDigest: nativeBuildMappingDigest(mapping) });
  }
  await expect(verify(signed(providers))).resolves.toBeTruthy();
  providers.nativeIdentity.allowedProviders.push({ name: "fixture-android", version: "17" });
  await expect(verify(signed(providers))).rejects.toThrow(/schema/);
  const strict = (await verify(signed(change(manifest, "nativeIdentity.requiredFields", ["appId", "appBuild", "deviceDigest", "platformVersion"])))).manifest as NativeExplorationTargetManifest;
  expect(() => verifyNativeIdentityForTarget(strict, acquisition)).toThrow(/unobserved/);
});

test("unconnected default snapshot readers do not accept native v2 as stored identity evidence", async () => {
  const { manifest, charter } = fixture();
  await expect(verifySignedExplorationTargetManifestSnapshot(Buffer.from(JSON.stringify(manifest)), charter, digest("c"), { at, trustKeys })).rejects.toThrow(/native.*v2.*読取/);
});
