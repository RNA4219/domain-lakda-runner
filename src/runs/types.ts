import type { RunOutcome } from "../core/types.js";

export const RUN_INDEX_SCHEMA_VERSION = "lakda/run-index/v1" as const;
export const RUN_DETAIL_SCHEMA_VERSION = "lakda/run-detail/v1" as const;
export const RUN_COMPARISON_SCHEMA_VERSION = "lakda/run-comparison/v1" as const;

export type RunSummary = {
  runId: string;
  runRef: string;
  startedAt: string;
  endedAt: string;
  mode: string;
  outcome: RunOutcome;
  terminationReason: string;
  seed: number;
  producerVersion: string;
  commitSha: string;
};

export type RunArtifactIntegrity = {
  status: "verified";
  manifestSha256: string;
  artifactCount: number;
  verifiedArtifactBytes: number;
};

export type CoverageMetric = {
  numerator: number;
  denominator: number;
  ratio: number;
};

export type RunCoverageSummary = {
  state: CoverageMetric;
  action: CoverageMetric;
  transition: CoverageMetric;
  transitionPair: CoverageMetric;
  roundTrip: CoverageMetric;
  obligation: CoverageMetric;
  stateCoverage: number;
  actionCoverage: number;
  transitionCoverage: number;
  transitionPairCoverage: number;
  roundTripCoverage: number;
  obligationCoverage: number;
};

export type RunGraphSummary = {
  schemaVersion: string;
  fingerprintAlgorithmVersion: string;
  fingerprintCanonicalizationVersion: string;
  revision: number;
  stateCount: number;
  transitionCount: number;
  transitionPairCount: number;
  roundTripCount: number;
  coverage: RunCoverageSummary;
};

export type RunIndex = {
  schemaVersion: typeof RUN_INDEX_SCHEMA_VERSION;
  total: number;
  returned: number;
  truncated: boolean;
  runs: RunSummary[];
};

export type RunDetail = {
  schemaVersion: typeof RUN_DETAIL_SCHEMA_VERSION;
  run: RunSummary;
  integrity: RunArtifactIntegrity;
  graph?: RunGraphSummary;
};

export type SetComparison = {
  baseCount: number;
  headCount: number;
  delta: number;
  commonCount: number;
  added: string[];
  removed: string[];
};

export type StateChange = {
  fingerprint: string;
  changedFields: string[];
};

export type StateComparison = SetComparison & {
  changed: StateChange[];
};

export type CountChange = {
  key: string;
  base: number;
  head: number;
  delta: number;
};

export type TransitionComparison = SetComparison & {
  countChanges: CountChange[];
};

export type CoverageValueComparison = {
  base: number;
  head: number;
  delta: number;
};

export type CoverageMetricComparison = {
  numerator: CoverageValueComparison;
  denominator: CoverageValueComparison;
  ratio: CoverageValueComparison;
};

export type ValueComparison = {
  base: string;
  head: string;
  changed: boolean;
};

export type RunComparison = {
  schemaVersion: typeof RUN_COMPARISON_SCHEMA_VERSION;
  graphSchemaVersion: "lakda/state-graph/v1";
  fingerprintAlgorithmVersion: string;
  fingerprintCanonicalizationVersion: string;
  base: { run: RunSummary; integrity: RunArtifactIntegrity };
  head: { run: RunSummary; integrity: RunArtifactIntegrity };
  states: StateComparison;
  transitions: TransitionComparison;
  transitionPairs: SetComparison;
  roundTrips: SetComparison;
  coverage: {
    state: CoverageMetricComparison;
    action: CoverageMetricComparison;
    transition: CoverageMetricComparison;
    transitionPair: CoverageMetricComparison;
    roundTrip: CoverageMetricComparison;
    obligation: CoverageMetricComparison;
    stateCoverage: CoverageValueComparison;
    actionCoverage: CoverageValueComparison;
    transitionCoverage: CoverageValueComparison;
    transitionPairCoverage: CoverageValueComparison;
    roundTripCoverage: CoverageValueComparison;
    obligationCoverage: CoverageValueComparison;
  };
  outcome: ValueComparison;
  terminationReason: ValueComparison;
};