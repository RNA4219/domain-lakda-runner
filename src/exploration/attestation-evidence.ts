import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { assertAttestationReceipt, attestationRequestDigest, attestationTime, ATTESTATION_MESSAGE_MAX_BYTES,
  AttestationContractError, type AcceptedBinaryAttestation, type AttestationReceipt } from "./attestation-contracts.js";
import { verifyAttestationResponse, type AttestationTrustKey } from "./attestation-response.js";

export type AttestationBinding = { runId: string; sessionId?: string; targetManifestSha256: string; policyDigest: string };
export type AttestationEvidenceOptions = { trustKeys: readonly AttestationTrustKey[]; allowedKeyIds?: readonly string[]; binding?: AttestationBinding; receipt?: unknown };

export function attestationReceiptPath(requestId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new AttestationContractError("request-invalid");
  return `attestations/receipts/${requestId}.json`;
}

/** Historical validation uses the saved receipt time, never an implicit fresh acceptance window. */
export function verifyAttestationEvidence(response: AcceptedBinaryAttestation, snapshot: { size: number; sha256: string }, options: AttestationEvidenceOptions): boolean {
  try {
    if (!options.binding || !options.allowedKeyIds) return false;
    const { request } = response;
    for (const field of ["runId", "sessionId", "targetManifestSha256", "policyDigest"] as const) {
      if (request[field] !== options.binding[field]) return false;
    }
    const receipt = options.receipt;
    assertAttestationReceipt(receipt);
    if (receipt.status !== "response-verified" || receipt.requestId !== request.requestId || receipt.requestSha256 !== attestationRequestDigest(request)
      || receipt.runId !== request.runId || receipt.targetManifestSha256 !== request.targetManifestSha256 || receipt.receivedAt === null
      || attestationTime(receipt.finishedAt) >= attestationTime(request.expiresAt)
      || receipt.responseSha256 !== "sha256:" + sha256(canonicalJson(response) + "\n")) return false;
    const verified = verifyAttestationResponse(request, response, { trustKeys: options.trustKeys, allowedKeyIds: options.allowedKeyIds, now: attestationTime(receipt.receivedAt) });
    return verified.decision === "sanitized"
      ? snapshot.size === verified.outputSize && snapshot.sha256 === verified.outputSha256
      : snapshot.size === verified.sourceSize && snapshot.sha256 === verified.sourceSha256;
  } catch { return false; }
}

export async function readStoredAttestationReceipt(runDirectory: string, requestId: string): Promise<AttestationReceipt> {
  try {
    const ref = attestationReceiptPath(requestId);
    const snapshot = await readArtifactSnapshot(resolve(runDirectory), ref, { retain: true, maxBytes: ATTESTATION_MESSAGE_MAX_BYTES });
    const bytes = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes), value: unknown = JSON.parse(bytes);
    assertAttestationReceipt(value);
    if (snapshot.path !== resolve(runDirectory, ref) || value.requestId !== requestId || bytes !== canonicalJson(value) + "\n") throw new Error();
    return value;
  } catch { throw new AttestationContractError("receipt-invalid"); }
}

/** Strict, bounded operator-selected trust for v2; no filtering malformed keys into a valid list. */
export async function readAttestationTrustSnapshot(path: string) {
  try {
    const requested = resolve(path), actual = await realpath(requested);
    const snapshot = await readArtifactSnapshot(dirname(actual), basename(actual), { retain: true, maxBytes: 131_072 });
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes));
    const keys: unknown = Array.isArray(value) ? value : value && typeof value === "object" && Object.keys(value).length === 1 && "keys" in value ? value.keys : undefined;
    if (!Array.isArray(keys) || await realpath(requested) !== actual) throw new Error();
    // The response verifier validates every key and the target-bound allowlist together.
    return { keys: keys as AttestationTrustKey[], requestedPath: requested, snapshot: { path: actual, size: snapshot.size, sha256: snapshot.sha256 } };
  } catch { throw new AttestationContractError("trust-invalid"); }
}

export async function readAttestationTrustKeys(path: string): Promise<AttestationTrustKey[]> {
  return (await readAttestationTrustSnapshot(path)).keys;
}

export async function verifyAttestationTrustUnchanged(trust: Awaited<ReturnType<typeof readAttestationTrustSnapshot>>): Promise<void> {
  try {
    if (await realpath(trust.requestedPath) !== trust.snapshot.path) throw new Error();
    await readArtifactSnapshot(dirname(trust.snapshot.path), basename(trust.snapshot.path), { expected: trust.snapshot, maxBytes: 131_072 });
  } catch { throw new AttestationContractError("trust-changed"); }
}
