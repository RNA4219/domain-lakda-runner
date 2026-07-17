import type { ActionCandidate, CandidateClassification, CoverageDebt } from "./contracts.js";

export type CandidateSnapshotForAudit = {
  candidates: ActionCandidate[];
  coverageDebt: CoverageDebt[];
  classification?: CandidateClassification;
};

export type TargetCandidateAudit = {
  schemaVersion: "lakda/target-candidate-audit/v1";
  snapshotCount: number;
  observedControls: number;
  classifiedControls: number;
  unclassifiedControls: number;
  candidateCount: number;
  coverageDebtCount: number;
  debtByReason: Record<string, number>;
  requiredActionIds: string[];
  observedActionIds: string[];
  debtActionIds: string[];
  eligible: boolean;
  violations: string[];
};

type AuditRequirements = { p0ActionIds: readonly string[]; p1ActionIds: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function stableActionId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function auditTargetCandidateCoverage(snapshotsValue: unknown, requirements: AuditRequirements): TargetCandidateAudit {
  const violations: string[] = [];
  const snapshots = Array.isArray(snapshotsValue) ? snapshotsValue : [];
  if (!Array.isArray(snapshotsValue) || snapshots.length === 0) violations.push("candidate_snapshots_missing");
  let observedControls = 0;
  let classifiedControls = 0;
  let unclassifiedControls = 0;
  let candidateCount = 0;
  let coverageDebtCount = 0;
  const debtByReason: Record<string, number> = {};
  const observedActionIds = new Set<string>();
  const debtActionIds = new Set<string>();

  snapshots.forEach((snapshot, index) => {
    if (!isRecord(snapshot) || !Array.isArray(snapshot.candidates) || !Array.isArray(snapshot.coverageDebt)) {
      violations.push(`candidate_snapshot_invalid:${index}`);
      return;
    }
    const candidates = snapshot.candidates as ActionCandidate[];
    const coverageDebt = snapshot.coverageDebt as CoverageDebt[];
    candidateCount += candidates.length;
    coverageDebtCount += coverageDebt.length;
    for (const candidate of candidates) {
      const actionId = stableActionId(candidate?.mutationClassification?.actionId);
      if (actionId) observedActionIds.add(actionId);
    }
    for (const debt of coverageDebt) {
      const actionId = stableActionId(debt?.actionId);
      if (actionId) debtActionIds.add(actionId);
      if (typeof debt?.reason === "string" && debt.reason) debtByReason[debt.reason] = (debtByReason[debt.reason] ?? 0) + 1;
    }
    const classification = snapshot.classification;
    if (!isRecord(classification) || !nonNegativeInteger(classification.observedControls) || !nonNegativeInteger(classification.classifiedControls) || !nonNegativeInteger(classification.unclassifiedControls)) {
      violations.push(`candidate_classification_metrics_missing:${index}`);
      return;
    }
    observedControls += classification.observedControls;
    classifiedControls += classification.classifiedControls;
    unclassifiedControls += classification.unclassifiedControls;
    if (classification.classifiedControls !== candidates.length + coverageDebt.length) violations.push(`candidate_classification_count_mismatch:${index}`);
    if (classification.observedControls !== classification.classifiedControls || classification.unclassifiedControls !== 0) violations.push(`candidate_classification_incomplete:${index}`);
  });

  const p0 = [...new Set(requirements.p0ActionIds)].sort();
  const p1 = [...new Set(requirements.p1ActionIds)].sort();
  const overlap = p0.filter(actionId => p1.includes(actionId));
  for (const actionId of overlap) violations.push(`required_action_id_duplicated:${actionId}`);
  const requiredActionIds = [...new Set([...p0, ...p1])].sort();
  for (const actionId of requiredActionIds) {
    if (debtActionIds.has(actionId)) violations.push(`required_action_coverage_debt:${actionId}`);
    else if (!observedActionIds.has(actionId)) violations.push(`required_action_not_observed:${actionId}`);
  }

  const sortedViolations = [...new Set(violations)].sort();
  return {
    schemaVersion: "lakda/target-candidate-audit/v1",
    snapshotCount: snapshots.length,
    observedControls,
    classifiedControls,
    unclassifiedControls,
    candidateCount,
    coverageDebtCount,
    debtByReason: Object.fromEntries(Object.entries(debtByReason).sort(([left], [right]) => left.localeCompare(right))),
    requiredActionIds,
    observedActionIds: [...observedActionIds].sort(),
    debtActionIds: [...debtActionIds].sort(),
    eligible: sortedViolations.length === 0,
    violations: sortedViolations,
  };
}