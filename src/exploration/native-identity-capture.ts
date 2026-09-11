import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { assertAdaptiveContract, type EvidenceArtifactRef } from "../adaptive/contracts.js";
import type { NativeActionLease, NativeApprovalWindow } from "./native-identity-actions.js";
import { NativeIdentityError, nativeIdentityDigest, nativeIdentityTime } from "./native-identity-contracts.js";
import { postNativeIdentityJson } from "./native-identity-exchange.js";

export type NativeCapturePayload = { runId: string; stagingDir: string; mode?: "video" | "sampled-frames/v1";
  intervalMs?: number; maxFrames?: number; maxBytes?: number; stopTimeoutMs?: number };
export type NativeCaptureRequest = { schemaVersion: "lakda/native-capture-request/v1"; operation: "screenshot" | "start" | "stop" | "discard";
  lease: NativeActionLease; approvalWindow: NativeApprovalWindow; ordinal: number; captureOrdinal: number; payload: NativeCapturePayload };
export type NativeCaptureResult = { schemaVersion: "lakda/native-capture-result/v1"; operation: NativeCaptureRequest["operation"];
  ordinal: number; captureOrdinal: number; requestSha256: string; completedAt: string;
  result: { accepted: boolean; mode: "screenshot" | "video" | "sampled-frames/v1"; artifactRefs: EvidenceArtifactRef[];
    reason?: string; stopped?: boolean; frameCount?: number; byteCount?: number } };
type Validator = (value: unknown) => boolean;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => { compile(schema: object): Validator };
const validate = new Ajv({ strict: false, strictNumbers: true }).compile(JSON.parse(readFileSync(resolve(
  import.meta.dirname, "..", "..", "schemas", "lakda-native-capture-v1.schema.json"), "utf8")) as object);
const MAX_RESPONSE = 4 * 1024 * 1024;

/** Shape validation also permits expired windows; only the original capture may be cleaned up then. */
export function assertNativeCaptureRequest(value: NativeCaptureRequest): void {
  try {
    if (!validate(value) || value.schemaVersion !== "lakda/native-capture-request/v1" || Buffer.byteLength(JSON.stringify(value)) > 65536) throw new Error();
    const from = nativeIdentityTime(value.approvalWindow.validFrom), until = nativeIdentityTime(value.approvalWindow.validUntil);
    if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until || value.captureOrdinal > value.ordinal) throw new Error();
    if (["screenshot", "start"].includes(value.operation) && value.captureOrdinal !== value.ordinal) throw new Error();
    if (value.operation === "screenshot") {
      if (Object.keys(value.payload).some(key => !["runId", "stagingDir"].includes(key))) throw new Error();
    } else {
      if (!value.payload.mode) throw new Error();
      const required = value.operation === "start" ? ["intervalMs", "maxFrames", "maxBytes", "stopTimeoutMs"] : ["stopTimeoutMs"];
      if (value.payload.mode === "sampled-frames/v1" && required.some(key => !(key in value.payload))) throw new Error();
    }
  } catch { throw new NativeIdentityError("capture-request-invalid"); }
}

export function validateNativeCaptureResult(value: unknown, request: NativeCaptureRequest): asserts value is NativeCaptureResult {
  assertNativeCaptureRequest(request);
  validateNativeCaptureReceipt(value, { operation: request.operation, ordinal: request.ordinal, captureOrdinal: request.captureOrdinal,
    requestSha256: nativeIdentityDigest(request), mode: request.payload.mode ?? "screenshot" });
}

export type NativeCaptureReceiptBinding = Pick<NativeCaptureResult, "operation" | "ordinal" | "captureOrdinal" | "requestSha256"> & { mode: NativeCaptureResult["result"]["mode"] };
/** Read a saved response using its persisted digest without reconstructing a private staging path. */
export function validateNativeCaptureReceipt(value: unknown, expected: NativeCaptureReceiptBinding): asserts value is NativeCaptureResult {
  try {
    if (!validate(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_RESPONSE) throw new Error();
    const receipt = value as NativeCaptureResult, result = receipt.result;
    if (receipt.schemaVersion !== "lakda/native-capture-result/v1" || receipt.operation !== expected.operation || receipt.ordinal !== expected.ordinal
      || receipt.captureOrdinal !== expected.captureOrdinal || receipt.requestSha256 !== expected.requestSha256
      || !Number.isFinite(nativeIdentityTime(receipt.completedAt)) || result.mode !== expected.mode) throw new Error();
    result.artifactRefs.forEach(ref => assertAdaptiveContract(ref));
    if (!result.accepted && result.artifactRefs.length) throw new Error();
    if (result.accepted) {
      if (expected.operation === "start" && result.stopped === true) throw new Error();
      if (["stop", "discard"].includes(expected.operation) && result.stopped !== true) throw new Error();
      if (["start", "discard"].includes(expected.operation) && result.artifactRefs.length) throw new Error();
      if (["screenshot", "stop"].includes(expected.operation) && !result.artifactRefs.length) throw new Error();
      if (["stop", "discard"].includes(expected.operation) && result.mode === "sampled-frames/v1"
        && (!Number.isSafeInteger(result.frameCount) || !Number.isSafeInteger(result.byteCount)
          || (expected.operation === "stop" && (result.frameCount! <= 0 || result.byteCount! <= 0)))) throw new Error();
    }
  } catch { throw new NativeIdentityError("capture-response-invalid"); }
}

/** Low-level operator transport; callers verify the signed target and persist capture evidence. No automatic retries. */
export async function requestNativeCapture(base: URL, request: NativeCaptureRequest): Promise<NativeCaptureResult> {
  let value: NativeCaptureRequest;
  try { value = structuredClone(request); } catch { throw new NativeIdentityError("capture-request-invalid"); }
  assertNativeCaptureRequest(value);
  const cleanup = value.operation === "stop" || value.operation === "discard";
  const signal = AbortSignal.timeout(cleanup ? (value.payload.stopTimeoutMs ?? 5000) + 5000 : 15000);
  const result = await postNativeIdentityJson(base, "native-capture", value, signal, MAX_RESPONSE);
  validateNativeCaptureResult(result, value);
  return result;
}
