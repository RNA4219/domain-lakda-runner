import { lstat } from "node:fs/promises";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { assertAttestationReceipt, assertAttestationRequest, attestationRequestDigest, attestationTime,
  AttestationContractError, type BinaryAttestationRequest } from "./attestation-contracts.js";
import { assertAttestationMediaLimit, checkAttestationMedia, copyAttestationMedia, type AttestationMediaOptions, type AttestationMediaDigest } from "./attestation-copy.js";
import type { AttestationDirectory } from "./attestation-io.js";
import { verifyAttestationResponse, type AttestationResponseContext } from "./attestation-response.js";

function boundedOptions(request: BinaryAttestationRequest, options: AttestationMediaOptions): AttestationMediaOptions {
  return { ...options, check: async () => {
    await options.check?.();
    const now = (options.clock ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < attestationTime(request.createdAt)) throw new AttestationContractError("time-invalid");
    if (now >= attestationTime(request.expiresAt)) throw new AttestationContractError("request-expired");
  } };
}

function fileDigest(value: unknown): AttestationMediaDigest {
  const bytes = Buffer.from(canonicalJson(value) + "\n", "utf8");
  return { size: bytes.length, sha256: "sha256:" + sha256(bytes) };
}

async function stored(io: AttestationDirectory, ref: string, value: unknown, code: string): Promise<void> {
  try { if (!await io.read(ref, fileDigest(value))) throw new Error(); }
  catch { throw new AttestationContractError(code); }
}

/** Keep the stopped capture itself privately after an independent inspection copy exists. */
export async function quarantineAttestationSource(io: AttestationDirectory, request: BinaryAttestationRequest, options: AttestationMediaOptions): Promise<AttestationMediaDigest> {
  assertAttestationRequest(request);
  const expected = { size: request.sourceSize, sha256: request.sourceSha256 }, bounded = boundedOptions(request, options);
  assertAttestationMediaLimit(expected, bounded); await checkAttestationMedia(bounded);
  await io.mediaPath("output", request.outputPath, true);
  const copied = await copyAttestationMedia(io, { area: "retained", ref: request.sourcePath }, { area: "source", ref: request.sourcePath }, expected, bounded);
  const before = await lstat(await io.mediaPath("retained", request.sourcePath), { bigint: true });
  const original = await io.readMedia("retained", request.sourcePath, expected, options.maxBytes, options.signal, () => checkAttestationMedia(bounded));
  await checkAttestationMedia(bounded);
  if (await io.mediaPath("retained", request.sourcePath) !== original.path) throw new AttestationContractError("media-path-invalid");
  const after = await lstat(original.path, { bigint: true });
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new AttestationContractError("media-bytes-changed");
  const preserved = await io.preserveOriginal(request.sourcePath, request.requestId, () => checkAttestationMedia(bounded));
  await io.readMedia("original", preserved, expected, options.maxBytes, options.signal, () => checkAttestationMedia(bounded));
  return copied;
}

/** Revalidate private protocol records and bytes before committing a single new retained artifact. */
export async function adoptAttestationMedia(io: AttestationDirectory, request: BinaryAttestationRequest, response: unknown, receipt: unknown,
  context: Omit<AttestationResponseContext, "now">, options: AttestationMediaOptions): Promise<AttestationMediaDigest & { path: string }> {
  assertAttestationRequest(request); assertAttestationReceipt(receipt);
  const bounded = boundedOptions(request, options);
  await io.assertOpen(); await checkAttestationMedia(bounded);
  const requestSha256 = attestationRequestDigest(request);
  if (receipt.status !== "response-verified" || receipt.requestId !== request.requestId || receipt.requestSha256 !== requestSha256
    || receipt.runId !== request.runId || receipt.targetManifestSha256 !== request.targetManifestSha256
    || receipt.receivedAt === null || attestationTime(receipt.finishedAt) >= attestationTime(request.expiresAt)) throw new AttestationContractError("receipt-mismatch");
  const verified = verifyAttestationResponse(request, response, { ...context, now: attestationTime(receipt.receivedAt) });
  if (receipt.responseSha256 !== fileDigest(verified).sha256) throw new AttestationContractError("receipt-mismatch");
  await stored(io, `attestations/requests/${request.requestId}.json`, request, "request-changed");
  await stored(io, `attestations/responses/${request.requestId}.json`, verified, "response-changed");
  await stored(io, `attestations/receipts/${request.requestId}.json`, receipt, "receipt-changed");
  try { await io.write(`attestations/claims/${request.requestId}.adopt.json`, { requestSha256, responseSha256: receipt.responseSha256 }); }
  catch (error) {
    if (error instanceof AttestationContractError && error.code === "message-already-exists") throw new AttestationContractError("adoption-already-claimed");
    throw error;
  }
  const source = { size: request.sourceSize, sha256: request.sourceSha256 };
  assertAttestationMediaLimit(source, bounded);
  await io.readMedia("source", request.sourcePath, source, options.maxBytes, options.signal, () => checkAttestationMedia(bounded));
  const sanitized = verified.decision === "sanitized";
  if (sanitized) {
    const original = await io.mediaPath("retained", request.sourcePath);
    try { await lstat(original); throw new AttestationContractError("raw-source-retained"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const path = sanitized ? request.outputPath : request.sourcePath;
  const expected = sanitized ? { size: verified.outputSize!, sha256: verified.outputSha256! } : source;
  const copied = await copyAttestationMedia(io, { area: sanitized ? "output" : "source", ref: path }, { area: "retained", ref: path }, expected, bounded);
  return { path, ...copied };
}
