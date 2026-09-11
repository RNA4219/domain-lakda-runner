import type { ActionCandidate, ExecutionResult, OracleResult } from "../adaptive/contracts.js";
import type { ReportTimeline } from "./types.js";
import { cleanReportText } from "./projection-values.js";

/** Called only after validation of the retained adaptive trace. */
export function createStepProjector(entries: Record<string, unknown>[]) {
  const candidates = new Map<string, { value: ActionCandidate; index: number } | null>();
  entries.forEach((entry, index) => {
    if (entry.type !== "candidate" || !entry.candidate) return;
    const value = entry.candidate as ActionCandidate; const previous = candidates.get(value.candidateId);
    if (previous === null || previous && JSON.stringify(previous.value) !== JSON.stringify(value)) candidates.set(value.candidateId, null);
    else if (!previous) candidates.set(value.candidateId, { value, index });
  });
  const description = (candidate?: ActionCandidate) => {
    if (!candidate) return { operation: null, target: null };
    const recipe = candidate.locatorRecipe;
    const target = ["test-id", "role", "scoped-role", "label", "text"].includes(recipe.strategy) ? recipe.name ?? recipe.value : candidate.targetRef.targetId;
    return { operation: cleanReportText(candidate.actionKind), target: cleanReportText(target) };
  };
  return (entry: Record<string, unknown>, index: number): { step?: ReportTimeline["step"]; at?: string } => {
    const step: NonNullable<ReportTimeline["step"]> = { operation: null, target: null, status: null, durationMs: null, message: null };
    if (entry.type === "execution") {
      const result = entry.executionResult as ExecutionResult; const candidate = candidates.get(result.candidateId);
      Object.assign(step, description(candidate && candidate.index < index ? candidate.value : undefined)); step.status = result.status;
      const start = Date.parse(result.startedAt); const end = Date.parse(result.endedAt);
      step.durationMs = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
      step.message = result.failureSignature ? cleanReportText(result.failureSignature) : null;
      return { step, ...(Number.isFinite(start) ? { at: new Date(start).toISOString() } : {}) };
    }
    if (entry.type === "oracle" || entry.type === "candidate-denied" && entry.oracleResult) {
      const result = (entry.type === "oracle" ? entry.result : entry.oracleResult) as OracleResult;
      return { step: { ...step, operation: "assert", target: cleanReportText(result.oracleId), status: result.verdict, message: cleanReportText(result.message) } };
    }
    if (entry.type === "candidate" && entry.candidate) return { step: { ...step, ...description(entry.candidate as ActionCandidate), status: "planned" } };
    if (entry.type === "candidate-denied") return { step: { ...step, status: "denied", message: typeof entry.reason === "string" ? cleanReportText(entry.reason) : null } };
    return {};
  };
}
