import { assertAdaptiveContract } from "../adaptive/contracts.js";
import type { ActionCandidate, AdapterCapabilities, EvidenceArtifactRef, ExecutionResult, Observation, TargetRef } from "../adaptive/contracts.js";
import type { AdaptiveAdapter, AdapterFailure, EvidenceRequest, ExecuteContext, ObserveContext, RecoverContext, RecoveryResult } from "./types.js";
import type { NativeIdentityAcquisition } from "../exploration/native-identity-exchange.js";
import type { NativeActionRequest, NativeActionResult } from "../exploration/native-identity-actions.js";
import type { NativeCaptureRequest, NativeCaptureResult } from "../exploration/native-identity-capture.js";

export type SecurityControlRequest = { runId: string; killSwitchRef: string };
export type SecurityControlResult = { triggered: boolean; evidenceRefs: EvidenceArtifactRef[] };
export type SecurityCleanupRequest = { runId: string; cleanupRef: string; candidateId: string };
export type SecurityCleanupResult = { completed: boolean; evidenceRefs: EvidenceArtifactRef[] };
export type CaptureControlRequest = { runId: string; stagingDir: string; action: "start" | "stop" | "discard"; mode: "video" | "sampled-frames/v1"; intervalMs?: number; maxFrames?: number; maxBytes?: number; stopTimeoutMs?: number };
export type CaptureControlResult = { accepted: boolean; mode: "video" | "sampled-frames/v1"; artifactRefs: EvidenceArtifactRef[]; reason?: string; frameCount?: number; byteCount?: number; stopped?: boolean };

function assertCaptureControlRequest(request: CaptureControlRequest): void {
  if (!request.runId || !request.stagingDir) throw new Error("operator capture-control request requires runId and stagingDir");
  if (!["start", "stop", "discard"].includes(request.action) || !["video", "sampled-frames/v1"].includes(request.mode)) throw new Error("operator capture-control request action/mode is invalid");
  if (request.mode === "sampled-frames/v1") {
    const positive = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
    if (request.action === "start" && (!positive(request.intervalMs) || !positive(request.maxFrames) || !positive(request.maxBytes) || !positive(request.stopTimeoutMs))) {
      throw new Error("sampled-frame start requires positive intervalMs, maxFrames, maxBytes, and stopTimeoutMs");
    }
    if (request.action !== "start" && !positive(request.stopTimeoutMs)) {
      throw new Error("sampled-frame stop/discard requires a positive stopTimeoutMs");
    }
  }
}

export interface ExternalToolBridge {
  capabilities(): AdapterCapabilities;
  binding?(): { capabilityDigest: string; bridgeDigest: string };
  observeNativeIdentity?(maxAgeMs?: number): Promise<NativeIdentityAcquisition>;
  nativeAction?(request: NativeActionRequest): Promise<NativeActionResult>;
  nativeCapture?(request: NativeCaptureRequest): Promise<NativeCaptureResult>;
  observe(target: TargetRef, context: ObserveContext): Promise<Observation>;
  generateCandidates(observation: Observation): Promise<ActionCandidate[]>;
  discoverCandidates?(observation: Observation, sourceFingerprint?: string): Promise<{ candidates: ActionCandidate[]; coverageDebt: import("../adaptive/contracts.js").CoverageDebt[]; classification?: import("../adaptive/contracts.js").CandidateClassification }>;
  execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult>;
  recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult>;
  captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]>;
  captureControl?(request: CaptureControlRequest): Promise<CaptureControlResult>;
  checkKillSwitch?(request: SecurityControlRequest): Promise<SecurityControlResult>;
  cleanup?(request: SecurityCleanupRequest): Promise<SecurityCleanupResult>;
}

