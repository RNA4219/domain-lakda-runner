import { assertAdaptiveContract } from "../adaptive/contracts.js";
import type { ActionCandidate, AdapterCapabilities, EvidenceArtifactRef, ExecutionResult, Observation, TargetRef } from "../adaptive/contracts.js";
import type { AdaptiveAdapter, AdapterFailure, EvidenceRequest, ExecuteContext, ObserveContext, RecoverContext, RecoveryResult } from "./types.js";

export type SecurityControlRequest = { runId: string; killSwitchRef: string };
export type SecurityControlResult = { triggered: boolean; evidenceRefs: EvidenceArtifactRef[] };
export type SecurityCleanupRequest = { runId: string; cleanupRef: string; candidateId: string };
export type SecurityCleanupResult = { completed: boolean; evidenceRefs: EvidenceArtifactRef[] };

export interface ExternalToolBridge {
  capabilities(): AdapterCapabilities;
  observe(target: TargetRef, context: ObserveContext): Promise<Observation>;
  generateCandidates(observation: Observation): Promise<ActionCandidate[]>;
  execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult>;
  recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult>;
  captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]>;
  checkKillSwitch?(request: SecurityControlRequest): Promise<SecurityControlResult>;
  cleanup?(request: SecurityCleanupRequest): Promise<SecurityCleanupResult>;
}
class ValidatedBridgeAdapter implements AdaptiveAdapter {
  constructor(readonly adapterId: string, protected readonly bridge: ExternalToolBridge) {}
  capabilities(): AdapterCapabilities { const value = { ...this.bridge.capabilities(), adapterId: this.adapterId }; assertAdaptiveContract(value); return value; }
  async observe(target: TargetRef, context: ObserveContext): Promise<Observation> { const value = await this.bridge.observe(target, context); assertAdaptiveContract(value); return value; }
  async generateCandidates(observation: Observation): Promise<ActionCandidate[]> { const values = await this.bridge.generateCandidates(observation); values.forEach(assertAdaptiveContract); return values.filter(value => value.adapterId === this.adapterId); }
  async execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult> { if (candidate.adapterId !== this.adapterId) throw new Error("adapter candidate mismatch"); const value = await this.bridge.execute(candidate, context); assertAdaptiveContract(value); return value; }
  async recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult> { const value = await this.bridge.recover(failure, context); value.evidenceRefs.forEach(assertAdaptiveContract); return value; }
  async captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]> { const values = await this.bridge.captureEvidence(request); values.forEach(assertAdaptiveContract); return values; }
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
