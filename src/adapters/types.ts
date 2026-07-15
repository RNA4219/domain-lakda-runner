import type { ActionCandidate, AdapterCapabilities, AdapterError, EvidenceArtifactRef, ExecutionResult, MutationKind, Observation, TargetRef } from "../adaptive/contracts.js";

export type ObserveContext = { runId: string; personaRef?: string; scopeHosts: string[] };
export type ExecuteContext = { runId: string; personaRef?: string; inputCaseRef?: string; timeoutMs: number; allowedMutationKinds?: MutationKind[]; race?: { groupId: string; participantIndex: number; participantCount: number } };
export type RecoverContext = { runId: string; strategy: string; expectedFingerprint?: string };
export type EvidenceRequest = { runId: string; kinds: string[] };
export type AdapterFailure = { category: AdapterError["category"]; messageRef: string; targetRef?: TargetRef };
export type RecoveryResult = { recovered: boolean; strategy: string; targetRef?: TargetRef; evidenceRefs: EvidenceArtifactRef[] };

export interface AdaptiveAdapter {
  capabilities(): AdapterCapabilities;
  observe(target: TargetRef, context: ObserveContext): Promise<Observation>;
  generateCandidates(observation: Observation): Promise<ActionCandidate[]>;
  execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult>;
  recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult>;
  captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]>;
}

export function mapAdapterError(adapterId: string, error: unknown, category: AdapterError["category"], originalErrorRef?: string): AdapterError {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1",
    adapterId,
    category,
    messageRef: error instanceof Error ? error.name : "adapter_error",
    ...(originalErrorRef ? { originalErrorRef } : {}),
    retryable: category === "timeout" || category === "target_lost" || category === "infrastructure_error",
  };
}
