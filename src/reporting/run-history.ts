import { coverageMetricKeys, parseCoverage, parseGraph } from "../runs/catalog-graph.js";
import { object, stringValue } from "../runs/catalog-values.js";
import { cleanReportText } from "./projection-values.js";
import { ReportInputError, REPORT_LIMITS } from "./contracts.js";
import { projectActionExecutions } from "./execution-history.js";
import { readAdaptiveReportHistory } from "./adaptive-history.js";
import type { ReportEvidence } from "./evidence-history.js";
import type { ReportCoverage, ReportIssue, ReportTimeline } from "./types.js";

type JsonReader = (ref: string) => unknown | undefined;
export function projectRunHistory(sourceId: string, mode: string, json: JsonReader, issues: ReportIssue[]): {
  actionCount: number | null; plannedActionCount: number | null; timeline: ReportTimeline[]; coverage: ReportCoverage[]; evidence: ReportEvidence;
} {
  const timeline: ReportTimeline[] = [];
  const coverage: ReportCoverage[] = [];
  const evidence: ReportEvidence = { records: new Map(), oracles: [] };
  let actionCount: number | null = null;
  let plannedActionCount: number | null = null;
  const missing = (code: string, message: string) => issues.push({ code, message, severity: "warning", sourceId });
  const event = (index: number, kind: string, label: string, relatedIds: string[] = []): ReportTimeline => ({
    id: sourceId + ":history:" + (index + 1), sourceId, runKey: sourceId, sequence: index + 1,
    at: null, kind, label: cleanReportText(label), relatedIds: relatedIds.map(cleanReportText), evidenceIds: [],
  });
  if (mode === "adaptive-explore") {
    const graphValue = json("adaptive/transition-graph.json");
    const coverageValue = json("adaptive/coverage.json");
    if (graphValue !== undefined && coverageValue !== undefined) {
      const graph = parseGraph(graphValue);
      const metrics = parseCoverage(coverageValue, graph.snapshot);
      for (const name of coverageMetricKeys) {
        const value = metrics[name];
        coverage.push({ name, definition: "保存済みdiscovered-modelの" + name + "被覆。分母はこのrunの発見範囲", scope: sourceId, status: "recorded", numerator: value.numerator, denominator: value.denominator, ratio: value.denominator === 0 ? null : value.ratio });
      }
    } else missing("coverage-unavailable", "探索coverageは未取得です");
    const trace = json("adaptive/trace.json") ?? json("adaptive/replay-trace.json");
    if (trace !== undefined) {
      const entries = readAdaptiveReportHistory(trace);
      actionCount = 0;
      for (const [index, entry] of entries.entries()) {
        if (entry.type === "execution") actionCount += 1;
        const record = event(index, entry.type, entry.label, entry.candidateId ? [entry.candidateId] : []);
        if (entry.step) record.step = entry.step;
        if (entry.at) record.at = entry.at;
        timeline.push(record);
        if (entry.evidenceRefs.length) evidence.records.set(record.id, entry.evidenceRefs);
        if (entry.oracle) evidence.oracles.push(entry.oracle);
      }
    } else missing("execution-history-unavailable", "探索操作の実行履歴は未取得です");
  } else {
    const value = json("action-sequence.json");
    if (value !== undefined) {
      const plan = object(value, "action plan");
      if (plan.schemaVersion !== "lakda/action-plan/v1" || !Array.isArray(plan.actions)) throw new ReportInputError("invalid-history", "action plan schemaVersionまたはactionsが不正です");
      plannedActionCount = plan.actions.length;
      if (plannedActionCount > REPORT_LIMITS.actionsAndEvents) throw new ReportInputError("row-limit", "計画actionの表示上限を超えています");
      for (const [index, raw] of plan.actions.entries()) {
        const action = object(raw, "planned action");
        const kind = stringValue(action.kind, "planned action kind");
        if (!["navigate", "goto", "click", "fill", "check", "select", "press"].includes(kind)) throw new ReportInputError("invalid-history", "計画actionのkindが不正です");
        timeline.push(event(index, "planned-action", "計画: " + kind, [stringValue(action.id, "planned action id")]));
      }
    }
    const execution = json("action-execution.json");
    if (execution === undefined) missing("execution-history-unavailable", "保存済みactionは計画です。実行済み件数・時刻は未取得です");
    else {
      const executed = projectActionExecutions(sourceId, execution, value);
      actionCount = executed.length;
      timeline.splice(0, timeline.length, ...executed);
    }
    coverage.push({ name: "exploration", definition: "探索coverageはこのmodeの対象外", scope: sourceId, status: "not-applicable", numerator: null, denominator: null, ratio: null });
  }
  if (timeline.length > REPORT_LIMITS.actionsAndEvents) throw new ReportInputError("row-limit", "操作・eventの表示上限を超えています");
  return { actionCount, plannedActionCount, timeline, coverage, evidence };
}
