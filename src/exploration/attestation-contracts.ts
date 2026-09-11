import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";

export const ATTESTATION_REQUEST_VERSION = "lakda/binary-attestation-request/v1" as const;
export const ATTESTATION_RESPONSE_VERSION = "lakda/binary-artifact-attestation/v2" as const;
export const ATTESTATION_MESSAGE_MAX_BYTES = 65_536;
export type BinaryMediaType = "image/png" | "image/jpeg" | "video/webm" | "video/mp4" | "application/zip";
export type BinaryAttestationRequest = {
  schemaVersion: typeof ATTESTATION_REQUEST_VERSION;
  requestId: string; runId: string; sessionId?: string; targetManifestSha256: string;
  sourcePath: string; sourceSha256: string; sourceSize: number; outputPath: string;
  mediaType: BinaryMediaType; policyDigest: string; nonce: string; createdAt: string; expiresAt: string;
};
export type BinaryAttestationResponse = {
  schemaVersion: typeof ATTESTATION_RESPONSE_VERSION;
  request: BinaryAttestationRequest; requestSha256: string;
  sourcePath: string; sourceSha256: string; sourceSize: number;
  outputPath?: string; outputSha256?: string; outputSize?: number;
  decision: "no-sensitive-content" | "sanitized" | "rejected";
  redactionRuleVersion: string; secretScan: "pass" | "fail"; piiScan: "pass" | "fail";
  tool: { name: string; version: string; policyDigest: string }; completedAt: string;
  signature: { algorithm: "ed25519"; keyId: string; signedPayloadDigest: string; valueBase64: string };
};
export type AcceptedBinaryAttestation = Omit<BinaryAttestationResponse, "decision" | "secretScan" | "piiScan"> & {
  decision: "no-sensitive-content" | "sanitized"; secretScan: "pass"; piiScan: "pass";
};
export type AttestationReceipt = {
  schemaVersion: "lakda/binary-attestation-receipt/v1"; requestId: string; requestSha256: string;
  runId: string; targetManifestSha256: string; status: "response-verified" | "rejected" | "timeout" | "cancelled" | "error";
  reason: string | null; responseSha256: string | null; receivedAt: string | null; finishedAt: string;
};
export class AttestationContractError extends Error {
  constructor(readonly code: string) { super("binary-attestation: " + code); this.name = "AttestationContractError"; }
}

type Validator = (value: unknown) => boolean;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => {
  addSchema(schema: object): void; compile(schema: object): Validator;
};
const schema = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "schemas", name), "utf8")) as object;
const ajv = new Ajv({ allErrors: false, strict: false, strictNumbers: true });
const requestSchema = schema("lakda-binary-attestation-request-v1.schema.json");
const validateRequest = ajv.compile(requestSchema);
const validateResponse = ajv.compile(schema("lakda-binary-artifact-attestation-v2.schema.json"));
const validateReceipt = ajv.compile(schema("lakda-binary-attestation-receipt-v1.schema.json"));
const mediaTypes: Record<string, BinaryMediaType> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4", ".zip": "application/zip" };

function assertJson(value: unknown, validate: Validator, code: string): void {
  try {
    if (!validate(value)) throw new Error();
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > ATTESTATION_MESSAGE_MAX_BYTES || canonicalJson(JSON.parse(json)) !== canonicalJson(value)) throw new Error();
  } catch { throw new AttestationContractError(code); }
}

export function attestationTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

export function assertAttestationReceipt(value: unknown): asserts value is AttestationReceipt {
  assertJson(value, validateReceipt, "receipt-invalid");
  const receipt = value as AttestationReceipt, finished = attestationTime(receipt.finishedAt);
  const received = receipt.receivedAt === null ? null : attestationTime(receipt.receivedAt);
  if (!Number.isFinite(finished) || (received !== null && (!Number.isFinite(received) || received > finished))) {
    throw new AttestationContractError("receipt-invalid");
  }
}

function canonicalPath(path: string): boolean {
  return !Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !/[<>:"\\|?*\ud800-\udfff]/u.test(path)
    && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== ".."
      && !/[. ]$/.test(segment) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}

export function assertAttestationRequest(value: unknown): asserts value is BinaryAttestationRequest {
  assertJson(value, validateRequest, "request-invalid");
  const request = value as BinaryAttestationRequest;
  const created = attestationTime(request.createdAt), expires = attestationTime(request.expiresAt);
  const duration = expires - created;
  const extension = extname(request.sourcePath).toLowerCase();
  if (!canonicalPath(request.sourcePath) || !canonicalPath(request.outputPath)
    || !Number.isSafeInteger(duration) || duration < 1_000 || duration > 300_000
    || mediaTypes[extension] !== request.mediaType
    || request.outputPath !== `artifacts/attested/${request.requestId}${extension}` || request.sourcePath === request.outputPath) {
    throw new AttestationContractError("request-invalid");
  }
}

type RequestInput = Pick<BinaryAttestationRequest, "runId" | "sessionId" | "targetManifestSha256" | "sourcePath" | "sourceSha256" | "sourceSize" | "mediaType" | "policyDigest">;
export function createAttestationRequest(input: RequestInput, options: { now?: number; timeoutMs?: number; requestId?: string; nonce?: string } = {}): BinaryAttestationRequest {
  const time = options.now ?? Date.now(), timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(time) || !Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 300_000) throw new AttestationContractError("request-invalid");
  try {
    const requestId = options.requestId ?? randomUUID();
    const request = { ...input, schemaVersion: ATTESTATION_REQUEST_VERSION, requestId, nonce: options.nonce ?? randomUUID(),
      outputPath: `artifacts/attested/${requestId}${extname(input.sourcePath).toLowerCase()}`,
      createdAt: new Date(time).toISOString(), expiresAt: new Date(time + timeout).toISOString() };
    assertAttestationRequest(request);
    return structuredClone(request);
  } catch { throw new AttestationContractError("request-invalid"); }
}

export function attestationRequestDigest(request: BinaryAttestationRequest): string {
  assertAttestationRequest(request);
  return "sha256:" + sha256(canonicalJson(request));
}

export function assertAttestationResponse(value: unknown): asserts value is BinaryAttestationResponse {
  assertJson(value, validateResponse, "response-invalid");
  const response = value as BinaryAttestationResponse;
  try { assertAttestationRequest(response.request); }
  catch { throw new AttestationContractError("response-invalid"); }
  if (!canonicalPath(response.sourcePath) || (response.outputPath !== undefined && !canonicalPath(response.outputPath))
    || !Number.isFinite(attestationTime(response.completedAt))
    || Buffer.from(response.signature.valueBase64, "base64").toString("base64") !== response.signature.valueBase64) {
    throw new AttestationContractError("response-invalid");
  }
}
