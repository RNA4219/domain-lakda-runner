import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { inspectArtifactPolicy } from "../src/core/artifact-policy.js";
import { buildSessionHateManifest, createExplorationSession } from "../src/exploration/session.js";
import { readBinaryAttestations, verifyBinaryAttestation, type BinaryArtifactAttestation } from "../src/exploration/binary-attestation.js";
import type { ExplorationCharter } from "../src/exploration/contracts.js";

async function digest(path: string): Promise<{ sha256: string; size: number }> {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes), size: bytes.byteLength };
}

function unsignedAttestation(source: string, sourceDigest: { sha256: string; size: number }, decision: BinaryArtifactAttestation["decision"], output?: string, outputDigest?: { sha256: string; size: number }): BinaryArtifactAttestation {
  return {
    schemaVersion: "lakda/binary-artifact-attestation/v1", sourcePath: source, sourceSha256: `sha256:${sourceDigest.sha256}`, sourceSize: sourceDigest.size,
    ...(output && outputDigest ? { outputPath: output, outputSha256: `sha256:${outputDigest.sha256}`, outputSize: outputDigest.size } : {}),
    decision, redactionRuleVersion: "test/v1", secretScan: "pass", piiScan: "pass",
  };
}

async function writeAttestations(root: string, values: BinaryArtifactAttestation[]): Promise<void> {
  await mkdir(join(root, "attestations"), { recursive: true });
  await writeFile(join(root, "attestations", "binary-artifacts.jsonl"), values.map(value => JSON.stringify(value)).join("\n") + "\n", "utf8");
}

test("sanitized attestation retains only outputPath and never deputizes raw source", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-binary-attestation-sanitized-"));
  try {
    const sourcePath = join(root, "artifacts", "raw.png");
    const outputPath = join(root, "artifacts", "sanitized.png");
    await mkdir(join(root, "artifacts"), { recursive: true });
    await writeFile(sourcePath, Buffer.from("raw-sensitive-bytes"));
    await writeFile(outputPath, Buffer.from("sanitized-bytes"));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const base = unsignedAttestation("artifacts/raw.png", await digest(sourcePath), "sanitized", "artifacts/sanitized.png", await digest(outputPath));
    const payload = canonicalJson(base);
    const attestation: BinaryArtifactAttestation = { ...base, signature: { algorithm: "ed25519", keyId: "sanitizer", signedPayloadDigest: `sha256:${sha256(payload)}`, valueBase64: sign(null, Buffer.from(payload), privateKey).toString("base64") } };
    const trustStore = join(root, "trust-store.json");
    await writeFile(trustStore, JSON.stringify({ keys: [{ keyId: "sanitizer", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }] }), "utf8");
    await writeAttestations(root, [attestation]);
    const loaded = await readBinaryAttestations(root);
    expect(loaded.has("artifacts/raw.png")).toBe(false);
    expect(loaded.has("artifacts/sanitized.png")).toBe(true);
    const verification = { requireSignature: true, trustStorePath: trustStore, allowedKeyIds: ["sanitizer"] } as const;
    expect(await verifyBinaryAttestation(root, "artifacts/sanitized.png", loaded.get("artifacts/sanitized.png")!, verification)).toBe(true);
    expect(await verifyBinaryAttestation(root, "artifacts/raw.png", loaded.get("artifacts/sanitized.png")!, verification)).toBe(false);
    const withRawSource = await inspectArtifactPolicy(root, { artifacts: { maxRunBytes: 1_000_000, classification: "restricted" } } as never, "passed", { trace: false, screenshot: false, video: false, har: false, domSnapshots: 0 }, [], { required: true, trustStorePath: trustStore, allowedKeyIds: ["sanitizer"] });
    expect(withRawSource.residualSensitivePaths).toContain("artifacts/raw.png");
    expect(withRawSource.residualSensitivePaths).not.toContain("artifacts/sanitized.png");
    await rm(sourcePath);
    expect(await verifyBinaryAttestation(root, "artifacts/sanitized.png", loaded.get("artifacts/sanitized.png")!, verification)).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("duplicate retained paths are tombstoned instead of last-write-wins", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-binary-attestation-duplicate-"));
  try {
    const sourcePath = join(root, "artifacts", "sample.bin");
    await mkdir(join(root, "artifacts"), { recursive: true });
    await writeFile(sourcePath, Buffer.from("sample"));
    const attestation = unsignedAttestation("artifacts/sample.bin", await digest(sourcePath), "no-sensitive-content");
    await writeAttestations(root, [attestation, attestation]);
    expect((await readBinaryAttestations(root)).has("artifacts/sample.bin")).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("target attestor allowlist rejects an otherwise trusted unauthorized signature", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-binary-attestation-key-"));
  try {
    const sourcePath = join(root, "artifacts", "sample.bin");
    await mkdir(join(root, "artifacts"), { recursive: true });
    await writeFile(sourcePath, Buffer.from("sample"));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const base = unsignedAttestation("artifacts/sample.bin", await digest(sourcePath), "no-sensitive-content");
    const payload = canonicalJson(base);
    const attestation: BinaryArtifactAttestation = { ...base, signature: { algorithm: "ed25519", keyId: "unauthorized", signedPayloadDigest: `sha256:${sha256(payload)}`, valueBase64: sign(null, Buffer.from(payload), privateKey).toString("base64") } };
    await writeAttestations(root, [attestation]);
    const trustStore = join(root, "trust-store.json");
    await writeFile(trustStore, JSON.stringify({ keys: [{ keyId: "unauthorized", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }] }), "utf8");
    const loaded = await readBinaryAttestations(root);
    expect(await verifyBinaryAttestation(root, "artifacts/sample.bin", loaded.get("artifacts/sample.bin")!, { requireSignature: true, trustStorePath: trustStore, allowedKeyIds: ["approved"] })).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fixture session HATE marks binary scans not_applicable instead of UTF-8 pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-session-binary-fixture-"));
  const charter: ExplorationCharter = {
    schemaVersion: "lakda/exploration-charter/v1", charterId: "fixture-binary", targetRevision: "fixture-v1", platform: "pc-web", executionMode: "fixture", adapter: { id: "playwright" }, baseUrl: "http://127.0.0.1:3000", persona: "guest", scope: { allowHosts: ["127.0.0.1"] }, budget: { durationMs: 100, maxActions: 1, maxActionsPerMinute: 1 }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" }, capture: { video: "off", screenshot: "finding-non-pass-bookmark", sampledFrames: { enabled: false, intervalMs: 1000, maxFrames: 1, maxBytes: 1, source: "playwright", stopTimeoutMs: 1000 } }, templateCorpusVersion: "templates/v1", seed: 1,
  };
  try {
    const created = await createExplorationSession(charter, { mode: "adaptive-explore", seed: 1 }, root);
    await mkdir(join(created.paths.root, "artifacts"), { recursive: true });
    await writeFile(join(created.paths.root, "artifacts", "failure.png"), Buffer.from([0, 255, 1, 254]));
    const manifest = await buildSessionHateManifest(created.paths, created.session) as { artifacts: Array<{ path: string; security_checks: { secrets_scan: string; pii_scan: string }; redaction_status: string }> };
    const binary = manifest.artifacts.find(artifact => artifact.path === "artifacts/failure.png");
    expect(binary?.security_checks).toEqual({ secrets_scan: "not_applicable", pii_scan: "not_applicable" });
    expect(binary?.redaction_status).toBe("pending");
  } finally { await rm(root, { recursive: true, force: true }); }
});
