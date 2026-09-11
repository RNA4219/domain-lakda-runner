import { readFile } from "node:fs/promises";
import { createHash, verify } from "node:crypto";
import { relative, resolve } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { fileDigest } from "../core/artifact-store.js";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { assertAttestationResponse, ATTESTATION_RESPONSE_VERSION, type AcceptedBinaryAttestation } from "./attestation-contracts.js";
import { readAttestationTrustKeys, readStoredAttestationReceipt, verifyAttestationEvidence, type AttestationBinding, type AttestationEvidenceOptions } from "./attestation-evidence.js";

export const BINARY_ATTESTATION_VERSION = "lakda/binary-artifact-attestation/v1" as const;
export type BinaryArtifactAttestation = {
  schemaVersion: typeof BINARY_ATTESTATION_VERSION;
  sourcePath: string;
  sourceSha256: string;
  sourceSize: number;
  outputPath?: string;
  outputSha256?: string;
  outputSize?: number;
  decision: "no-sensitive-content" | "sanitized";
  redactionRuleVersion: string;
  secretScan: "pass";
  piiScan: "pass";
  tool?: { name: string; version: string; policyDigest: string };
  signature?: { algorithm: "ed25519"; keyId: string; signedPayloadDigest: string; valueBase64: string };
};

export type BinaryAttestationVerificationOptions = {
  requireSignature?: boolean;
  trustStorePath?: string;
  /**
   * When supplied, a signature key must be explicitly present in this
   * target-bound allowlist.  An empty allowlist therefore rejects every
   * signed binary (while a run with no binaries remains valid).
   */
  allowedKeyIds?: readonly string[];
  binding?: AttestationBinding;
};

export type StoredBinaryArtifactAttestation = BinaryArtifactAttestation | AcceptedBinaryAttestation;

type TrustKey = { keyId: string; publicKeyPem: string };

function portable(root: string, path: string): string {
  const candidate = resolve(root, path);
  const rel = relative(resolve(root), candidate).replaceAll("\\", "/");
  if (!rel || rel === ".." || rel.startsWith("../") || rel.includes("/../") || rel.startsWith("/")) throw new Error("binary attestation path is outside run directory");
  return rel;
}

function retainedPath(runDir: string, attestation: StoredBinaryArtifactAttestation): string {
  return portable(runDir, attestation.decision === "sanitized" ? attestation.outputPath! : attestation.sourcePath);
}

function isSha256(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }

function isStrictBase64(value: unknown): value is string { return typeof value === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value); }

/** Validate the decision-specific shape before adding an attestation to the map. */
function validShape(value: StoredBinaryArtifactAttestation, runDir: string): boolean {
  if (value.schemaVersion === ATTESTATION_RESPONSE_VERSION) {
    try { assertAttestationResponse(value); return ["no-sensitive-content", "sanitized"].includes(value.decision) && value.secretScan === "pass" && value.piiScan === "pass"; }
    catch { return false; }
  }
  if (value.schemaVersion !== BINARY_ATTESTATION_VERSION || value.secretScan !== "pass" || value.piiScan !== "pass") return false;
  if (typeof value.sourcePath !== "string" || !isSha256(value.sourceSha256) || !Number.isSafeInteger(value.sourceSize) || value.sourceSize < 0) return false;
  if (typeof value.redactionRuleVersion !== "string" || value.redactionRuleVersion.length < 1) return false;
  if (value.tool && (typeof value.tool.name !== "string" || !value.tool.name || typeof value.tool.version !== "string" || !value.tool.version || !isSha256(value.tool.policyDigest))) return false;
  if (value.signature && (value.signature.algorithm !== "ed25519" || typeof value.signature.keyId !== "string" || !value.signature.keyId || !isSha256(value.signature.signedPayloadDigest) || !isStrictBase64(value.signature.valueBase64))) return false;
  let sourcePath: string;
  try { sourcePath = portable(runDir, value.sourcePath); } catch { return false; }
  if (!sourcePath) return false;
  if (value.decision === "no-sensitive-content") {
    // A no-sensitive attestation retains the source bytes and must not carry
    // any sanitized-output fields.  The schema enforces this too; keeping the
    // check here makes JSONL ingestion fail closed without relying on AJV.
    return value.outputPath === undefined && value.outputSha256 === undefined && value.outputSize === undefined;
  }
  const outputSize = value.outputSize;
  if (value.decision !== "sanitized" || typeof value.outputPath !== "string" || !isSha256(value.outputSha256) || typeof outputSize !== "number" || !Number.isSafeInteger(outputSize) || outputSize < 0) return false;
  try {
    const outputPath = portable(runDir, value.outputPath);
    // Sanitized output is a distinct retained artifact.  In-place replacement
    // cannot prove that raw source bytes were not retained and is rejected.
    return outputPath !== sourcePath;
  } catch { return false; }
}

