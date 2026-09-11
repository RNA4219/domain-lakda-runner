import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { assertAdaptiveContract, type ActionCandidate, type ExecutionResult } from "../adaptive/contracts.js";
import type { AdapterFailure, ExecuteContext, RecoverContext, RecoveryResult } from "../adapters/types.js";
import { assertLoopbackEndpoint } from "../core/safety.js";
import { assertNativeIdentityObservation, nativeIdentityDigest, nativeIdentityTime, NativeIdentityError, type NativeIdentityObservation } from "./native-identity-contracts.js";
import { postNativeIdentityJson, waitForNativeTimestamp } from "./native-identity-exchange.js";

export type NativeActionLease = { observationId: string; observationDigest: string; connectionId: string; challenge: string };
export type NativeApprovalWindow = { targetManifestSha256: string; validFrom: string; validUntil: string };
type CommonRequest = { lease: NativeActionLease; ordinal: number } & (
  { schemaVersion: "lakda/native-action-request/v1"; approvalWindow?: never } | { schemaVersion: "lakda/native-action-request/v2"; approvalWindow: NativeApprovalWindow });
export type NativeActionRequest = CommonRequest & ({ operation: "execute"; payload: { candidate: ActionCandidate; context: ExecuteContext } }
  | { operation: "recover"; payload: { failure: AdapterFailure; context: RecoverContext } });
type CommonResult = { lease: NativeActionLease; ordinal: number; checkedAt: string; actionAttempted: boolean } & (
  { schemaVersion: "lakda/native-action-result/v1"; approvalWindow?: never } | { schemaVersion: "lakda/native-action-result/v2"; approvalWindow: NativeApprovalWindow });
export type NativeActionResult = CommonResult & ({ operation: "execute"; result: ExecutionResult } | { operation: "recover"; result: RecoveryResult });
export type NativeActionReceiptExpectation = CommonRequest & ({ operation: "execute"; candidate: { candidateId: string; sourceFingerprint: string } } | { operation: "recover" });

/** Persist only acknowledgement bindings; locator, input and failure bodies are omitted. */
export function nativeActionReceiptExpectation(request: NativeActionRequest): NativeActionReceiptExpectation {
  const common: CommonRequest = request.schemaVersion === "lakda/native-action-request/v2"
    ? { schemaVersion: request.schemaVersion, lease: structuredClone(request.lease), ordinal: request.ordinal, approvalWindow: structuredClone(request.approvalWindow) }
    : { schemaVersion: request.schemaVersion, lease: structuredClone(request.lease), ordinal: request.ordinal };
  return request.operation === "recover" ? { ...common, operation: "recover" }
    : { ...common, operation: "execute", candidate: { candidateId: request.payload.candidate.candidateId, sourceFingerprint: request.payload.candidate.sourceFingerprint } };
}
type Validator = (value: unknown) => boolean;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => { compile(schema: object): Validator };
const validators = [1, 2].map(version => new Ajv({ strict: false, strictNumbers: true }).compile(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "..", "..", "schemas", `lakda-native-action-v${version}.schema.json`), "utf8")) as object));
const validate = (value: unknown): boolean => validators.some(validator => validator(value));
const MAX_BYTES = 65536;

/** Reference an already-verified observation. This does not approve a target or action. */
export function nativeActionLease(observation: NativeIdentityObservation): NativeActionLease {
  assertNativeIdentityObservation(observation);
  if (["appId", "appBuild", "deviceDigest"].some(field => observation.fields[field as keyof typeof observation.fields].status !== "observed")) {
    throw new NativeIdentityError("identity-unobserved");
  }
  return { observationId: observation.observationId, observationDigest: nativeIdentityDigest(observation),
    connectionId: observation.bridgeBinding.connectionId, challenge: observation.challenge };
}

