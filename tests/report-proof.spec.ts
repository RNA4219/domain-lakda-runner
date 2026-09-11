import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { parseBinaryAttestations, verifyBinaryAttestationSnapshot, type BinaryArtifactAttestation } from "../src/exploration/binary-attestation.js";
import { targetManifestSigningPayload, verifySignedExplorationTargetManifestSnapshot, type ExplorationTargetManifest } from "../src/exploration/target-manifest.js";
import type { ExplorationCharter } from "../src/exploration/contracts.js";

test("binary snapshot proof verifies signed retained bytes without accessing file paths", () => {
  const root = "/fixture/report-proof";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = [{ keyId: "fixture-sanitizer", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }];
  const base: BinaryArtifactAttestation = {
    schemaVersion: "lakda/binary-artifact-attestation/v1", sourcePath: "artifacts/raw.png", sourceSha256: "sha256:" + sha256("raw"), sourceSize: 3,
    outputPath: "artifacts/safe.png", outputSha256: "sha256:" + sha256("safe"), outputSize: 4, decision: "sanitized",
    redactionRuleVersion: "fixture/v1", secretScan: "pass", piiScan: "pass", tool: { name: "fixture", version: "1", policyDigest: "sha256:" + sha256("policy") },
  };
  const payload = canonicalJson(base);
  const proof: BinaryArtifactAttestation = { ...base, signature: { algorithm: "ed25519", keyId: keys[0].keyId, signedPayloadDigest: "sha256:" + sha256(payload), valueBase64: sign(null, Buffer.from(payload), privateKey).toString("base64") } };
  const raw = JSON.stringify(proof) + "\n";
  const records = parseBinaryAttestations(root, raw);
  expect(records.size).toBe(1); expect(records.has(base.sourcePath)).toBe(false);
  const snapshot = { size: 4, sha256: base.outputSha256! };
  const options = { trustKeys: keys, allowedKeyIds: [keys[0].keyId] };
  expect(verifyBinaryAttestationSnapshot(root, base.outputPath!, proof, snapshot, options)).toBe(true);
  expect(verifyBinaryAttestationSnapshot(root, base.sourcePath, proof, snapshot, options)).toBe(false);
  expect(verifyBinaryAttestationSnapshot(root, base.outputPath!, proof, { ...snapshot, size: 5 }, options)).toBe(false);
  expect(verifyBinaryAttestationSnapshot(root, base.outputPath!, proof, snapshot, { ...options, allowedKeyIds: [] })).toBe(false);
  expect(verifyBinaryAttestationSnapshot(root, base.outputPath!, { ...proof, outputSize: 5 }, { ...snapshot, size: 5 }, options)).toBe(false);
  expect(parseBinaryAttestations(root, raw + raw).size).toBe(0);
});

test("target snapshot validation uses only supplied operator keys and preserves binding and historical time checks", async () => {
  const charter = JSON.parse(readFileSync(resolve(import.meta.dirname, "../examples/exploration-charter.playwright.json"), "utf8")) as ExplorationCharter;
  charter.executionMode = "real"; charter.targetManifestPath = "missing-target.json"; charter.trustStorePath = "untrusted-missing-store.json";
  charter.baseUrl = "https://fixture.invalid"; charter.scope.allowHosts = ["fixture.invalid"];
  const configDigest = "sha256:" + sha256("fixture-config");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const trustKeys = [{ keyId: "fixture-operator", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }];
  const manifest: ExplorationTargetManifest = {
    schemaVersion: "lakda/exploration-target-manifest/v1", manifestId: "fixture-target", status: "ready", owner: "fixture",
    charterDigest: "sha256:" + sha256(canonicalJson(charter)), configDigest, targetRevision: charter.targetRevision,
    platform: charter.platform, adapterId: charter.adapter.id, executionMode: "real",
    target: { identity: { kind: "web", origin: new URL(charter.baseUrl!).origin, pathPrefixes: charter.scope.pathPrefixes ?? ["/"] } },
    safety: { allowMutationKinds: ["none"], resetProcedureRef: "fixture/reset", killSwitchRef: "fixture/kill" },
    bridgeBinding: { capabilityDigest: "sha256:" + sha256("capability"), bridgeDigest: "sha256:" + sha256("bridge") },
    artifactAttestorKeyIds: ["fixture-sanitizer"],
    signature: { algorithm: "ed25519", keyId: trustKeys[0].keyId, validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z", approvalEvidenceRef: "fixture/approval", signedPayloadDigest: "", valueBase64: "" },
  };
  const payload = targetManifestSigningPayload(manifest);
  manifest.signature.signedPayloadDigest = "sha256:" + sha256(payload);
  manifest.signature.valueBase64 = sign(null, Buffer.from(payload), privateKey).toString("base64");
  const bytes = Buffer.from(JSON.stringify(manifest)); const options = { trustKeys, at: "2026-07-01T00:00:00.000Z" };
  expect(await verifySignedExplorationTargetManifestSnapshot(bytes, charter, configDigest, options)).toMatchObject({ sha256: "sha256:" + sha256(bytes), manifest: { artifactAttestorKeyIds: ["fixture-sanitizer"] } });
  await expect(verifySignedExplorationTargetManifestSnapshot(bytes, charter, "sha256:" + sha256("other-config"), options)).rejects.toThrow(/config binding/);
  await expect(verifySignedExplorationTargetManifestSnapshot(bytes, charter, configDigest, { ...options, trustKeys: [] })).rejects.toThrow(/署名keyId/);
  await expect(verifySignedExplorationTargetManifestSnapshot(bytes, charter, configDigest, { ...options, at: "2027-01-01T00:00:00.000Z" })).rejects.toThrow(/承認期限/);
  const changed = Buffer.from(JSON.stringify({ ...manifest, artifactAttestorKeyIds: ["other-sanitizer"] }));
  await expect(verifySignedExplorationTargetManifestSnapshot(changed, charter, configDigest, options)).rejects.toThrow(/payload digest/);
});
