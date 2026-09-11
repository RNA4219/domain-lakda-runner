import { generateKeyPairSync, sign } from "node:crypto";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import {
  createAttestationRequest, assertAttestationRequest, attestationRequestDigest, assertAttestationReceipt,
  type BinaryAttestationRequest, type BinaryAttestationResponse,
} from "../src/exploration/attestation-contracts.js";
import { verifyAttestationResponse } from "../src/exploration/attestation-response.js";

const now = Date.parse("2026-09-10T00:00:00.000Z");
const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const context = { now: now + 1_000, allowedKeyIds: ["fixture-attestor"], trustKeys: [{ keyId: "fixture-attestor", publicKeyPem }] };

function request(): BinaryAttestationRequest {
  return createAttestationRequest({ runId: "fixture-run", sessionId: "fixture-session",
    targetManifestSha256: "sha256:" + "a".repeat(64), sourcePath: "artifacts/failure.png",
    sourceSha256: "sha256:" + "b".repeat(64), sourceSize: 64, mediaType: "image/png",
    policyDigest: "sha256:" + "c".repeat(64) }, { now, timeoutMs: 30_000,
    requestId: "10000000-0000-4000-8000-000000000001", nonce: "20000000-0000-4000-8000-000000000002" });
}

function signed(value: Omit<BinaryAttestationResponse, "signature">): BinaryAttestationResponse {
  const payload = canonicalJson(value);
  return { ...value, signature: { algorithm: "ed25519", keyId: "fixture-attestor",
    signedPayloadDigest: "sha256:" + sha256(payload), valueBase64: sign(null, Buffer.from(payload), keys.privateKey).toString("base64") } };
}

function response(input = request(), decision: BinaryAttestationResponse["decision"] = "sanitized"): BinaryAttestationResponse {
  return signed({ schemaVersion: "lakda/binary-artifact-attestation/v2", request: input,
    requestSha256: attestationRequestDigest(input), sourcePath: input.sourcePath,
    sourceSize: input.sourceSize, sourceSha256: input.sourceSha256, decision,
    ...(decision === "sanitized" ? { outputPath: input.outputPath, outputSize: 48, outputSha256: "sha256:" + "d".repeat(64) } : {}),
    secretScan: decision === "rejected" ? "fail" : "pass", piiScan: "pass", redactionRuleVersion: "fixture-mask/v1",
    tool: { name: "fixture-scanner", version: "1.0", policyDigest: input.policyDigest },
    completedAt: new Date(now + 500).toISOString() });
}

function resign(value: BinaryAttestationResponse): BinaryAttestationResponse {
  const payload = { ...value };
  delete (payload as Partial<BinaryAttestationResponse>).signature;
  return signed(payload);
}

test("MP4 request and signed response preserve format and reject MIME or extension substitutions", () => {
  const input = { ...request(), sourcePath: "artifacts/video/0001.mp4", mediaType: "video/mp4",
    outputPath: "artifacts/attested/10000000-0000-4000-8000-000000000001.mp4" };
  assertAttestationRequest(input);
  const created = createAttestationRequest(input, { now, requestId: input.requestId, nonce: input.nonce });
  expect(created).toEqual(input);
  expect(() => verifyAttestationResponse(created, response(created), context)).not.toThrow();
  for (const change of [{ mediaType: "video/webm" }, { sourcePath: "artifacts/video/0001.webm" },
    { outputPath: input.outputPath.replace(".mp4", ".webm") }]) {
    expect(() => assertAttestationRequest({ ...created, ...change })).toThrow(/request-invalid/);
  }
  const changed = structuredClone(response(created));
  changed.request.mediaType = "video/webm";
  expect(() => verifyAttestationResponse(created, changed, context)).toThrow();
});