function assertCaptureControlResult(value: unknown, request: CaptureControlRequest): asserts value is CaptureControlResult {
  if (!value || typeof value !== "object") throw new Error("operator capture-control response is invalid");
  const record = value as Record<string, unknown>;
  if (typeof record.accepted !== "boolean") throw new Error("operator capture-control response is missing accepted");
  if (record.mode !== request.mode) throw new Error("operator capture-control response mode mismatch");
  if (!Array.isArray(record.artifactRefs)) throw new Error("operator capture-control response is missing artifactRefs");
  if (record.reason !== undefined && typeof record.reason !== "string") throw new Error("operator capture-control response reason is invalid");
  if (record.frameCount !== undefined && (!Number.isInteger(record.frameCount) || (record.frameCount as number) < 0)) throw new Error("operator capture-control response frameCount is invalid");
  if (record.byteCount !== undefined && (!Number.isInteger(record.byteCount) || (record.byteCount as number) < 0)) throw new Error("operator capture-control response byteCount is invalid");
  if (record.stopped !== undefined && typeof record.stopped !== "boolean") throw new Error("operator capture-control response stopped is invalid");
  if (request.action !== "start" && record.accepted === true) {
    if (record.stopped !== true) throw new Error("operator capture-control stop/discard must report stopped=true");
    if (request.action === "stop" && request.mode === "video" && record.artifactRefs.length === 0) throw new Error("video stop must report an artifactRef");
    if (request.mode === "sampled-frames/v1") {
      if (!Number.isInteger(record.frameCount) || (record.frameCount as number) < 0 || !Number.isInteger(record.byteCount) || (record.byteCount as number) < 0) {
        throw new Error("sampled-frame stop/discard must report frameCount and byteCount");
      }
      if (request.action === "stop" && ((record.frameCount as number) <= 0 || (record.byteCount as number) <= 0)) {
        throw new Error("sampled-frame stop must report positive frameCount and byteCount");
      }
    }
  }
  record.artifactRefs.forEach(assertAdaptiveContract);
}

class ValidatedBridgeAdapter implements AdaptiveAdapter {
  constructor(readonly adapterId: string, protected readonly bridge: ExternalToolBridge) {}
  capabilities(): AdapterCapabilities { const value = { ...this.bridge.capabilities(), adapterId: this.adapterId }; assertAdaptiveContract(value); return value; }
  async observe(target: TargetRef, context: ObserveContext): Promise<Observation> { const value = await this.bridge.observe(target, context); assertAdaptiveContract(value); return value; }
  async generateCandidates(observation: Observation): Promise<ActionCandidate[]> { const values = await this.bridge.generateCandidates(observation); values.forEach(assertAdaptiveContract); return values.filter(value => value.adapterId === this.adapterId); }
  async discoverCandidates(observation: Observation, sourceFingerprint?: string): Promise<{ candidates: ActionCandidate[]; coverageDebt: import("../adaptive/contracts.js").CoverageDebt[]; classification?: import("../adaptive/contracts.js").CandidateClassification }> {
    const value = this.bridge.discoverCandidates ? await this.bridge.discoverCandidates(observation, sourceFingerprint) : { candidates: await this.generateCandidates(observation), coverageDebt: [] };
    value.candidates.forEach(assertAdaptiveContract);
    return { ...value, candidates: value.candidates.filter(candidate => candidate.adapterId === this.adapterId) };
  }
  async execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult> { if (candidate.adapterId !== this.adapterId) throw new Error("adapter candidate mismatch"); const value = await this.bridge.execute(candidate, context); assertAdaptiveContract(value); return value; }
  async recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult> { const value = await this.bridge.recover(failure, context); value.evidenceRefs.forEach(assertAdaptiveContract); return value; }
  async captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]> { const values = await this.bridge.captureEvidence(request); values.forEach(assertAdaptiveContract); return values; }
  async captureControl(request: CaptureControlRequest): Promise<CaptureControlResult> {
    if (!this.bridge.captureControl) throw new Error("operator bridge capture-control endpoint is unavailable");
    assertCaptureControlRequest(request);
    const value = await this.bridge.captureControl(request);
    assertCaptureControlResult(value, request);
    return value;
  }
}
/** Airtest/Poco remains the device-facing hand; this adapter validates only Lakda public DTOs. */
export class AirtestPocoAdapter extends ValidatedBridgeAdapter { constructor(bridge: ExternalToolBridge) { super("airtest-poco", bridge); } }
/** Security bridge is for approved, authenticated DAST integrations; it does not scan a target by itself. */
export class SecurityAdapter extends ValidatedBridgeAdapter {
  constructor(bridge: ExternalToolBridge) { super("security", bridge); }

  async checkKillSwitch(request: SecurityControlRequest): Promise<SecurityControlResult> {
    if (!this.bridge.checkKillSwitch) throw new Error("security control endpoint is unavailable");
    const value = await this.bridge.checkKillSwitch(request);
    value.evidenceRefs.forEach(assertAdaptiveContract);
    return value;
  }

  async cleanup(request: SecurityCleanupRequest): Promise<SecurityCleanupResult> {
    if (!this.bridge.cleanup) throw new Error("security cleanup endpoint is unavailable");
    const value = await this.bridge.cleanup(request);
    value.evidenceRefs.forEach(assertAdaptiveContract);
    return value;
  }
}
