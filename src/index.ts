export const LAKDA_VERSION = "0.5.0-rc.1";
export type { ArtifactVideoMode, LlmDecision, RunBatchResult, RunMode, RunOptions, RunOutcome, RunResult, TerminationReason, WorkerRunEntry } from "./core/types.js";
export type { CountChange, CoverageValueComparison, RunArtifactIntegrity, RunComparison, RunCoverageSummary, RunDetail, RunGraphSummary, RunIndex, RunSummary, SetComparison, TransitionComparison, ValueComparison } from "./runs/types.js";
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
export type { CaptureControlRequest, CaptureControlResult, ExternalToolBridge, SecurityCleanupRequest, SecurityCleanupResult, SecurityControlRequest, SecurityControlResult } from "./adapters/external-bridges.js";
export { LoopbackJsonBridge } from "./adapters/loopback-json.js";
export {
  EXPLORATION_CAPABILITY_VERSION, EXPLORATION_CHARTER_VERSION, EXPLORATION_FINDING_VERSION, EXPLORATION_REPORT_VERSION, EXPLORATION_SESSION_VERSION,
  assertExplorationCapabilitySnapshot, assertExplorationCharter, assertExplorationFinding, assertExplorationReport, assertExplorationSession, explorationDigest,
} from "./exploration/contracts.js";
export type { ExplorationCapabilitySnapshot, ExplorationCharter, ExplorationExecutionMode, ExplorationFinding, ExplorationPlatform, ExplorationProfile, ExplorationReport, ExplorationSession, ExplorationSessionEvent, ExplorationSessionStatus } from "./exploration/contracts.js";
export { TemplatePocoCandidateProvider, assertVisualCandidate, normalizeVisualRegion, unknownScreenDebt, unknownScreenOracle, visualCandidateId } from "./adaptive/visual.js";
export type { VisualCandidate, VisualCandidateInput, VisualIdentity, VisualRegion } from "./adaptive/visual.js";
export { EXPLORATION_TARGET_MANIFEST_VERSION, loadSignedExplorationTargetManifest, targetManifestDigest, targetManifestSigningPayload, verifyTrustedEd25519Payload } from "./exploration/target-manifest.js";
export type { ExplorationTargetManifest, ExplorationTargetBinding } from "./exploration/target-manifest.js";
export { BINARY_ATTESTATION_VERSION, readBinaryAttestations, verifyBinaryAttestation } from "./exploration/binary-attestation.js";
export type { BinaryArtifactAttestation } from "./exploration/binary-attestation.js";
export { EXPLORATION_ACCEPTANCE_INDEX_VERSION, REQUIRED_EXPLORATION_LANES, aggregateExplorationAcceptance } from "./exploration/acceptance.js";
export type { ExplorationAcceptanceIndex, ExplorationAcceptanceIndexEntry, ExplorationAcceptanceAggregate } from "./exploration/acceptance.js";
