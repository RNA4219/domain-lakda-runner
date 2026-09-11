import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import {
  assertAttestationRequest, assertAttestationResponse, attestationRequestDigest, attestationTime,
  AttestationContractError, type AcceptedBinaryAttestation, type BinaryAttestationRequest,
} from "./attestation-contracts.js";

export type AttestationTrustKey = { keyId: string; publicKeyPem: string };
export type AttestationResponseContext = { now?: number; allowedKeyIds: readonly string[]; trustKeys: readonly AttestationTrustKey[] };

function trustedKeys(context: AttestationResponseContext): Map<string, KeyObject> {
  try {
    if (!Array.isArray(context.trustKeys) || context.trustKeys.length === 0 || context.trustKeys.length > 64
      || Buffer.byteLength(JSON.stringify(context.trustKeys), "utf8") > 131_072
      || !Array.isArray(context.allowedKeyIds) || context.allowedKeyIds.length > 64
      || context.allowedKeyIds.some(value => typeof value !== "string" || !value || value.length > 128)
      || new Set(context.allowedKeyIds).size !== context.allowedKeyIds.length) throw new Error();
    const keys = new Map<string, KeyObject>();
    for (const value of context.trustKeys) {
      if (!value || typeof value !== "object" || Object.keys(value).some(name => !["keyId", "publicKeyPem"].includes(name))
        || typeof value.keyId !== "string" || !value.keyId || value.keyId.length > 128 || keys.has(value.keyId)
        || typeof value.publicKeyPem !== "string" || !value.publicKeyPem.trim().startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error();
      const key = createPublicKey(value.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") throw new Error();
      keys.set(value.keyId, key);
    }
    return keys;
  } catch { throw new AttestationContractError("trust-invalid"); }
}

export function assertAttestationTrust(context: AttestationResponseContext): void {
  const keys = trustedKeys(context);
  if (!context.allowedKeyIds.some(keyId => keys.has(keyId))) throw new AttestationContractError("untrusted-key");
}

/** Validate a response against the locally stored request; this does not read or certify media bytes. */
export function verifyAttestationResponse(request: BinaryAttestationRequest, value: unknown, context: AttestationResponseContext): AcceptedBinaryAttestation {
  assertAttestationRequest(request);
  assertAttestationResponse(value);
  if (value.requestSha256 !== attestationRequestDigest(request) || canonicalJson(value.request) !== canonicalJson(request)) throw new AttestationContractError("request-mismatch");
  if (value.sourcePath !== request.sourcePath || value.sourceSize !== request.sourceSize || value.sourceSha256 !== request.sourceSha256) throw new AttestationContractError("source-mismatch");
  if (value.decision === "sanitized" && value.outputPath !== request.outputPath) throw new AttestationContractError("output-mismatch");
  if (value.tool.policyDigest !== request.policyDigest) throw new AttestationContractError("policy-mismatch");
  const now = context.now ?? Date.now(), created = attestationTime(request.createdAt), expires = attestationTime(request.expiresAt);
  const completed = attestationTime(value.completedAt);
  if (!Number.isSafeInteger(now) || now < created || completed < created || completed >= expires || completed > now) throw new AttestationContractError("time-invalid");
  if (now >= expires) throw new AttestationContractError("request-expired");
  const keys = trustedKeys(context);
  if (!context.allowedKeyIds.includes(value.signature.keyId) || !keys.has(value.signature.keyId)) throw new AttestationContractError("untrusted-key");
  const payload = structuredClone(value) as Partial<typeof value>;
  delete payload.signature;
  const canonical = canonicalJson(payload);
  if (value.signature.signedPayloadDigest !== "sha256:" + sha256(canonical)
    || !verify(null, Buffer.from(canonical, "utf8"), keys.get(value.signature.keyId)!, Buffer.from(value.signature.valueBase64, "base64"))) {
    throw new AttestationContractError("signature-invalid");
  }
  if (value.decision === "rejected" || value.secretScan !== "pass" || value.piiScan !== "pass") throw new AttestationContractError("scan-failed");
  return structuredClone(value) as AcceptedBinaryAttestation;
}
