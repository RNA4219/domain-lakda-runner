import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { inspectArtifactPolicy } from "../src/core/artifact-policy.js";
import { exportHate } from "../src/core/hate.js";
import type { LakdaConfig } from "../src/core/types.js";
import { createAttestationRequest, attestationRequestDigest, type AcceptedBinaryAttestation, type AttestationReceipt } from "../src/exploration/attestation-contracts.js";
import { parseBinaryAttestations, verifyBinaryAttestation, verifyBinaryAttestationSnapshot } from "../src/exploration/binary-attestation.js";

const roots: string[] = [];
test.afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("lakda-attestation-v2-")) throw new Error("unexpected fixture root");
    await rm(root, { recursive: true, force: true });
  }
});

function fixture() {
  const keys = generateKeyPairSync("ed25519"), now = Date.parse("2020-01-01T00:00:00.000Z"), bytes = Buffer.from("verified fixture output");
  const request = createAttestationRequest({ runId: "fixture-run", sessionId: "fixture-session", targetManifestSha256: "sha256:" + "a".repeat(64),
    sourcePath: "artifacts/failure.png", sourceSize: 100, sourceSha256: "sha256:" + "b".repeat(64), mediaType: "image/png", policyDigest: "sha256:" + "c".repeat(64) }, { now });
  const payload: Omit<AcceptedBinaryAttestation, "signature"> = { schemaVersion: "lakda/binary-artifact-attestation/v2", request, requestSha256: attestationRequestDigest(request),
    sourcePath: request.sourcePath, sourceSize: request.sourceSize, sourceSha256: request.sourceSha256,
    outputPath: request.outputPath, outputSize: bytes.length, outputSha256: "sha256:" + sha256(bytes), decision: "sanitized",
    secretScan: "pass", piiScan: "pass", redactionRuleVersion: "fixture/v1", completedAt: request.createdAt,
    tool: { name: "fixture-scanner", version: "1", policyDigest: request.policyDigest } };
  const canonical = canonicalJson(payload);
  const response: AcceptedBinaryAttestation = { ...payload, signature: { algorithm: "ed25519", keyId: "fixture", signedPayloadDigest: "sha256:" + sha256(canonical), valueBase64: sign(null, Buffer.from(canonical), keys.privateKey).toString("base64") } };
  const receipt: AttestationReceipt = { schemaVersion: "lakda/binary-attestation-receipt/v1", requestId: request.requestId, requestSha256: payload.requestSha256,
    runId: request.runId, targetManifestSha256: request.targetManifestSha256, status: "response-verified", reason: null,
    responseSha256: "sha256:" + sha256(canonicalJson(response) + "\n"), receivedAt: request.createdAt, finishedAt: request.createdAt };
  const trustKeys = [{ keyId: "fixture", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }];
  const binding = { runId: request.runId, sessionId: request.sessionId, targetManifestSha256: request.targetManifestSha256, policyDigest: request.policyDigest };
  const snapshot = { size: bytes.length, sha256: "sha256:" + sha256(bytes) };
  return { request, response, receipt, bytes, snapshot, binding, trustKeys, keys, options: { trustKeys, allowedKeyIds: ["fixture"], binding, receipt } };
}

test("v2 parsing retains the signed version and tombstones conflicting retained paths", () => {
  const value = fixture(), line = canonicalJson(value.response);
  const records = parseBinaryAttestations(process.cwd(), line + "\n");
  expect(records.get(value.request.outputPath)?.schemaVersion).toBe("lakda/binary-artifact-attestation/v2");
  const legacy = { schemaVersion: "lakda/binary-artifact-attestation/v1", sourcePath: value.request.outputPath, sourceSize: value.bytes.length,
    sourceSha256: value.snapshot.sha256, decision: "no-sensitive-content", redactionRuleVersion: "legacy", secretScan: "pass", piiScan: "pass" };
  for (const lines of [[line, canonicalJson(legacy)], [canonicalJson(legacy), line], [line, line]]) {
    expect(parseBinaryAttestations(process.cwd(), lines.join("\n")).has(value.request.outputPath)).toBe(false);
  }
});

test("a saved v2 proof uses its verified receipt time instead of today's clock", () => {
  const value = fixture();
  expect(Date.now()).toBeGreaterThan(Date.parse(value.request.expiresAt));
  expect(verifyBinaryAttestationSnapshot(process.cwd(), value.request.outputPath, value.response, value.snapshot, value.options)).toBe(true);
});