export async function readBinaryAttestations(runDir: string): Promise<Map<string, StoredBinaryArtifactAttestation>> {
  let raw: string;
  try { raw = await readFile(resolve(runDir, "attestations", "binary-artifacts.jsonl"), "utf8"); }
  catch { return new Map(); }
  return parseBinaryAttestations(runDir, raw);
}

/** Parse bytes already obtained through a bounded, integrity-checked reader. */
export function parseBinaryAttestations(runDir: string, raw: string): Map<string, StoredBinaryArtifactAttestation> {
  const map = new Map<string, StoredBinaryArtifactAttestation>();
  const tombstones = new Set<string>();
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    try {
      const value = JSON.parse(line) as StoredBinaryArtifactAttestation;
      const allowed = new Set(["schemaVersion", "sourcePath", "sourceSha256", "sourceSize", "outputPath", "outputSha256", "outputSize", "decision", "redactionRuleVersion", "secretScan", "piiScan", "tool", "signature"]);
      if (value.schemaVersion === ATTESTATION_RESPONSE_VERSION) { allowed.add("request"); allowed.add("requestSha256"); allowed.add("completedAt"); }
      let candidateRetained: string | undefined;
      try {
        const candidatePath = value.decision === "sanitized" && typeof value.outputPath === "string" ? value.outputPath : value.sourcePath;
        if (typeof candidatePath === "string") candidateRetained = portable(runDir, candidatePath);
      } catch { /* malformed paths are ignored below */ }
      // Even a malformed duplicate is a reason to tombstone an already
      // retained key; otherwise an attacker could append an invalid line to
      // make an earlier ambiguous attestation appear valid again.
      if (candidateRetained && !tombstones.has(candidateRetained) && map.has(candidateRetained)) { map.delete(candidateRetained); tombstones.add(candidateRetained); continue; }
      if (Object.keys(value as object).some(key => !allowed.has(key)) || !["no-sensitive-content", "sanitized"].includes(value.decision) || !validShape(value, runDir)
        || value.schemaVersion === ATTESTATION_RESPONSE_VERSION && canonicalJson(value) !== line) continue;
      const retained = retainedPath(runDir, value);
      // Duplicate retained paths are a permanent tombstone.  Do not let a
      // later line resurrect an ambiguous artifact by deleting/replacing the
      // earlier map entry.
      if (tombstones.has(retained)) continue;
      if (map.has(retained)) { map.delete(retained); tombstones.add(retained); continue; }
      map.set(retained, value);
    } catch { /* invalid attestation remains an explicit missing attestation */ }
  }
  return map;
}

async function readTrustKeys(path: string): Promise<TrustKey[]> {
  try {
    const value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
    const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { keys?: unknown }).keys) ? (value as { keys: unknown[] }).keys : [];
    return list.filter((item): item is TrustKey => Boolean(item && typeof item === "object" && typeof (item as TrustKey).keyId === "string" && typeof (item as TrustKey).publicKeyPem === "string"));
  } catch {
    return [];
  }
}

function attestationPayload(attestation: BinaryArtifactAttestation): string {
  const copy = structuredClone(attestation) as BinaryArtifactAttestation;
  delete copy.signature;
  return canonicalJson(copy);
}

