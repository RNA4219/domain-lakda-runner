import type { ExplorationCharter } from "./contracts.js";
import type { NativeActionLease, NativeApprovalWindow } from "./native-identity-actions.js";
import { assertNativeCapturePolicy, nativeCaptureReceiptExpectation, nativeCaptureScope, type NativeCaptureEvidence } from "./native-identity-capture-evidence.js";
import { assertNativeCaptureRequest, validateNativeCaptureResult, type NativeCaptureRequest, type NativeCaptureResult } from "./native-identity-capture.js";
import { NativeIdentityError, nativeIdentityDigest, nativeIdentityTime } from "./native-identity-contracts.js";

export type NativeExecutionCapture = Pick<NativeCaptureRequest, "operation" | "payload">;
export class NativeCaptureExecutionError extends NativeIdentityError {
  constructor(code: string, readonly captureStopped: boolean, readonly receipt?: NativeCaptureResult) { super(code); }
}

/** The owning executor serializes this controller with input actions. Cleanup retains its original binding. */
export function createNativeCaptureExecutor(input: {
  lease: NativeActionLease; approvalWindow: NativeApprovalWindow; policy: ExplorationCharter["capture"];
  check(): Promise<void>; send?: (request: NativeCaptureRequest) => Promise<NativeCaptureResult>;
  record?: (value: NativeCaptureEvidence) => Promise<void>;
}) {
  const lease = structuredClone(input.lease), approvalWindow = structuredClone(input.approvalWindow), policy = structuredClone(input.policy);
  const send = input.send, record = input.record, check = input.check;
  let ordinal = 0, active: NativeCaptureRequest | undefined;
  const failed = (receipt?: NativeCaptureResult) => new NativeCaptureExecutionError(
    active ? "native-bridge-capture-stop-unconfirmed" : "native-capture-execution-failed", !active, receipt);
  const validatePolicy = (request: NativeCaptureRequest, cleanup: boolean) => {
    assertNativeCapturePolicy(request, policy);
    if (request.operation === "screenshot") return;
    if (cleanup) {
      if (!active || nativeCaptureScope(nativeCaptureReceiptExpectation(request)) !== nativeCaptureScope(nativeCaptureReceiptExpectation(active))) throw failed();
      return;
    }
    if (active) throw failed();
  };
  const exchange = async (action: NativeExecutionCapture): Promise<NativeCaptureResult> => {
    const cleanup = action.operation === "stop" || action.operation === "discard";
    const request: NativeCaptureRequest = { ...structuredClone(action), schemaVersion: "lakda/native-capture-request/v1",
      lease: structuredClone(lease), approvalWindow: structuredClone(approvalWindow), ordinal: ordinal + 1,
      captureOrdinal: cleanup ? active?.captureOrdinal ?? ordinal + 1 : ordinal + 1 };
    assertNativeCaptureRequest(request); validatePolicy(request, cleanup);
    if (!send || !record) throw failed();
    if (!cleanup) await check();
    ordinal = request.ordinal;
    const requestSha256 = nativeIdentityDigest(request);
    let prepared = false, startedAt: number | null = null, receipt: NativeCaptureResult | undefined, failure = false;
    try {
      try {
        await record({ kind: "capture-requested", requestSha256, requestedAt: Date.now(), expectation: nativeCaptureReceiptExpectation(request) });
        prepared = true;
      } catch { failure = true; if (!cleanup) throw failed(); }
      if (!cleanup) await check();
      startedAt = Date.now();
      if (request.operation === "start") active = structuredClone(request);
      const value: unknown = structuredClone(await send(structuredClone(request)));
      validateNativeCaptureResult(value, request);
      const completed = nativeIdentityTime(value.completedAt);
      if (completed < startedAt || completed > Date.now()) throw failed();
      receipt = value;
      if (receipt.result.stopped === true && (cleanup || request.operation === "start")) active = undefined;
      if (!cleanup) await check();
      if (!receipt.result.accepted) failure = true;
    } catch { failure = true; }
    if (prepared) {
      try {
        await record({ kind: "capture-finished", requestSha256, ordinal: request.ordinal, startedAt, finishedAt: Date.now(),
          executionStatus: failure ? "failed" : "completed", receipt: receipt ? structuredClone(receipt) : null });
      } catch { failure = true; }
    }
    if (failure || !receipt) throw failed(receipt);
    return structuredClone(receipt);
  };
  return {
    async perform(action: NativeExecutionCapture): Promise<NativeCaptureResult> {
      let snapshot: NativeExecutionCapture;
      try { snapshot = structuredClone(action); } catch { throw failed(); }
      try { return await exchange(snapshot); }
      catch (error) {
        if (active && (snapshot.operation === "start" || snapshot.operation === "screenshot")) {
          try { await exchange({ operation: "stop", payload: structuredClone(active.payload) }); } catch { /* Preserve an unconfirmed stop or failed journal. */ }
        }
        throw failed(error instanceof NativeCaptureExecutionError ? error.receipt : undefined);
      }
    },
  };
}