test("v2 requires the exact run, session, target, policy, receipt and allowed key", () => {
  const value = fixture();
  for (const options of [{ trustKeys: value.trustKeys }, { ...value.options, receipt: undefined }, { ...value.options, binding: undefined },
    { ...value.options, allowedKeyIds: [] }, { ...value.options, allowedKeyIds: undefined },
    ...Object.keys(value.binding).map(field => ({ ...value.options, binding: { ...value.binding, [field]: "different" } }))]) {
    expect(verifyBinaryAttestationSnapshot(process.cwd(), value.request.outputPath, value.response, value.snapshot, options)).toBe(false);
  }
});

test("a receipt cannot change request binding, response bytes, or the accepted time window", () => {
  const value = fixture();
  for (const change of [{ requestId: "00000000-0000-4000-8000-000000000001" }, { requestSha256: "sha256:" + "d".repeat(64) },
    { runId: "other-run" }, { targetManifestSha256: "sha256:" + "d".repeat(64) }, { responseSha256: "sha256:" + "d".repeat(64) },
    { finishedAt: value.request.expiresAt }, { receivedAt: value.request.expiresAt, finishedAt: value.request.expiresAt }, { status: "timeout", reason: "request-expired" }]) {
    expect(verifyBinaryAttestationSnapshot(process.cwd(), value.request.outputPath, value.response, value.snapshot, { ...value.options, receipt: { ...value.receipt, ...change } })).toBe(false);
  }
});

test("historical signature validation still requires the retained path and exact media bytes", () => {
  const value = fixture();
  expect(verifyBinaryAttestationSnapshot(process.cwd(), value.request.sourcePath, value.response, value.snapshot, value.options)).toBe(false);
  for (const change of [{ size: value.snapshot.size + 1 }, { sha256: "sha256:" + "d".repeat(64) }]) {
    expect(verifyBinaryAttestationSnapshot(process.cwd(), value.request.outputPath, value.response, { ...value.snapshot, ...change }, value.options)).toBe(false);
  }
});

test("a request for v2 binding cannot be satisfied by an otherwise valid legacy signature", () => {
  const value = fixture();
  const payload = { schemaVersion: "lakda/binary-artifact-attestation/v1" as const, sourcePath: value.request.outputPath,
    sourceSize: value.snapshot.size, sourceSha256: value.snapshot.sha256, decision: "no-sensitive-content" as const,
    redactionRuleVersion: "legacy", secretScan: "pass" as const, piiScan: "pass" as const };
  const canonical = canonicalJson(payload), legacy = { ...payload, signature: { algorithm: "ed25519" as const, keyId: "fixture",
    signedPayloadDigest: "sha256:" + sha256(canonical), valueBase64: sign(null, Buffer.from(canonical), value.keys.privateKey).toString("base64") } };
  expect(verifyBinaryAttestationSnapshot(process.cwd(), payload.sourcePath, legacy, value.snapshot, { trustKeys: value.trustKeys, allowedKeyIds: ["fixture"] })).toBe(true);
  expect(verifyBinaryAttestationSnapshot(process.cwd(), payload.sourcePath, legacy, value.snapshot, value.options)).toBe(false);
});

test("file verification reads the bounded v2 receipt and fails when it is absent or changed", async () => {
  const value = fixture(), root = await mkdtemp(join(tmpdir(), "lakda-attestation-v2-")); roots.push(root);
  await mkdir(dirname(join(root, value.request.outputPath)), { recursive: true });
  await mkdir(join(root, "attestations/receipts"), { recursive: true });
  await writeFile(join(root, value.request.outputPath), value.bytes);
  const receiptPath = join(root, "attestations/receipts", value.request.requestId + ".json"), trustPath = join(root, "trust.json");
  await writeFile(receiptPath, canonicalJson(value.receipt) + "\n"); await writeFile(trustPath, canonicalJson({ keys: value.trustKeys }));
  const options = { requireSignature: true, trustStorePath: trustPath, allowedKeyIds: ["fixture"], binding: value.binding };
  expect(await verifyBinaryAttestation(root, value.request.outputPath, value.response, options)).toBe(true);
  await writeFile(receiptPath, canonicalJson(value.receipt) + "\n\n");
  expect(await verifyBinaryAttestation(root, value.request.outputPath, value.response, options)).toBe(false);
  await rm(receiptPath);
  expect(await verifyBinaryAttestation(root, value.request.outputPath, value.response, options)).toBe(false);
  expect(await readFile(join(root, value.request.outputPath))).toEqual(value.bytes);
});

