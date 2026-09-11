import type { ExternalToolBridge } from "../adapters/external-bridges.js";
import type { ExplorationCharter } from "./contracts.js";
import type { NativeCaptureEvidence } from "./native-identity-capture-evidence.js";
import { createNativeCaptureExecutor, type NativeExecutionCapture } from "./native-identity-capture-executor.js";
import { NativeIdentityError, nativeIdentityTime, nativeIdentityDigest } from "./native-identity-contracts.js";
import { assertNativeActionRequest, nativeActionLease, nativeActionReceiptExpectation, validateNativeActionReceipt, type NativeActionReceiptExpectation, type NativeActionRequest, type NativeActionResult } from "./native-identity-actions.js";
import type { NativeIdentityAcquisition } from "./native-identity-exchange.js";
import { assertNativeExplorationTargetManifest, verifyNativeIdentityForTarget } from "./native-identity-target.js";
import { verifySignedExplorationTargetManifestSnapshot } from "./target-manifest.js";

export type NativeExecutionAction = { operation: "execute"; payload: Extract<NativeActionRequest, { operation: "execute" }>["payload"] }
  | { operation: "recover"; payload: Extract<NativeActionRequest, { operation: "recover" }>["payload"] };
export class NativeExecutionError extends NativeIdentityError {
  constructor(code: string, readonly actionAttempted: boolean | "unknown", readonly receipt?: NativeActionResult) { super(code); }
}
export type NativeExecutionEvidence =
  | NativeCaptureEvidence
  | { kind: "observation"; targetManifestSha256: string; acquisition: NativeIdentityAcquisition }
  | { kind: "action-requested"; requestSha256: string; requestedAt: number; expectation: NativeActionReceiptExpectation }
  | { kind: "action-finished"; requestSha256: string; ordinal: number; startedAt: number | null; finishedAt: number;
      executionStatus: "completed" | "failed"; actionAttempted: boolean | "unknown"; receipt: NativeActionResult | null };
export type NativeExecutionEvidenceSink = { record(value: NativeExecutionEvidence): Promise<void> };

