import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { createAttestationRequest, attestationRequestDigest, type AttestationReceipt } from "../src/exploration/attestation-contracts.js";
import { attestationReceiptPath } from "../src/exploration/attestation-evidence.js";
import { assertAttestationResult, attestationResultPath, readAttestationResults, type BinaryAttestationResult } from "../src/exploration/attestation-results.js";
import { inspectArtifactPolicy } from "../src/core/artifact-policy.js";
import { exportHate } from "../src/core/hate.js";
import type { LakdaConfig } from "../src/core/types.js";
import { loadReportRun } from "../src/reporting/run-source.js";
import { projectAttestationResults } from "../src/reporting/attestation-results.js";

const hash = (value: unknown) => "sha256:" + sha256(canonicalJson(value) + "\n");
function fixture() {
  const now = Date.parse("2020-01-01T00:00:00.000Z");
  const binding = { runId: "fixture-run", sessionId: "fixture-session", targetManifestSha256: "sha256:" + "a".repeat(64), policyDigest: "sha256:" + "b".repeat(64) };
  const request = createAttestationRequest({ ...binding, sourcePath: "artifacts/failure.png", sourceSize: 10, sourceSha256: "sha256:" + "c".repeat(64), mediaType: "image/png" }, { now, timeoutMs: 1000 });
  const receipt: AttestationReceipt = { schemaVersion: "lakda/binary-attestation-receipt/v1", requestId: request.requestId, requestSha256: attestationRequestDigest(request),
    runId: request.runId, targetManifestSha256: request.targetManifestSha256, status: "timeout", reason: "request-expired", responseSha256: null, receivedAt: null, finishedAt: "2020-01-01T00:00:01.001Z" };
  const result: BinaryAttestationResult = { schemaVersion: "lakda/binary-attestation-result/v1", request, requestSha256: receipt.requestSha256, receiptSha256: hash(receipt), adoption: "not-attempted", reason: receipt.reason, artifact: null };
  return { binding, request, receipt, result };
}
function snapshot(value: unknown, raw = canonicalJson(value) + "\n") { const bytes = Buffer.from(raw); return { bytes, size: bytes.length, sha256: "sha256:" + sha256(bytes) }; }

test("historical timeout is a runner result, not a verified media decision", () => {
  const f = fixture();
  expect(() => assertAttestationResult(f.result, f.receipt, f.binding)).not.toThrow();
  const records = new Map([[attestationResultPath(f.request.requestId), snapshot(f.result)], [attestationReceiptPath(f.request.requestId), snapshot(f.receipt)]]);
  expect(readAttestationResults(records, f.binding)).toEqual([f.result]);
  expect(() => assertAttestationResult({ ...f.result, adoption: "adopted" }, f.receipt, f.binding)).toThrow();
});

test("result rejects wrong bindings, missing reasons, unknown fields, and contradictory adoption", () => {
  const f = fixture();
  for (const field of ["runId", "sessionId", "targetManifestSha256", "policyDigest"] as const) {
    expect(() => assertAttestationResult(f.result, f.receipt, { ...f.binding, [field]: "wrong" })).toThrow();
  }
  for (const change of [{ reason: null }, { reason: "different" }, { receiptSha256: "sha256:" + "d".repeat(64) }, { requestSha256: "sha256:" + "d".repeat(64) },
    { adoption: "failed" }, { artifact: { path: f.request.sourcePath, size: 10, sha256: f.request.sourceSha256 } }, { extra: true }]) {
    expect(() => assertAttestationResult({ ...f.result, ...change }, f.receipt, f.binding)).toThrow();
  }
});

test("verified response may fail adoption and successful adoption requires a bound artifact", () => {
  const f = fixture();
  const receipt: AttestationReceipt = { ...f.receipt, status: "response-verified", reason: null, responseSha256: "sha256:" + "d".repeat(64), receivedAt: "2020-01-01T00:00:00.500Z", finishedAt: "2020-01-01T00:00:00.600Z" };
  const result = { ...f.result, receiptSha256: hash(receipt), adoption: "failed", reason: "media-adoption-failed" };
  expect(() => assertAttestationResult(result, receipt, f.binding)).not.toThrow();
  const adopted = { ...result, adoption: "adopted", reason: null, artifact: { path: f.request.sourcePath, size: f.request.sourceSize, sha256: f.request.sourceSha256 } };
  expect(() => assertAttestationResult(adopted, receipt, f.binding)).not.toThrow();
  for (const change of [{ path: "artifacts/other.png" }, { size: 9 }, { sha256: "sha256:" + "d".repeat(64) }]) {
    expect(() => assertAttestationResult({ ...adopted, artifact: { ...adopted.artifact, ...change } }, receipt, f.binding)).toThrow();
  }
});

