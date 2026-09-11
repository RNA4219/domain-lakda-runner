import type { ActionExecutionRecord } from "../core/artifacts.js";
import { object } from "../runs/catalog-values.js";
import { assertActionExecutionSchema, REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { cleanReportText } from "./projection-values.js";
import { reportTimestamp } from "./source-values.js";
import type { ReportTimeline } from "./types.js";

/** The executed prefix is bound to its own run and plan; plan tails remain unexecuted. */
export function projectActionExecutions(sourceId: string, value: unknown, planValue: unknown): ReportTimeline[] {
  assertActionExecutionSchema(value);
  const record = value as { runId: string; attempt: number; executions: ActionExecutionRecord[] };
  const fail = () => new ReportInputError("invalid-execution-history", "実行記録のrun・順序・計画bindingが一致しません");
  if (sourceId !== "run:" + record.runId + ":" + record.attempt) throw fail();
  const plan = object(planValue, "execution plan");
  if (!Array.isArray(plan.actions) || record.executions.length > plan.actions.length) throw fail();
  if (record.executions.length > REPORT_LIMITS.actionsAndEvents) throw new ReportInputError("row-limit", "操作の表示件数上限を超えています");
  return record.executions.map((entry, index) => {
    const action = object((plan.actions as unknown[])[index], "executed action");
    if (entry.sequence !== index + 1 || entry.actionId !== action.id || entry.kind !== action.kind || entry.status === "failed" && index !== record.executions.length - 1) throw fail();
    const start = reportTimestamp(entry.startedAt); const end = reportTimestamp(entry.endedAt);
    if (start !== entry.startedAt || end !== entry.endedAt) throw fail();
    return { id: sourceId + ":execution:" + entry.sequence, sourceId, runKey: sourceId, sequence: entry.sequence,
      at: start, kind: "execution", label: cleanReportText(entry.kind + " · " + entry.status + " · " + entry.durationMs + " ms · 終了 " + end), relatedIds: [cleanReportText(entry.actionId)], evidenceIds: [],
      step: { operation: entry.kind, target: cleanReportText(entry.actionId), status: entry.status, durationMs: entry.durationMs, message: null } };
  });
}
