export const LAKDA_VERSION = "0.4.0-rc.1";
export type { LlmDecision, RunBatchResult, RunMode, RunOptions, RunOutcome, RunResult, TerminationReason, WorkerRunEntry } from "./core/types.js";
export { ADAPTIVE_SCHEMA_VERSION, assertAdaptiveContract, assertCandidateDiscoveryResult, assertNoSensitivePublicData } from "./adaptive/contracts.js";
export type {
  ActionCandidate, ActionContract, AdapterCapabilities, AdapterError, AdaptiveConfig, AdaptiveContract, AdaptiveGeneratorStrategy,
  AdaptiveSchemaVersion, AdaptiveStopCondition, CandidateDiscoveryResult, CoverageDebt, CoverageDebtReason, EvidenceArtifactRef, ExecutionResult, LocatorRecipe, LocatorScope, MutationKind, Observation,
  OracleResult, SettleResult, StateFingerprint, TargetKind, TargetRef,
} from "./adaptive/contracts.js";
export { mapAdapterError } from "./adapters/types.js";
export type { AdaptiveAdapter, AdapterFailure, EvidenceRequest, ExecuteContext, ObserveContext, RecoverContext, RecoveryResult } from "./adapters/types.js";
export { PlaywrightAdaptiveAdapter } from "./adapters/playwright.js";
export type { PlaywrightAdaptiveAdapterOptions } from "./adapters/playwright.js";
export { AirtestPocoAdapter, SecurityAdapter } from "./adapters/external-bridges.js";
export type { ExternalToolBridge, SecurityCleanupRequest, SecurityCleanupResult, SecurityControlRequest, SecurityControlResult } from "./adapters/external-bridges.js";
export { LoopbackJsonBridge } from "./adapters/loopback-json.js";
