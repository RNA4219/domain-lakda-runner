import { assertNativeCaptureRequest, type NativeCapturePayload, type NativeCaptureRequest, type NativeCaptureResult } from "./native-identity-capture.js";
import { NativeIdentityError, nativeIdentityDigest } from "./native-identity-contracts.js";
import type { ExplorationCharter } from "./contracts.js";

export type NativeCaptureExpectation = Omit<NativeCaptureRequest, "payload"> & {
  payload: Omit<NativeCapturePayload, "stagingDir">; stagingDirSha256: string };
export type NativeCaptureEvidence =
  | { kind: "capture-requested"; requestSha256: string; requestedAt: number; expectation: NativeCaptureExpectation }
  | { kind: "capture-finished"; requestSha256: string; ordinal: number; startedAt: number | null; finishedAt: number;
      executionStatus: "completed" | "failed"; receipt: NativeCaptureResult | null };

/** Persist identity and scope bindings without publishing a private output directory. */
export function nativeCaptureReceiptExpectation(request: NativeCaptureRequest): NativeCaptureExpectation {
  assertNativeCaptureRequest(request);
  const snapshot = structuredClone(request), { stagingDir, ...payload } = snapshot.payload;
  return { ...snapshot, payload, stagingDirSha256: nativeIdentityDigest({ stagingDir }) };
}

export function assertNativeCaptureExpectation(value: NativeCaptureExpectation): void {
  try {
    const { stagingDirSha256, ...request } = value;
    if (!/^sha256:[a-f0-9]{64}$/.test(stagingDirSha256) || "stagingDir" in request.payload) throw new Error();
    assertNativeCaptureRequest({ ...request, payload: { ...request.payload, stagingDir: "withheld" } });
  } catch { throw new NativeIdentityError("native-capture-evidence-invalid"); }
}

export function nativeCaptureScope(value: NativeCaptureExpectation): string {
  return nativeIdentityDigest({ runId: value.payload.runId, mode: value.payload.mode ?? "screenshot", stagingDirSha256: value.stagingDirSha256 });
}

/** Apply the signature-bound capture settings both before dispatch and when reading the journal. */
export function assertNativeCapturePolicy(value: Pick<NativeCaptureExpectation, "operation" | "payload">, policy: ExplorationCharter["capture"]): void {
  const payload = value.payload, frames = policy.sampledFrames;
  const reject = () => { throw new NativeIdentityError("native-capture-policy-mismatch"); };
  if (value.operation === "screenshot") return;
  if ((payload.stopTimeoutMs ?? 5000) > (payload.mode === "sampled-frames/v1" ? frames.stopTimeoutMs : 5000)) reject();
  if (value.operation !== "start") return;
  if (payload.mode === "video") {
    if (policy.video !== "retain-on-finding-or-non-pass" || [payload.intervalMs, payload.maxFrames, payload.maxBytes].some(item => item !== undefined)) reject();
  } else if (!frames.enabled || frames.source !== "operator-bridge" || payload.intervalMs! < frames.intervalMs
    || payload.maxFrames! > frames.maxFrames || payload.maxBytes! > frames.maxBytes) reject();
}