test("receipt states distinguish message verification from media adoption and preserve failure reasons", () => {
  const input = request();
  const value = { schemaVersion: "lakda/binary-attestation-receipt/v1", requestId: input.requestId,
    requestSha256: attestationRequestDigest(input), runId: input.runId, targetManifestSha256: input.targetManifestSha256,
    status: "response-verified", reason: null, responseSha256: "sha256:" + "d".repeat(64),
    receivedAt: input.createdAt, finishedAt: new Date(now + 1_000).toISOString() };
  expect(() => assertAttestationReceipt(value)).not.toThrow();
  expect(() => assertAttestationReceipt({ ...value, status: "timeout", reason: "request-expired", responseSha256: null, receivedAt: null })).not.toThrow();
  for (const change of [{ status: "accepted" }, { status: "timeout" }, { reason: "scan-failed" },
    { responseSha256: null }, { receivedAt: null }, { mediaAdopted: true }, { finishedAt: "2026-02-30T00:00:00.000Z" },
    { finishedAt: new Date(now - 1).toISOString() }]) {
    expect(() => assertAttestationReceipt({ ...value, ...change })).toThrow(/receipt-invalid/);
  }
});

test("attestation request fixes canonical paths, digest and a bounded deadline", () => {
  const value = request();
  expect(value.outputPath).toBe("artifacts/attested/10000000-0000-4000-8000-000000000001.png");
  expect(value.expiresAt).toBe("2026-09-10T00:00:30.000Z");
  expect(attestationRequestDigest(value)).toBe("sha256:" + sha256(canonicalJson(value)));
  expect(() => assertAttestationRequest(value)).not.toThrow();
  for (const timeoutMs of [999, 300_001, 1_000.5, NaN, Infinity]) {
    expect(() => createAttestationRequest(value, { now, timeoutMs })).toThrow(/request-invalid/);
  }
});

test("request validation rejects aliases, missing bytes, unsupported MIME and unknown fields", () => {
  for (const sourcePath of ["../frame.png", "/frame.png", "C:frame.png", "artifacts\\frame.png", "artifacts/./frame.png", "artifacts/frame.png.", "artifacts/NUL.png", "artifacts/frame.png:stream"]) {
    expect(() => assertAttestationRequest({ ...request(), sourcePath })).toThrow(/request-invalid/);
  }
  const invalid = [
    { ...request(), sourceSize: 0 }, { ...request(), sourceSize: Number.MAX_SAFE_INTEGER + 1 },
    { ...request(), sourceSize: NaN }, { ...request(), sourceSha256: "b".repeat(64) },
    { ...request(), mediaType: "video/webm" }, { ...request(), extra: true },
    { ...request(), outputPath: "artifacts/failure.png" },
    { ...request(), createdAt: "2026-02-31T00:00:00.000Z" },
    { ...request(), expiresAt: "2026-09-10T09:00:30.000+09:00" },
  ];
  for (const value of invalid) expect(() => assertAttestationRequest(value)).toThrow(/request-invalid/);
});

test("only the stored request and permitted signature can approve sanitized or original bytes", () => {
  for (const decision of ["sanitized", "no-sensitive-content"] as const) {
    const input = request();
    const value = response(input, decision);
    const verified = verifyAttestationResponse(input, value, context);
    expect(verified.decision).toBe(decision);
    expect(verified).toEqual(value);
    expect(verified).not.toBe(value);
  }
});

test("a valid signature for another run, nonce, target or policy does not satisfy this request", () => {
  const input = request();
  const alternatives = [
    { ...input, runId: "another-run" }, { ...input, sessionId: "another-session" },
    { ...input, nonce: "30000000-0000-4000-8000-000000000003" },
    { ...input, targetManifestSha256: "sha256:" + "e".repeat(64) },
    { ...input, policyDigest: "sha256:" + "f".repeat(64) },
  ];
  for (const alternative of alternatives) {
    expect(() => verifyAttestationResponse(input, response(alternative), context)).toThrow(/request-mismatch/);
  }
  expect(() => verifyAttestationResponse(input, resign({ ...response(input), requestSha256: "sha256:" + "0".repeat(64) }), context)).toThrow(/request-mismatch/);
});

