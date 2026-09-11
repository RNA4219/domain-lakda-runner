import { validateAdaptiveEvidenceTrace } from "../adaptive/replay.js";
import { integerValue, object, stringValue } from "../runs/catalog-values.js";
import { ReportInputError, REPORT_LIMITS } from "./contracts.js";
import { cleanReportText } from "./projection-values.js";
import { readHistoryEvidence } from "./evidence-history.js";
import { createStepProjector } from "./step-projection.js";

const controlKeys: Record<string, string[]> = {
  "operator-control": ["type", "command", "requestId", "reason", "actionCount"],
  "operator-bookmark": ["type", "requestId", "evidenceRefs", "actionCount"],
  "operator-bookmark-error": ["type", "requestId", "actionCount", "reason"],
  "operator-control-error": ["type", "reason"],
};

/** Observation history includes operator events which are intentionally not replay instructions. */
export function readAdaptiveReportHistory(value: unknown): Array<{ type: string; label: string; candidateId?: string } & ReturnType<typeof readHistoryEvidence> & ReturnType<ReturnType<typeof createStepProjector>>> {
  const trace = object(value, "adaptive history");
  if (!Array.isArray(trace.trace) || trace.trace.length > REPORT_LIMITS.actionsAndEvents) throw new ReportInputError("invalid-history", "探索履歴の件数または形式が不正です");
  const entries = trace.trace.map((entry: unknown) => object(entry, "adaptive history entry"));
  const standard: unknown[] = [];
  for (const entry of entries) {
    const kind = stringValue(entry.type, "adaptive history type");
    const allowed = Object.hasOwn(controlKeys, kind) ? controlKeys[kind] : undefined;
    if (!allowed) { standard.push(entry); continue; }
    const invalid = () => new ReportInputError("invalid-history", "探索のoperator記録が不正です");
    if (Object.keys(entry).some(key => !allowed.includes(key))) throw invalid();
    if (entry.requestId !== undefined) stringValue(entry.requestId, "operator request ID");
    if (kind !== "operator-control-error") integerValue(entry.actionCount, "operator action count");
    if (kind === "operator-control") {
      if (entry.command !== "pause" && entry.command !== "kill" || typeof entry.reason !== "string") throw invalid();
    } else if (kind === "operator-bookmark") {
      if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.some(ref => typeof ref !== "string" || !ref)) throw invalid();
    } else if (entry.reason !== (kind === "operator-bookmark-error" ? "artifact-failure" : "invalid-control-file")) throw invalid();
  }
  validateAdaptiveEvidenceTrace({ ...trace, trace: standard });
  if (trace.actions !== undefined) integerValue(trace.actions, "adaptive action count");
  const projectStep = createStepProjector(entries);
  return entries.map((entry, index) => ({
    type: entry.type as string,
    label: cleanReportText(entry.type + (entry.type === "operator-control" ? ": " + entry.command + " / " + entry.reason : "")),
    ...(entry.candidateId !== undefined ? { candidateId: stringValue(entry.candidateId, "history candidate ID") } : {}),
    ...readHistoryEvidence(entry),
    ...projectStep(entry, index),
  }));
}