test("result snapshot requires canonical listed receipt bytes with matching hashes", () => {
  const f = fixture(), resultPath = attestationResultPath(f.request.requestId), receiptPath = attestationReceiptPath(f.request.requestId);
  const records = new Map([[resultPath, snapshot(f.result)], [receiptPath, snapshot(f.receipt)]]);
  const missing = new Map(records); missing.delete(receiptPath); expect(() => readAttestationResults(missing, f.binding)).toThrow();
  for (const ref of [resultPath, receiptPath]) {
    for (const altered of [snapshot(ref === resultPath ? f.result : f.receipt, JSON.stringify(ref === resultPath ? f.result : f.receipt)),
      { ...records.get(ref)!, sha256: "sha256:" + "e".repeat(64) }, { ...records.get(ref)!, size: 65537 }]) {
      const bad = new Map(records); bad.set(ref, altered); expect(() => readAttestationResults(bad, f.binding)).toThrow();
    }
  }
  const renamed = new Map(records); renamed.delete(resultPath); renamed.set("attestations/results/wrong.json", snapshot(f.result));
  expect(() => readAttestationResults(renamed, f.binding)).toThrow();
});

test("two requests cannot account for the same original media path", () => {
  const a = fixture(), b = fixture();
  const records = new Map([a, b].flatMap(f => [[attestationResultPath(f.request.requestId), snapshot(f.result)], [attestationReceiptPath(f.request.requestId), snapshot(f.receipt)]] as const));
  expect(() => readAttestationResults(records, a.binding)).toThrow(/result-source-duplicate/);
});

test("the saved run summary requires every result and preserves its status and reason", () => {
  const f = fixture(), records = new Map([[attestationResultPath(f.request.requestId), snapshot(f.result)], [attestationReceiptPath(f.request.requestId), snapshot(f.receipt)]]);
  const summary = { requested: 1, adopted: 0, results: [{ requestId: f.request.requestId, sourcePath: f.request.sourcePath, receiptStatus: "timeout", adoption: "not-attempted", reason: "request-expired" }] };
  expect(readAttestationResults(records, f.binding, summary)).toEqual([f.result]);
  expect(() => readAttestationResults(new Map(), f.binding, summary)).toThrow(/result-summary-mismatch/);
  for (const changed of [{ ...summary, requested: 0 }, { ...summary, adopted: 1 }, { ...summary, results: [] }, { ...summary, extra: true },
    { ...summary, results: [...summary.results, ...summary.results] }, { ...summary, results: [{ ...summary.results[0], receiptStatus: "rejected" }] },
    { ...summary, results: [{ ...summary.results[0], reason: "another-reason" }] }]) {
    expect(() => readAttestationResults(records, f.binding, changed)).toThrow(/result-summary-mismatch/);
  }
});

const roots: string[] = [];
test.afterEach(async () => {
  for (const path of roots.splice(0)) {
    if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith("lakda-attestation-result-")) throw new Error("unexpected result fixture root");
    await rm(path, { recursive: true, force: true });
  }
});
async function policyFixture() {
  const f = fixture(), run = await mkdtemp(join(tmpdir(), "lakda-attestation-result-")); roots.push(run);
  const expectations = { screenshot: true, trace: false, video: false, har: false, domSnapshots: 0 };
  const metadata = { schemaVersion: "lakda/run-metadata/v1", runId: f.binding.runId, attempt: 1, seed: 1, mode: "smoke", commitSha: "a".repeat(40), producerVersion: "0.5.0-rc.1",
    startedAt: f.request.createdAt, endedAt: f.receipt.finishedAt, outcome: "error", terminationReason: "artifact_failure",
    artifactPolicy: { classification: "internal", maxRunBytes: 1048576, expectations, binaryAttestationRequired: true, binaryAttestationBinding: f.binding } };
  const files = new Map<string, unknown>([[attestationResultPath(f.request.requestId), f.result], [attestationReceiptPath(f.request.requestId), f.receipt],
    ["run-metadata.json", metadata], ["action-sequence.json", { schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: 1, baseUrl: "http://fixture.invalid", actions: [] }], ["failure-report.json", { failures: [] }]]);
  for (const [path, value] of files) { await mkdir(dirname(join(run, path)), { recursive: true }); await writeFile(join(run, path), canonicalJson(value) + "\n"); }
  await writeFile(join(run, "console.jsonl"), "");
  const manifestPath = join(run, "exports/artifact-manifest.json"), config = { artifacts: metadata.artifactPolicy } as unknown as LakdaConfig;
  const options = { required: true, binding: f.binding };
  return { ...f, run, metadata, manifestPath, config, options, expectations };
}

