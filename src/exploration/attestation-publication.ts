import { lstat } from "node:fs/promises";
import { canonicalJson } from "../core/plan.js";
import { findSensitive, redact, sha256 } from "../core/redaction.js";
import { assertAttestationReceipt, assertAttestationRequest, attestationRequestDigest, AttestationContractError, type BinaryAttestationRequest } from "./attestation-contracts.js";
import { attestationReceiptPath, verifyAttestationEvidence, type AttestationBinding } from "./attestation-evidence.js";
import type { AttestationRetention } from "./attestation-exchange.js";
import type { AttestationDirectory } from "./attestation-io.js";
import type { AttestationResponseContext } from "./attestation-response.js";
import { inventoryAttestationSources } from "./attestation-inventory.js";
import { assertAttestationResult, attestationResultPath, type BinaryAttestationResult } from "./attestation-results.js";
import { checkAttestationMedia, type AttestationMediaOptions } from "./attestation-copy.js";

export type AttestationPublicationControl = Pick<AttestationMediaOptions, "signal" | "check">;

type Entry = { request: BinaryAttestationRequest; result: AttestationRetention };
type File = { path: string; size: number; sha256: string };
function publicBytes(value: unknown): Buffer {
  const text = canonicalJson(value) + "\n";
  if (findSensitive(text).length || redact(text) !== text) throw new AttestationContractError("evidence-not-publishable");
  return Buffer.from(text, "utf8");
}
function digest(bytes: Buffer) { return { size: bytes.length, sha256: "sha256:" + sha256(bytes) }; }
async function unchanged(io: AttestationDirectory, path: string, bytes: Buffer): Promise<void> {
  if (!await io.read(path, digest(bytes))) throw new AttestationContractError("evidence-changed");
}

/** Publish only verified protocol records after every input and destination has passed preflight. */
export async function publishAttestationEvidence(io: AttestationDirectory, entries: readonly Entry[], binding: AttestationBinding,
  context: Omit<AttestationResponseContext, "now">, maxBytes: number, control: AttestationPublicationControl = {}): Promise<File[]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new AttestationContractError("evidence-byte-limit");
  const check = () => checkAttestationMedia({ maxBytes, ...control });
  await check(); await io.assertOpen();
  const files: Array<{ path: string; bytes: Buffer }> = [], responses: Buffer[] = [], ids = new Set<string>(), sources = new Set<string>();
  const retained = await inventoryAttestationSources(io.runDirectory, maxBytes, check);
  const paths = new Set(retained.map(media => media.path)), hashes = new Map<string, Set<string>>();
  for (const media of retained) {
    const key = `${media.size}:${media.sha256}`, aliases = hashes.get(key) ?? new Set<string>();
    aliases.add(media.path); hashes.set(key, aliases);
  }
  let size = 0;
  for (const { request, result } of entries) {
    await check();
    assertAttestationRequest(request); assertAttestationReceipt(result.receipt);
    for (const field of ["runId", "sessionId", "targetManifestSha256", "policyDigest"] as const) {
      if (request[field] !== binding[field]) throw new AttestationContractError("exchange-binding-mismatch");
    }
    if (ids.has(request.requestId) || result.receipt.requestId !== request.requestId || result.receipt.requestSha256 !== attestationRequestDigest(request)
      || result.receipt.runId !== request.runId || result.receipt.targetManifestSha256 !== request.targetManifestSha256) throw new AttestationContractError("receipt-mismatch");
    if (sources.has(request.sourcePath)) throw new AttestationContractError("result-source-duplicate");
    ids.add(request.requestId); sources.add(request.sourcePath);
    const receiptPath = attestationReceiptPath(request.requestId), receiptBytes = publicBytes(result.receipt);
    await unchanged(io, `attestations/requests/${request.requestId}.json`, Buffer.from(canonicalJson(request) + "\n"));
    await unchanged(io, receiptPath, receiptBytes);
    if (result.response) await unchanged(io, `attestations/responses/${request.requestId}.json`, Buffer.from(canonicalJson(result.response) + "\n"));
    if (result.adoption !== "adopted" || result.response.decision === "sanitized") {
      const allowed = result.adoption === "adopted" ? result.artifact.path : undefined;
      const aliases = hashes.get(`${request.sourceSize}:${request.sourceSha256}`);
      if (paths.has(request.sourcePath) || (allowed === undefined && paths.has(request.outputPath))
        || (aliases && (aliases.size > 1 || !aliases.has(allowed ?? "")))) throw new AttestationContractError("raw-media-retained");
    }
    if (result.adoption !== "adopted") await io.readMedia("source", request.sourcePath, { size: request.sourceSize, sha256: request.sourceSha256 }, maxBytes, control.signal, check);
    if (result.adoption === "adopted") {
      const snapshot = await io.readMedia("retained", result.artifact.path, result.artifact, maxBytes, control.signal, check);
      if (!verifyAttestationEvidence(result.response, snapshot, { ...context, binding, receipt: result.receipt })) throw new AttestationContractError("adoption-proof-invalid");
      const expectedPath = result.response.decision === "sanitized" ? result.response.outputPath : result.response.sourcePath;
      if (result.artifact.path !== expectedPath) throw new AttestationContractError("adoption-proof-invalid");
      responses.push(publicBytes(result.response));
      size += responses.at(-1)!.length;
    }
    files.push({ path: receiptPath, bytes: receiptBytes }); size += receiptBytes.length;
    const record: BinaryAttestationResult = { schemaVersion: "lakda/binary-attestation-result/v1", request, requestSha256: attestationRequestDigest(request),
      receiptSha256: digest(receiptBytes).sha256, adoption: result.adoption, reason: result.adoption === "failed" ? result.reason : result.receipt.reason,
      artifact: result.adoption === "adopted" ? result.artifact : null };
    assertAttestationResult(record, result.receipt, binding);
    const resultBytes = publicBytes(record);
    files.push({ path: attestationResultPath(request.requestId), bytes: resultBytes }); size += resultBytes.length;
    if (size > maxBytes) throw new AttestationContractError("evidence-byte-limit");
  }
  if (responses.length) files.push({ path: "attestations/binary-artifacts.jsonl", bytes: Buffer.concat(responses) });
  for (const file of files) {
    await check();
    const path = await io.mediaPath("retained", file.path, true);
    try { await lstat(path); throw new AttestationContractError("publication-already-exists"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const published: File[] = [];
  for (const file of files) {
    const saved = await io.writePublished(file.path, file.bytes, maxBytes, control.signal, check);
    await io.readMedia("retained", file.path, saved, maxBytes, control.signal, check);
    published.push({ path: file.path, ...saved });
  }
  await check(); return published;
}
