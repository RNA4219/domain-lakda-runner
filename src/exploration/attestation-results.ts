import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { assertAttestationReceipt, assertAttestationRequest, attestationRequestDigest, attestationTime,
  ATTESTATION_MESSAGE_MAX_BYTES, AttestationContractError, type BinaryAttestationRequest, type AttestationReceipt } from "./attestation-contracts.js";
import { attestationReceiptPath, type AttestationBinding } from "./attestation-evidence.js";

export type BinaryAttestationResult = {
  schemaVersion: "lakda/binary-attestation-result/v1"; request: BinaryAttestationRequest; requestSha256: string; receiptSha256: string;
  adoption: "adopted" | "failed" | "not-attempted"; reason: string | null;
  artifact: { path: string; size: number; sha256: string } | null;
};
type Snapshot = { size: number; sha256: string; bytes?: Uint8Array };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => {
  addSchema(schema: object): void; compile(schema: object): (value: unknown) => boolean;
};
const schema = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "schemas", name), "utf8")) as object;
const ajv = new Ajv({ strict: false, strictNumbers: true });
ajv.addSchema(schema("lakda-binary-attestation-request-v1.schema.json"));
const validate = ajv.compile(schema("lakda-binary-attestation-result-v1.schema.json"));

export function attestationResultPath(requestId: string): string {
  return attestationReceiptPath(requestId).replace("/receipts/", "/results/");
}

/** Runner adoption evidence is distinct from an attestor's signed media verdict. */
export function assertAttestationResult(value: unknown, receipt: AttestationReceipt, binding: AttestationBinding): asserts value is BinaryAttestationResult {
  try {
    if (!validate(value) || Buffer.byteLength(canonicalJson(value) + "\n") > ATTESTATION_MESSAGE_MAX_BYTES) throw new Error();
    const result = value as BinaryAttestationResult, request = result.request;
    assertAttestationRequest(request); assertAttestationReceipt(receipt);
    for (const field of ["runId", "sessionId", "targetManifestSha256", "policyDigest"] as const) {
      if (request[field] !== binding[field]) throw new Error();
    }
    if (result.requestSha256 !== attestationRequestDigest(request) || receipt.requestId !== request.requestId
      || receipt.requestSha256 !== result.requestSha256 || receipt.runId !== request.runId || receipt.targetManifestSha256 !== request.targetManifestSha256
      || result.receiptSha256 !== "sha256:" + sha256(canonicalJson(receipt) + "\n")
      || attestationTime(receipt.finishedAt) < attestationTime(request.createdAt)) throw new Error();
    if (result.adoption === "not-attempted") {
      if (receipt.status === "response-verified" || result.reason !== receipt.reason) throw new Error();
    } else {
      if (receipt.status !== "response-verified" || receipt.receivedAt === null
        || attestationTime(receipt.receivedAt) < attestationTime(request.createdAt)
        || attestationTime(receipt.finishedAt) >= attestationTime(request.expiresAt)) throw new Error();
    }
    if (result.artifact && (result.artifact.path !== request.sourcePath && result.artifact.path !== request.outputPath)) throw new Error();
    if (result.artifact?.path === request.sourcePath
      && (result.artifact.size !== request.sourceSize || result.artifact.sha256 !== request.sourceSha256)) throw new Error();
  } catch { throw new AttestationContractError("result-invalid"); }
}

function decode(snapshot: Snapshot | undefined): unknown {
  try {
    if (!snapshot?.bytes || snapshot.size > ATTESTATION_MESSAGE_MAX_BYTES || snapshot.size !== snapshot.bytes.length
      || snapshot.sha256 !== "sha256:" + sha256(Buffer.from(snapshot.bytes))) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes), value: unknown = JSON.parse(text);
    if (text !== canonicalJson(value) + "\n") throw new Error();
    return value;
  } catch { throw new AttestationContractError("result-record-invalid"); }
}

/** Only supplied, digest-checked snapshots participate; never read unlisted files as a fallback. */
export function readAttestationResults(snapshots: ReadonlyMap<string, Snapshot>, binding: AttestationBinding, summary?: unknown): BinaryAttestationResult[] {
  const results: BinaryAttestationResult[] = [], sources = new Set<string>(), receipts = new Map<string, AttestationReceipt>();
  for (const [path, snapshot] of snapshots) {
    if (!path.startsWith("attestations/results/")) continue;
    const value = decode(snapshot) as BinaryAttestationResult;
    if (!validate(value) || path !== attestationResultPath(value.request.requestId)) throw new AttestationContractError("result-invalid");
    const receipt = decode(snapshots.get(attestationReceiptPath(value.request.requestId))) as AttestationReceipt;
    assertAttestationResult(value, receipt, binding);
    if (sources.has(value.request.sourcePath)) throw new AttestationContractError("result-source-duplicate");
    sources.add(value.request.sourcePath); results.push(value); receipts.set(value.request.requestId, receipt);
  }
  if (summary !== undefined) {
    try {
      const saved = summary as { requested: number; adopted: number; results: Array<{ requestId: string }> };
      if (!saved || !Array.isArray(saved.results)) throw new Error();
      const expected = results.map(result => ({ requestId: result.request.requestId, sourcePath: result.request.sourcePath,
        receiptStatus: receipts.get(result.request.requestId)!.status, adoption: result.adoption, reason: result.reason,
        ...(result.artifact ? { artifactPath: result.artifact.path } : {}) }));
      const order = (a: { requestId: string }, b: { requestId: string }) => a.requestId.localeCompare(b.requestId);
      if (canonicalJson({ ...saved, results: [...saved.results].sort(order) }) !== canonicalJson({ requested: results.length,
        adopted: results.filter(result => result.adoption === "adopted").length, results: expected.sort(order) })) throw new Error();
    } catch { throw new AttestationContractError("result-summary-mismatch"); }
  }
  return results;
}