export function assertNativeActionRequest(request: NativeActionRequest): void {
  if (!validate(request) || !["lakda/native-action-request/v1", "lakda/native-action-request/v2"].includes(request.schemaVersion) || Buffer.byteLength(JSON.stringify(request)) > MAX_BYTES) {
    throw new NativeIdentityError("action-request-invalid");
  }
  if (request.schemaVersion === "lakda/native-action-request/v2") {
    const from = nativeIdentityTime(request.approvalWindow.validFrom), until = nativeIdentityTime(request.approvalWindow.validUntil), now = Date.now();
    if (!Number.isFinite(from) || !Number.isFinite(until) || !(from <= now && now < until)) throw new NativeIdentityError("action-request-invalid");
  }
  if (request.operation === "execute") {
    assertAdaptiveContract(request.payload.candidate);
    if (request.payload.candidate.adapterId !== "airtest-poco") throw new NativeIdentityError("action-adapter-invalid");
  }
}

export function validateNativeActionReceipt(request: NativeActionRequest, value: unknown, started: number, now = Date.now()): NativeActionResult {
  return validateNativeActionReceiptExpectation(nativeActionReceiptExpectation(request), value, started, now);
}

export function validateNativeActionReceiptExpectation(request: NativeActionReceiptExpectation, value: unknown, started: number, now = Date.now()): NativeActionResult {
  let size: number;
  try { size = Buffer.byteLength(JSON.stringify(value)); } catch { throw new NativeIdentityError("action-response-invalid"); }
  if (size > MAX_BYTES || !Number.isSafeInteger(started) || !Number.isSafeInteger(now) || started > now) throw new NativeIdentityError("action-response-invalid");
  if (!validate(value) || !["lakda/native-action-result/v1", "lakda/native-action-result/v2"].includes((value as NativeActionResult).schemaVersion)) throw new NativeIdentityError("action-response-invalid");
  const response = value as NativeActionResult, checked = nativeIdentityTime(response.checkedAt);
  if (response.schemaVersion !== request.schemaVersion.replace("request", "result") || response.operation !== request.operation || response.ordinal !== request.ordinal
    || nativeIdentityDigest(response.lease) !== nativeIdentityDigest(request.lease) || !Number.isFinite(checked) || checked < started || checked > now) throw new NativeIdentityError("action-response-mismatch");
  if (request.schemaVersion === "lakda/native-action-request/v2" && (response.schemaVersion !== "lakda/native-action-result/v2"
    || nativeIdentityDigest(response.approvalWindow) !== nativeIdentityDigest(request.approvalWindow)
    || checked < nativeIdentityTime(request.approvalWindow.validFrom) || checked >= nativeIdentityTime(request.approvalWindow.validUntil))) throw new NativeIdentityError("action-response-mismatch");
  if (response.operation === "execute" && request.operation === "execute") {
    assertAdaptiveContract(response.result);
    if (response.result.candidateId !== request.candidate.candidateId || response.result.preFingerprint !== request.candidate.sourceFingerprint
      || (response.result.status === "executed" && !response.actionAttempted)) throw new NativeIdentityError("action-result-mismatch");
  } else if (response.operation === "recover") {
    response.result.evidenceRefs.forEach(assertAdaptiveContract);
    if (response.result.recovered && !response.actionAttempted) throw new NativeIdentityError("action-result-mismatch");
  }
  return response;
}

/** Only transport/receipt validation; the caller must bind operator approval, identity freshness and session evidence. */
export async function requestNativeAction(endpoint: URL, input: NativeActionRequest): Promise<NativeActionResult> {
  try {
    const request = structuredClone(input);
    assertNativeActionRequest(request);
    const base = assertLoopbackEndpoint(endpoint.href);
    if (!base.href.endsWith("/")) throw new NativeIdentityError("action-endpoint-invalid");
    const started = Date.now(), mono = performance.now(), signal = AbortSignal.timeout(15000);
    const value = await postNativeIdentityJson(base, "native-action", request, signal, MAX_BYTES);
    await waitForNativeTimestamp(nativeIdentityTime((value as NativeActionResult | null)?.checkedAt as string), signal);
    if (signal.aborted || performance.now() - mono >= 15000) throw new NativeIdentityError("action-response-mismatch");
    return validateNativeActionReceipt(request, value, started);
  } catch (error) {
    if (error instanceof NativeIdentityError) throw error;
    throw new NativeIdentityError("action-unavailable");
  }
}