function verifySignatureWithKeys(attestation: BinaryArtifactAttestation, keys: readonly TrustKey[], allowedKeyIds?: readonly string[]): boolean {
  if (!attestation.signature || attestation.signature.algorithm !== "ed25519") return false;
  if (allowedKeyIds !== undefined && (!allowedKeyIds.includes(attestation.signature.keyId) || allowedKeyIds.length === 0)) return false;
  const payload = attestationPayload(attestation);
  if (attestation.signature.signedPayloadDigest !== `sha256:${createHash("sha256").update(payload).digest("hex")}`) return false;
  const key = keys.find(value => value.keyId === attestation.signature?.keyId);
  if (!key) return false;
  try { return verify(null, Buffer.from(payload, "utf8"), key.publicKeyPem, Buffer.from(attestation.signature.valueBase64, "base64")); }
  catch { return false; }
}

async function verifySignature(attestation: BinaryArtifactAttestation, trustStorePath?: string, allowedKeyIds?: readonly string[]): Promise<boolean> {
  if (!attestation.signature || !trustStorePath || attestation.signature.algorithm !== "ed25519") return false;
  if (allowedKeyIds !== undefined && !allowedKeyIds.includes(attestation.signature.keyId)) return false;
  return verifySignatureWithKeys(attestation, await readTrustKeys(trustStorePath), allowedKeyIds);
}

/** Verify only the retained, already-hashed bytes; never reopen source or output paths. */
export function verifyBinaryAttestationSnapshot(runDir: string, path: string, attestation: StoredBinaryArtifactAttestation, snapshot: { size: number; sha256: string }, options: AttestationEvidenceOptions): boolean {
  try {
    if (!validShape(attestation, runDir) || portable(runDir, path) !== retainedPath(runDir, attestation)) return false;
    if (attestation.schemaVersion === ATTESTATION_RESPONSE_VERSION) return verifyAttestationEvidence(attestation, snapshot, options);
    if (options.binding !== undefined) return false;
    if (!verifySignatureWithKeys(attestation, options.trustKeys, options.allowedKeyIds)) return false;
    return attestation.decision === "sanitized"
      ? snapshot.size === attestation.outputSize && snapshot.sha256 === attestation.outputSha256
      : snapshot.size === attestation.sourceSize && snapshot.sha256 === attestation.sourceSha256;
  } catch { return false; }
}

export async function verifyBinaryAttestation(runDir: string, path: string, attestation: StoredBinaryArtifactAttestation, options: BinaryAttestationVerificationOptions = {}): Promise<boolean> {
  try {
    if (!validShape(attestation, runDir) || portable(runDir, path) !== retainedPath(runDir, attestation)) return false;
    if (attestation.schemaVersion === ATTESTATION_RESPONSE_VERSION) {
      if (!options.trustStorePath || !options.binding || !options.allowedKeyIds) return false;
      const snapshot = await readArtifactSnapshot(resolve(runDir), path);
      if (snapshot.path !== resolve(runDir, path)) return false;
      return verifyAttestationEvidence(attestation, snapshot, { binding: options.binding, allowedKeyIds: options.allowedKeyIds,
        trustKeys: await readAttestationTrustKeys(options.trustStorePath), receipt: await readStoredAttestationReceipt(runDir, attestation.request.requestId) });
    }
    if (options.binding !== undefined) return false;
    if (options.requireSignature && !(await verifySignature(attestation, options.trustStorePath, options.allowedKeyIds))) return false;
    if (attestation.decision === "no-sensitive-content") {
      const source = await fileDigest(resolve(runDir, portable(runDir, attestation.sourcePath)));
      return attestation.sourceSha256 === `sha256:${source.sha256}` && attestation.sourceSize === source.size;
    }
    // A trusted sanitizer signs the original source digest, then removes or
    // quarantines those raw bytes before Lakda finalizes the run. Requiring the
    // source file to remain in the publishable run would make safe sanitation
    // impossible; if it does remain, Artifact Policy sees it as a separate,
    // unattested binary and fails closed.
    if (!options.requireSignature) return false;
    const output = await fileDigest(resolve(runDir, portable(runDir, attestation.outputPath!)));
    return attestation.outputSha256 === `sha256:${output.sha256}` && attestation.outputSize === output.size;
  } catch { return false; }
}
