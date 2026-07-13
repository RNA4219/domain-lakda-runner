import type { ArtifactPolicyReport } from "./artifact-policy.js";
import type { RunOutcome, TerminationReason } from "./types.js";

export type OutcomeDecision = { outcome: RunOutcome; terminationReason: TerminationReason };

export function applyArtifactPolicy(current: OutcomeDecision, report: ArtifactPolicyReport): OutcomeDecision {
  if (report.residualSensitivePaths.length > 0 || report.missingPaths.length > 0 || report.profileMissingPaths.length > 0 || report.unsupportedPaths.length > 0) {
    return { outcome: "error", terminationReason: "artifact_failure" };
  }
  if (report.sizeExceeded && current.outcome !== "error") {
    return { outcome: "partial", terminationReason: "artifact_limit" };
  }
  return current;
}

const precedence: Record<RunOutcome, number> = { passed: 0, partial: 1, failed: 2, error: 3 };

export function aggregateOutcomes(outcomes: RunOutcome[]): RunOutcome {
  return outcomes.reduce<RunOutcome>((current, value) => precedence[value] > precedence[current] ? value : current, "passed");
}