test("source and output bindings remain required even for correctly signed responses", () => {
  const input = request();
  const base = response(input);
  for (const patch of [{ sourceSize: 63 }, { sourceSha256: "sha256:" + "e".repeat(64) }, { sourcePath: "artifacts/other.png" }]) {
    expect(() => verifyAttestationResponse(input, resign({ ...base, ...patch }), context)).toThrow(/source-mismatch/);
  }
  expect(() => verifyAttestationResponse(input, resign({ ...base, outputPath: "artifacts/other.png" }), context)).toThrow(/output-mismatch/);
  expect(() => verifyAttestationResponse(input, resign({ ...base, tool: { ...base.tool, policyDigest: "sha256:" + "e".repeat(64) } }), context)).toThrow(/policy-mismatch/);
});

test("late, premature and internally inconsistent completion times are rejected", () => {
  const input = request();
  expect(() => verifyAttestationResponse(input, response(input), { ...context, now: now + 30_000 })).toThrow(/expired/);
  expect(() => verifyAttestationResponse(input, response(input), { ...context, now: now - 1 })).toThrow(/time-invalid/);
  for (const completedAt of [new Date(now - 1).toISOString(), new Date(now + 30_000).toISOString(), new Date(now + 2_000).toISOString()]) {
    expect(() => verifyAttestationResponse(input, resign({ ...response(input), completedAt }), context)).toThrow(/time-invalid/);
  }
});

test("unknown, duplicate, private or non-Ed25519 keys cannot authorize an output", () => {
  const input = request();
  expect(() => verifyAttestationResponse(input, response(input), { ...context, allowedKeyIds: [] })).toThrow(/untrusted-key/);
  expect(() => verifyAttestationResponse(input, response(input), { ...context, trustKeys: [{ keyId: "other", publicKeyPem }] })).toThrow(/untrusted-key/);
  expect(() => verifyAttestationResponse(input, response(input), { ...context, trustKeys: [...context.trustKeys, ...context.trustKeys] })).toThrow(/trust-invalid/);
  const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  expect(() => verifyAttestationResponse(input, response(input), { ...context, trustKeys: [{ keyId: "fixture-attestor", publicKeyPem: privatePem }] })).toThrow(/trust-invalid/);
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  expect(() => verifyAttestationResponse(input, response(input), { ...context, trustKeys: [{ keyId: "fixture-attestor", publicKeyPem: ec.publicKey.export({ type: "spki", format: "pem" }).toString() }] })).toThrow(/trust-invalid/);
});

test("malformed, altered, rejected and oversized responses never become accepted media", () => {
  const input = request();
  const base = response(input);
  expect(() => verifyAttestationResponse(input, { ...base, outputSize: 49 }, context)).toThrow(/signature-invalid/);
  expect(() => verifyAttestationResponse(input, { ...base, signature: { ...base.signature, valueBase64: "not-base64" } }, context)).toThrow(/response-invalid/);
  expect(() => verifyAttestationResponse(input, { ...base, extra: true }, context)).toThrow(/response-invalid/);
  expect(() => verifyAttestationResponse(input, { ...base, tool: { ...base.tool, extra: true } }, context)).toThrow(/response-invalid/);
  expect(() => verifyAttestationResponse(input, response(input, "rejected"), context)).toThrow(/scan-failed/);
  expect(() => verifyAttestationResponse(input, resign({ ...base, piiScan: "fail" }), context)).toThrow(/scan-failed/);
  expect(() => verifyAttestationResponse(input, { ...base, redactionRuleVersion: "x".repeat(65_536) }, context)).toThrow(/response-invalid/);
  expect(() => verifyAttestationResponse(input, { ...base, schemaVersion: "lakda/binary-artifact-attestation/v1" }, context)).toThrow(/response-invalid/);
});
