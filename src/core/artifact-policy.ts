import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactExpectations, LakdaConfig, RunOutcome } from "./types.js";
import { findSensitive } from "./redaction.js";
import { fileDigest, listFiles, portablePath } from "./artifact-store.js";
import type { ArtifactSecurityRecord } from "./artifact-store.js";
import { readBinaryAttestations, verifyBinaryAttestation } from "../exploration/binary-attestation.js";
import type { AttestationBinding } from "../exploration/attestation-evidence.js";
import { checkAttestationResultMedia, readPublishedAttestationResults } from "../exploration/attestation-policy.js";
import { AttestationContractError } from "../exploration/attestation-contracts.js";

export type VerifiedArtifact = { path: string; size: number; sha256: string; security: ArtifactSecurityRecord };

export type ArtifactPolicyReport = {
  securityByPath: Record<string, ArtifactSecurityRecord>;
  verifiedArtifacts: VerifiedArtifact[];
  residualSensitivePaths: string[];
  missingPaths: string[];
  profileMissingPaths: string[];
  documentedMissingPaths?: string[];
  sizeBytes: number;
  sizeExceeded: boolean;
  unsupportedPaths: string[];
};

export type BinaryAttestationOptions = { required?: boolean; trustStorePath?: string; allowedKeyIds?: readonly string[]; binding?: AttestationBinding; summary?: unknown };

function binary(path: string): boolean {
  return /\.(zip|png|jpg|jpeg|webm|mp4)$/i.test(path);
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
  const mediaPaths = new Set(relativeFiles);
  const required = ["run-metadata.json", "action-sequence.json", "console.jsonl", "failure-report.json"];
  const missingPaths = required.filter(path => !relativeFiles.includes(path));
  const profileMissingPaths: string[] = [];
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
        ? await verifyBinaryAttestation(runDir, rel, attestation, { requireSignature: true, trustStorePath: binaryAttestation.trustStorePath, ...(binaryAttestation.allowedKeyIds !== undefined ? { allowedKeyIds: binaryAttestation.allowedKeyIds } : {}), ...(binaryAttestation.binding !== undefined ? { binding: binaryAttestation.binding } : {}) })
        : false;
      if (attested && attestation) mediaPaths.add(attestation.sourcePath);
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
  const logicalMediaPaths = [...mediaPaths];
  if (outcome !== "passed" || expected.trace || expected.screenshot) {
    if (expected.trace && !hasPath(logicalMediaPaths, "artifacts/trace.zip")) profileMissingPaths.push("artifacts/trace.zip");
    if (expected.screenshot && !hasPath(logicalMediaPaths, "artifacts/failure.png")) profileMissingPaths.push("artifacts/failure.png");
  }
  if (expected.video && !logicalMediaPaths.some(path => path.startsWith("artifacts/video/") && /\.(webm|mp4)$/i.test(path))) profileMissingPaths.push("artifacts/video/*.{webm,mp4}");
  let documentedMissingPaths: string[] = [];
  if (binaryAttestation.summary !== undefined && (!binaryAttestation.required || !binaryAttestation.binding)) throw new AttestationContractError("result-binding-missing");
  if (binaryAttestation.required && binaryAttestation.binding && (binaryAttestation.summary !== undefined || relativeFiles.some(path => path.startsWith("attestations/results/")))) {
    const filesWithDigest = verifiedArtifacts.map(file => ({ ...file, sha256: "sha256:" + file.sha256 }));
    const results = await readPublishedAttestationResults(runDir, filesWithDigest, binaryAttestation.binding, binaryAttestation.summary);
    for (const result of results) {
      if (result.adoption !== "adopted") continue;
      const proof = attestations.get(result.artifact!.path), security = securityByPath[result.artifact!.path];
      if (proof?.schemaVersion !== "lakda/binary-artifact-attestation/v2" || proof.requestSha256 !== result.requestSha256
        || security?.secretsScan !== "pass" || security.piiScan !== "pass") throw new AttestationContractError("result-adoption-unverified");
    }
    const unavailable = new Set(checkAttestationResultMedia(results, filesWithDigest));
    if (unavailable.size && outcome !== "error") throw new AttestationContractError("result-outcome-invalid");
    documentedMissingPaths = profileMissingPaths.filter(path => unavailable.has(path)
      || path === "artifacts/video/*.{webm,mp4}" && [...unavailable].some(source => source.startsWith("artifacts/video/") && /\.(webm|mp4)$/i.test(source)));
  }
  const size = (await Promise.all(files.map(async path => (await stat(path)).size))).reduce((total, value) => total + value, 0);
  return { securityByPath, verifiedArtifacts, residualSensitivePaths, missingPaths, profileMissingPaths, documentedMissingPaths, sizeBytes: size, sizeExceeded: size > config.artifacts.maxRunBytes, unsupportedPaths };
}

export async function removeSensitiveArtifacts(runDir: string, relativePaths: string[]): Promise<void> {
  await Promise.all(relativePaths.map(path => rm(join(runDir, path), { force: true })));
}
