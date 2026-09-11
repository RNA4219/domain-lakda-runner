import { nativeActionLease } from "./native-identity-actions.js";
import { validateNativeCaptureReceipt } from "./native-identity-capture.js";
import { assertNativeCaptureExpectation, assertNativeCapturePolicy, nativeCaptureScope, type NativeCaptureEvidence } from "./native-identity-capture-evidence.js";
import type { ExplorationCharter } from "./contracts.js";
import { NativeIdentityError, nativeIdentityDigest, nativeIdentityTime } from "./native-identity-contracts.js";
import type { NativeEvidenceTarget } from "./native-identity-evidence.js";
import type { NativeExecutionEvidence } from "./native-identity-executor.js";

const refused = () => new NativeIdentityError("native-capture-evidence-invalid");

/** A stopped, failed capture is distinguishable from an unconfirmed one. Neither approves media contents. */
export class NativeCaptureEvidenceVerifier {
  private observation?: Extract<NativeExecutionEvidence, { kind: "observation" }>;
  private request?: Extract<NativeCaptureEvidence, { kind: "capture-requested" }>;
  private active?: { ordinal: number; scope: string };
  private ordinal = 0;
  private uncertainScreenshot = false;
  blocked = false;
  constructor(private readonly target: NativeEvidenceTarget, private readonly at: (time: number) => void, private readonly policy?: ExplorationCharter["capture"]) {}
  get pending(): boolean { return !!this.request; }
  get complete(): boolean { return !this.request && !this.active && !this.uncertainScreenshot; }
  observe(value: Extract<NativeExecutionEvidence, { kind: "observation" }>): void { this.observation = structuredClone(value); }

  accept(value: NativeCaptureEvidence): void {
    if (!this.observation) throw refused();
    if (value.kind === "capture-requested") {
      const expected = value.expectation, signature = this.target.manifest.signature;
      assertNativeCaptureExpectation(expected);
      if (!this.policy) throw refused();
      assertNativeCapturePolicy(expected, this.policy);
      const cleanup = expected.operation === "stop" || expected.operation === "discard";
      if (this.request || (!cleanup && this.blocked) || expected.ordinal !== this.ordinal + 1
        || nativeIdentityDigest(expected.lease) !== nativeIdentityDigest(nativeActionLease(this.observation.acquisition.observation))
        || nativeIdentityDigest(expected.approvalWindow) !== nativeIdentityDigest({ targetManifestSha256: this.target.sha256,
          validFrom: signature.validFrom, validUntil: signature.validUntil })) throw refused();
      if (cleanup) {
        if (!this.active || expected.captureOrdinal !== this.active.ordinal || nativeCaptureScope(expected) !== this.active.scope) throw refused();
      } else {
        this.at(value.requestedAt);
        if (expected.operation === "start" && this.active) throw refused();
      }
      this.request = structuredClone(value); this.ordinal = expected.ordinal;
      return;
    }
    const pending = this.request;
    if (!pending || value.requestSha256 !== pending.requestSha256 || value.ordinal !== pending.expectation.ordinal
      || value.finishedAt < pending.requestedAt || (value.startedAt !== null && (value.startedAt < pending.requestedAt || value.startedAt > value.finishedAt))) throw refused();
    const expected = pending.expectation, cleanup = expected.operation === "stop" || expected.operation === "discard";
    if (value.startedAt !== null && !cleanup) this.at(value.startedAt);
    if (value.receipt) {
      if (value.startedAt === null) throw refused();
      validateNativeCaptureReceipt(value.receipt, { operation: expected.operation, ordinal: expected.ordinal,
        captureOrdinal: expected.captureOrdinal, requestSha256: pending.requestSha256, mode: expected.payload.mode ?? "screenshot" });
      const completed = nativeIdentityTime(value.receipt.completedAt);
      if (completed < value.startedAt || completed > value.finishedAt) throw refused();
      if (!cleanup && value.executionStatus === "completed" && value.receipt.result.accepted) this.at(completed);
    } else if (value.executionStatus !== "failed") throw refused();
    if (value.executionStatus === "completed" && !cleanup && value.receipt?.result.accepted) this.at(value.finishedAt);
    if (expected.operation === "start" && value.startedAt !== null && value.receipt?.result.stopped !== true) {
      this.active = { ordinal: expected.ordinal, scope: nativeCaptureScope(expected) };
    }
    if (expected.operation === "screenshot" && value.startedAt !== null && !value.receipt) this.uncertainScreenshot = true;
    if (cleanup && value.receipt?.result.stopped === true) this.active = undefined;
    if (value.executionStatus === "failed" || !value.receipt?.result.accepted) this.blocked = true;
    this.request = undefined;
  }
}
