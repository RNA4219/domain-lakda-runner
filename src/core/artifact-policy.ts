import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactExpectations, LakdaConfig, RunOutcome } from "./types.js";
import { findSensitive } from "./redaction.js";
import { fileDigest, listFiles, portablePath } from "./artifact-store.js";
import type { ArtifactSecurityRecord } from "./artifact-store.js";
import { readBinaryAttestations, verifyBinaryAttestation } from "../exploration/binary-attestation.js";

export type VerifiedArtifact = { path: string; size: number; sha256: string; security: ArtifactSecurityRecord };

export type ArtifactPolicyReport = {
  securityByPath: Record<string, ArtifactSecurityRecord>;
  verifiedArtifacts: VerifiedArtifact[];
  residualSensitivePaths: string[];
  missingPaths: string[];
  profileMissingPaths: string[];
  sizeBytes: number;
  sizeExceeded: boolean;
  unsupportedPaths: string[];
};

export type BinaryAttestationOptions = { required?: boolean; trustStorePath?: string; allowedKeyIds?: readonly string[] };

function binary(path: string): boolean {
  return /\.(zip|png|jpg|jpeg|webm)$/i.test(path);
}

function textArtifact(path: string): boolean {
  return /\.(json|jsonl|html|txt|har)$/i.test(path);
}

function hasPath(files: string[], suffix: string): boolean {
  return files.some(path => path.endsWith(suffix));
}

export function isGeneratedExportPath(runDir: string, path: string): boolean {
  return portablePath(runDir, path).startsWith("exports/");
}

export async function inspectArtifactPolicy(
  runDir: string,
  config: LakdaConfig,
  outcome: RunOutcome,
  expected: ArtifactExpectations,
  excludePaths: string[] = [],
  binaryAttestation: BinaryAttestationOptions = {},
): Promise<ArtifactPolicyReport> {
  const files = (await listFiles(runDir)).filter(path => !excludePaths.includes(path) && !isGeneratedExportPath(runDir, path));
  const relativeFiles = files.map(path => portablePath(runDir, path));
  const required = ["run-metadata.json", "action-sequence.json", "console.jsonl", "failure-report.json"];
  const missingPaths = required.filter(path => !relativeFiles.includes(path));
  const profileMissingPaths: string[] = [];
  if (outcome !== "passed" || expected.trace || expected.screenshot) {
    if (expected.trace && !hasPath(relativeFiles, "artifacts/trace.zip")) profileMissingPaths.push("artifacts/trace.zip");
    if (expected.screenshot && !hasPath(relativeFiles, "artifacts/failure.png")) profileMissingPaths.push("artifacts/failure.png");
  }
  if (expected.video && !relativeFiles.some(path => path.startsWith("artifacts/video/") && path.endsWith(".webm"))) profileMissingPaths.push("artifacts/video/*.webm");
  if (expected.har && !hasPath(relativeFiles, "artifacts/network.har")) profileMissingPaths.push("artifacts/network.har");
  const domCount = relativeFiles.filter(path => path.startsWith("artifacts/dom/") && path.endsWith(".html")).length;
  if (expected.domSnapshots !== domCount) profileMissingPaths.push(`artifacts/dom/*.html (${domCount}/${expected.domSnapshots})`);

  const securityByPath: Record<string, ArtifactSecurityRecord> = {};
  const verifiedArtifacts: VerifiedArtifact[] = [];
  const residualSensitivePaths: string[] = [];
  const unsupportedPaths: string[] = [];
  const attestations = binaryAttestation.required ? await readBinaryAttestations(runDir) : new Map();
  for (const path of files) {
    const rel = portablePath(runDir, path);
    const digest = await fileDigest(path);
    if (binary(rel)) {
      const attestation = attestations.get(rel);
      const attested = binaryAttestation.required && attestation
        ? await verifyBinaryAttestation(runDir, rel, attestation, { requireSignature: true, trustStorePath: binaryAttestation.trustStorePath, ...(binaryAttestation.allowedKeyIds !== undefined ? { allowedKeyIds: binaryAttestation.allowedKeyIds } : {}) })
        : false;
      // A retained screenshot/trace/video is not text-scanned merely because
      // the current profile does not require a signed binary attestation.
      // Keep ordinary local evidence, but represent its scan state honestly;
      // real exploration remains fail-closed below until attestation verifies.
      const security: ArtifactSecurityRecord = attested
        ? { redactionStatus: attestation?.decision === "sanitized" ? "redacted" : "not_required", secretsScan: "pass", piiScan: "pass" }
        : binaryAttestation.required
          ? { redactionStatus: "pending", secretsScan: "fail", piiScan: "fail" }
          : { redactionStatus: "pending", secretsScan: "not_applicable", piiScan: "not_applicable" };
      securityByPath[rel] = security;
      verifiedArtifacts.push({ path: rel, size: digest.size, sha256: digest.sha256, security });
      if (binaryAttestation.required && !attested) residualSensitivePaths.push(rel);
      continue;
    }
    if (!textArtifact(rel)) { unsupportedPaths.push(rel); continue; }
    const findings = findSensitive(await readFile(path, "utf8"));
    const secrets = findings.includes("secret") ? "fail" : "pass";
    const pii = findings.includes("pii") ? "fail" : "pass";
    const security: ArtifactSecurityRecord = { redactionStatus: findings.length ? "failed" : "redacted", secretsScan: secrets, piiScan: pii };
    securityByPath[rel] = security;
    verifiedArtifacts.push({ path: rel, size: digest.size, sha256: digest.sha256, security });
    if (findings.length) residualSensitivePaths.push(rel);
  }
  const size = (await Promise.all(files.map(async path => (await stat(path)).size))).reduce((total, value) => total + value, 0);
  return { securityByPath, verifiedArtifacts, residualSensitivePaths, missingPaths, profileMissingPaths, sizeBytes: size, sizeExceeded: size > config.artifacts.maxRunBytes, unsupportedPaths };
}

export async function removeSensitiveArtifacts(runDir: string, relativePaths: string[]): Promise<void> {
  await Promise.all(relativePaths.map(path => rm(join(runDir, path), { force: true })));
}