/** Internal building block: does not replace candidate safety gates, CLI preflight or persisted evidence verification. */
export async function createNativeIdentityExecutor(input: {
  targetBytes: Uint8Array; charter: ExplorationCharter; configDigest: string;
  trustKeys: readonly { keyId: string; publicKeyPem: string }[];
  bridge: Pick<ExternalToolBridge, "observeNativeIdentity" | "nativeAction" | "nativeCapture" | "binding">;
  evidence?: NativeExecutionEvidenceSink;
}) {
  try {
    const createdMono = performance.now(), createdWall = Date.now();
    if (!(input.targetBytes instanceof Uint8Array) || input.targetBytes.length > 262144) throw new Error();
    const bytes = Buffer.from(input.targetBytes), charter = structuredClone(input.charter), keys = structuredClone(input.trustKeys), config = input.configDigest;
    const observe = input.bridge.observeNativeIdentity?.bind(input.bridge), send = input.bridge.nativeAction?.bind(input.bridge);
    const capture = input.bridge.nativeCapture?.bind(input.bridge), binding = input.bridge.binding?.bind(input.bridge);
    const record = input.evidence?.record.bind(input.evidence);
    if (!observe || !send) throw new Error();
    const verify = () => verifySignedExplorationTargetManifestSnapshot(bytes, charter, config, { trustKeys: keys, nativeIdentityPolicy: "validate-only" });
    const loaded = await verify(), manifest = loaded.manifest;
    assertNativeExplorationTargetManifest(manifest);
    const from = nativeIdentityTime(manifest.signature.validFrom), until = nativeIdentityTime(manifest.signature.validUntil);
    const approvalDeadline = createdMono + (until - createdWall);
    let wallFloor = createdWall;
    const checkApproval = () => {
      const wall = Date.now(), mono = performance.now();
      if (!Number.isSafeInteger(wall) || !Number.isFinite(mono) || wall < wallFloor || wall < from || wall >= until
        || mono < createdMono || mono >= approvalDeadline) throw new NativeIdentityError("target-approval-expired");
      wallFloor = wall;
      return { wall, mono };
    };
    checkApproval();
    const observedMono = performance.now();
    const acquisition = structuredClone(await observe(manifest.nativeIdentity.maxAgeMs));
    verifyNativeIdentityForTarget(manifest, acquisition);
    const lease = nativeActionLease(acquisition.observation);
    const check = async () => {
      await verify();
      if (binding && nativeIdentityDigest(binding()) !== nativeIdentityDigest(manifest.bridgeBinding)) throw new NativeIdentityError("native-bridge-binding-changed");
      const clock = checkApproval();
      verifyNativeIdentityForTarget(manifest, { ...acquisition, now: clock.wall, elapsedMs: Math.max(acquisition.elapsedMs, clock.mono - observedMono) });
    };
    await check();
    if (record) {
      await record({ kind: "observation", targetManifestSha256: loaded.sha256, acquisition: structuredClone(acquisition) });
      await check();
    }
    let ordinal = 0, busy = false, stopped = false;
    const approvalWindow = { targetManifestSha256: loaded.sha256, validFrom: manifest.signature.validFrom, validUntil: manifest.signature.validUntil };
    const captures = createNativeCaptureExecutor({ lease, approvalWindow, policy: charter.capture, check, send: capture, record });
    return {
      targetManifestSha256: loaded.sha256, observation: structuredClone(acquisition.observation),
      async checkActive(): Promise<void> {
        if (stopped || busy) throw new NativeExecutionError(stopped ? "native-execution-stopped" : "native-execution-busy", false);
        try { await check(); }
        catch { stopped = true; throw new NativeExecutionError("native-execution-expired", false); }
      },
      async capture(action: NativeExecutionCapture) {
        const cleanup = action?.operation === "stop" || action?.operation === "discard";
        if (busy || (stopped && !cleanup)) throw new NativeExecutionError(busy ? "native-execution-busy" : "native-execution-stopped", false);
        busy = true;
        try { return await captures.perform(action); }
        catch (error) { stopped = true; throw error; }
        finally { busy = false; }
      },
      async perform(action: NativeExecutionAction): Promise<NativeActionResult> {
        if (stopped) throw new NativeExecutionError("native-execution-stopped", false);
        if (busy) throw new NativeExecutionError("native-execution-busy", false);
        busy = true;
        let dispatched = false, receipt: NativeActionResult | undefined, prepared = false, failed = false;
        let requestSha256 = "", started: number | null = null;
        try {
          try {
            const snapshot = structuredClone(action);
            await check();
            const request: NativeActionRequest = { ...snapshot, schemaVersion: "lakda/native-action-request/v2", lease: structuredClone(lease),
              approvalWindow: structuredClone(approvalWindow), ordinal: ++ordinal };
            assertNativeActionRequest(request);
            requestSha256 = nativeIdentityDigest(request);
            if (record) {
              await record({ kind: "action-requested", requestSha256, requestedAt: Date.now(), expectation: nativeActionReceiptExpectation(request) });
              prepared = true;
              await check();
            }
            started = Date.now();
            dispatched = true;
            const value = structuredClone(await send(structuredClone(request)));
            receipt = validateNativeActionReceipt(request, value, started);
            await check();
            if (receipt.operation === "execute" ? receipt.result.status !== "executed" : !receipt.result.recovered) stopped = true;
          } catch { failed = true; stopped = true; }
          const actionAttempted = receipt?.actionAttempted ?? (dispatched ? "unknown" : false);
          if (record && prepared) {
            try {
              await record({ kind: "action-finished", requestSha256, ordinal, startedAt: started, finishedAt: Date.now(),
                executionStatus: failed ? "failed" : "completed", actionAttempted, receipt: receipt ? structuredClone(receipt) : null });
            } catch { failed = true; stopped = true; }
          }
          if (failed || !receipt) throw new NativeExecutionError("native-execution-failed", actionAttempted, receipt);
          return structuredClone(receipt);
        } finally { busy = false; }
      },
    };
  } catch { throw new NativeIdentityError("native-execution-unavailable"); }
}