async function policyFixture() {
  const value = fixture(), root = await mkdtemp(join(tmpdir(), "lakda-attestation-v2-")); roots.push(root);
  const run = join(root, "run"), trustPath = join(root, "trust.json");
  await mkdir(dirname(join(run, value.request.outputPath)), { recursive: true });
  await mkdir(join(run, "attestations/receipts"), { recursive: true });
  await writeFile(join(run, value.request.outputPath), value.bytes);
  await writeFile(join(run, "attestations/receipts", value.request.requestId + ".json"), canonicalJson(value.receipt) + "\n");
  await writeFile(join(run, "attestations/binary-artifacts.jsonl"), canonicalJson(value.response) + "\n");
  await writeFile(trustPath, canonicalJson({ keys: value.trustKeys }));
  const expectations = { screenshot: true, trace: false, video: false, har: false, domSnapshots: 0 };
  const metadata = { runId: value.request.runId, attempt: 1, commitSha: "a".repeat(40), producerVersion: "0.5.0-rc.1", outcome: "failed",
    startedAt: value.request.createdAt, endedAt: value.receipt.finishedAt, artifactPolicy: { classification: "internal", maxRunBytes: 1_048_576,
      expectations, binaryAttestationRequired: true, attestationTrustStorePath: trustPath, artifactAttestorKeyIds: ["fixture"], binaryAttestationBinding: value.binding } };
  await writeFile(join(run, "run-metadata.json"), canonicalJson(metadata) + "\n");
  for (const name of ["action-sequence.json", "failure-report.json"]) await writeFile(join(run, name), "{}\n");
  await writeFile(join(run, "console.jsonl"), "");
  return { ...value, root, run, trustPath, expectations, metadata };
}

test("Artifact Policy fulfills a required screenshot only through a verified source-to-output mapping", async () => {
  const value = await policyFixture(), config = { artifacts: { maxRunBytes: 1_048_576, classification: "internal" } } as LakdaConfig;
  const options = { required: true, trustStorePath: value.trustPath, allowedKeyIds: ["fixture"], binding: value.binding };
  const policy = await inspectArtifactPolicy(value.run, config, "failed", value.expectations, [], options);
  expect(policy.residualSensitivePaths).toEqual([]); expect(policy.profileMissingPaths).toEqual([]);
  expect(policy.securityByPath[value.request.outputPath]).toEqual({ redactionStatus: "redacted", secretsScan: "pass", piiScan: "pass" });
  const invalid = await inspectArtifactPolicy(value.run, config, "failed", value.expectations, [], { ...options, binding: { ...value.binding, runId: "different" } });
  expect(invalid.residualSensitivePaths).toContain(value.request.outputPath); expect(invalid.profileMissingPaths).toContain(value.request.sourcePath);
});

test("HATE re-export revalidates v2 using archived run binding and never registers the raw source", async () => {
  const value = await policyFixture(), manifestPath = join(value.run, "exports/artifact-manifest.json");
  await exportHate(value.run, manifestPath);
  const original = await readFile(manifestPath);
  const manifest = JSON.parse(original.toString("utf8")) as { artifacts: Array<{ path: string }> };
  expect(manifest.artifacts.some(artifact => artifact.path === value.request.outputPath)).toBe(true);
  expect(manifest.artifacts.some(artifact => artifact.path === value.request.sourcePath)).toBe(false);
  expect(manifest.artifacts.some(artifact => artifact.path === `attestations/receipts/${value.request.requestId}.json`)).toBe(true);
  value.metadata.artifactPolicy.binaryAttestationBinding.policyDigest = "sha256:" + "d".repeat(64);
  await writeFile(join(value.run, "run-metadata.json"), canonicalJson(value.metadata) + "\n");
  await expect(exportHate(value.run, manifestPath)).rejects.toThrow(/artifact policy/);
  expect(await readFile(manifestPath)).toEqual(original);
});