test("diagnostic HATE preserves the missing expectation and rejects success or unrelated missing evidence", async () => {
  const f = await policyFixture();
  const policy = await inspectArtifactPolicy(f.run, f.config, "error", f.expectations, [], f.options);
  expect(policy.profileMissingPaths).toEqual(["artifacts/failure.png"]); expect(policy.documentedMissingPaths).toEqual(policy.profileMissingPaths);
  await exportHate(f.run, f.manifestPath); const original = await readFile(f.manifestPath);
  const manifest = JSON.parse(original.toString()); expect(manifest.artifacts.some((a: { path: string }) => a.path === attestationResultPath(f.request.requestId))).toBe(true);
  for (const outcome of ["passed", "failed", "partial"]) {
    await writeFile(join(f.run, "run-metadata.json"), canonicalJson({ ...f.metadata, outcome }) + "\n");
    await expect(exportHate(f.run, f.manifestPath)).rejects.toThrow(/result-outcome-invalid/);
    expect(await readFile(f.manifestPath)).toEqual(original);
  }
  for (const extra of [{ trace: true }, { har: true }, { video: true }, { domSnapshots: 1 }]) {
    const metadata = { ...f.metadata, artifactPolicy: { ...f.metadata.artifactPolicy, expectations: { ...f.expectations, ...extra } } };
    await writeFile(join(f.run, "run-metadata.json"), canonicalJson(metadata) + "\n");
    await expect(exportHate(f.run, f.manifestPath)).rejects.toThrow(/artifact policy/); expect(await readFile(f.manifestPath)).toEqual(original);
  }
});

test("diagnostic HATE rejects an absent result, mismatched receipt, and newly retained original bytes", async () => {
  const f = await policyFixture(); await exportHate(f.run, f.manifestPath); const original = await readFile(f.manifestPath);
  const resultPath = join(f.run, attestationResultPath(f.request.requestId));
  await rm(resultPath); await expect(exportHate(f.run, f.manifestPath)).rejects.toThrow();
  await writeFile(resultPath, canonicalJson(f.result) + "\n");
  const receiptPath = join(f.run, attestationReceiptPath(f.request.requestId));
  await writeFile(receiptPath, canonicalJson({ ...f.receipt, runId: "another-run" }) + "\n");
  await expect(exportHate(f.run, f.manifestPath)).rejects.toThrow(/result-invalid/);
  await writeFile(receiptPath, canonicalJson(f.receipt) + "\n");
  await mkdir(join(f.run, "artifacts")); await writeFile(join(f.run, f.request.sourcePath), Buffer.alloc(10));
  await expect(exportHate(f.run, f.manifestPath)).rejects.toThrow(/raw-media-retained/);
  expect(await readFile(f.manifestPath)).toEqual(original);
});

test("report diagnosis verifies listed records and honors their classification and scan state", async () => {
  const f = await policyFixture(); await exportHate(f.run, f.manifestPath);
  const input = await loadReportRun(f.run);
  expect(input.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "attestation-media-unavailable", message: expect.stringContaining("request-expired") })]));
  const ref = attestationResultPath(f.request.requestId), record = input.snapshot.artifacts.find(a => a.path === ref)!;
  const invoke = () => { const source = { ...input.source }, issues: typeof input.issues = []; projectAttestationResults(input.snapshot, input.metadata, source, issues); return { source, issues }; };
  record.classification = "confidential"; expect(invoke().source.classification).toBe("confidential");
  record.classification = "restricted"; const hidden = invoke();
  expect(hidden.issues).toEqual([expect.objectContaining({ code: "restricted-attestation-result" })]); expect(JSON.stringify(hidden)).not.toContain(f.request.sourcePath);
  record.classification = "internal"; record.security_checks.secrets_scan = "fail"; expect(invoke).toThrow(/採用記録/);
  record.security_checks.secrets_scan = "pass";
  const saved = input.snapshot.snapshots.get(attestationReceiptPath(f.request.requestId))!;
  input.snapshot.snapshots.delete(attestationReceiptPath(f.request.requestId)); expect(invoke).toThrow(/採用記録/);
  input.snapshot.snapshots.set(attestationReceiptPath(f.request.requestId), saved);
  input.metadata.outcome = "passed"; expect(invoke).toThrow(/採用記録/);
});
