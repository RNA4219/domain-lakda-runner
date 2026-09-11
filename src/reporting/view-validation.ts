import { findSensitive } from "../core/redaction.js";
import { assertReportSchema, REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { maximumClassification, serializeReportData } from "./projection-values.js";
import { reportTimestamp } from "./source-values.js";
import type { Outcome, ReportView } from "./types.js";
import { assertReportBatchSemantics } from "./batch-validation.js";
import { assertIncompleteRunSemantics } from "./incomplete-validation.js";

/** Validate relationships as well as JSON shape; no producer or acceptance verdict is inferred. */
export function assertReportViewSemantics(value: unknown): asserts value is ReportView {
  assertReportSchema("view", value);
  const view = value as ReportView;
  assertReportBatchSemantics(view);
  assertIncompleteRunSemantics(view);
  const require = (condition: boolean) => { if (!condition) throw new ReportInputError("inconsistent-view", "表示データの件数・参照・状態が一致しません"); };
  const unique = (ids: string[]) => { require(new Set(ids).size === ids.length); return new Set(ids); };
  const sources = new Map(view.sources.map(source => [source.id, source]));
  unique(view.sources.map(source => source.id));
  const runs = unique(view.runs.map(run => run.key));
  unique(view.runs.map(run => run.sourceId));
  unique(view.sessions.map(session => session.key));
  unique(view.sessions.map(session => session.sourceId));
  const records = unique([...view.rows, ...view.timeline].map(record => record.id));
  const recordsById = new Map([...view.rows, ...view.timeline].map(record => [record.id, record]));
  const rowsById = new Map(view.rows.map(row => [row.id, row]));
  const mediaRecords = new Map(view.media.map(item => [item.id, new Set(item.recordIds)]));
  const recordMedia = new Map([...view.rows, ...view.timeline].map(record => [record.id, new Set(record.evidenceIds)]));
  const runsByKey = new Map(view.runs.map(run => [run.key, run]));
  const sessionsBySource = new Map(view.sessions.map(session => [session.sourceId, session]));
  const media = unique(view.media.map(item => item.id));
  const inputs = unique(view.inputSourceIds);
  require(inputs.size > 0 && inputs.size <= REPORT_LIMITS.sources && [...inputs].every(id => sources.has(id)));
  const utc = (at: string | null) => { if (at !== null) require(reportTimestamp(at) === at); };
  utc(view.generatedAt);
  for (const summary of [...view.runs, ...view.sessions]) {
    const source = sources.get(summary.sourceId);
    require(source !== undefined && source.status === "verified" && source.kind === ("runId" in summary ? "run" : "session"));
    require(source?.producerRevision === summary.producerRevision && source?.targetRevision === summary.targetRevision);
    utc(summary.startedAt); utc(summary.endedAt);
    const duration = Date.parse(summary.endedAt) - Date.parse(summary.startedAt);
    require(summary.durationMs === (duration < 0 ? null : duration));
  }
  for (const session of view.sessions) require(session.runKeys.every(key => runs.has(key) || sources.get(key)?.status === "restricted" && sources.get(key)?.kind === "run"));
  for (const record of [...view.rows, ...view.timeline]) {
    require(sources.has(record.sourceId) && sources.get(record.sourceId)?.status !== "restricted");
    require(record.runKey === null || runs.has(record.runKey));
    require(record.evidenceIds.every(id => media.has(id)));
    require(record.evidenceIds.every(id => mediaRecords.get(id)!.has(record.id)));
    if (record.evidenceNotes?.includes("unavailable")) require(view.issues.some(issue => issue.sourceId === record.sourceId && issue.code === "evidence-unavailable" && issue.severity === "warning"));
    unique(record.evidenceIds); utc(record.at);
  }
  for (const run of view.runs) {
    if (run.actionCount !== null) require(run.actionCount === view.timeline.filter(event => event.runKey === run.key && event.sourceId === run.sourceId && event.kind === "execution").length);
    for (const coverage of run.coverage) {
      if (coverage.status !== "recorded") require(coverage.numerator === null && coverage.denominator === null && coverage.ratio === null);
      else {
        require(coverage.numerator !== null && coverage.denominator !== null && coverage.numerator <= coverage.denominator);
        require(coverage.denominator === 0 ? coverage.ratio === null : coverage.ratio !== null && Math.abs(coverage.ratio - coverage.numerator! / coverage.denominator!) < 1e-9);
      }
    }
  }
  unique(view.media.filter(item => item.path !== null).map(item => item.path!));
  for (const item of view.media) {
    require(sources.has(item.sourceId) && (item.runKey === null || runs.has(item.runKey)));
    require(item.recordIds.every(id => records.has(id))); unique(item.recordIds);
    const source = sources.get(item.sourceId)!;
    require(source.status === "verified" && (source.kind === "run" ? item.runKey !== null && runsByKey.get(item.runKey)?.sourceId === item.sourceId : source.kind === "session" && item.runKey === null && sessionsBySource.has(item.sourceId)));
    for (const id of item.recordIds) {
      const record = recordsById.get(id)!;
      require(recordMedia.get(id)!.has(item.id) && item.classification !== "restricted");
      if (record.sourceId === item.sourceId) require(record.runKey === item.runKey || sources.get(record.sourceId)?.kind === "session" && item.runKey === null);
      else if (rowsById.get(id)?.kind === "worker") require(record.runKey !== null && record.runKey === item.runKey);
      else {
        const session = sessionsBySource.get(record.sourceId);
        require(session !== undefined && (!rowsById.has(id) || rowsById.get(id)?.kind === "finding") && item.runKey !== null && session.runKeys.includes(item.runKey) && (record.runKey === null || record.runKey === item.runKey));
      }
    }
    require(item.scope === "record" ? item.recordIds.length > 0 : item.recordIds.length === 0);
    require(item.verification === "excluded" ? item.path === null && !!item.reason : item.path !== null);
    if (item.path !== null) {
      require(/^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|webm|mp4|zip)$/.test(item.path));
      require(item.classification !== "restricted" && sources.get(item.sourceId)?.status !== "restricted" && item.kind !== "unsupported");
      require(view.profile !== "share" || item.verification === "verified" && item.kind !== "trace");
    }
    require(item.verification === "verified" ? item.reason === null : !!item.reason);
    if (item.proof) {
      require(item.verification === "verified" && item.path !== null);
      const run = view.runs.find(run => run.key === item.runKey);
      const session = view.sessions.find(session => session.sourceId === item.sourceId);
      if (run?.mode === "adaptive-explore" || session?.executionMode === "real") require(item.proof.targetManifestSha256s.length > 0);
    }
  }
  const counts = view.counts;
  const countKind = (kind: string) => view.rows.filter(row => row.kind === kind).length;
  require(counts.sources === inputs.size && counts.runs === view.runs.length);
  require(counts.workerIncomplete === view.rows.filter(row => row.kind === "worker" && row.status === "error" && row.runKey === null).length);
  require(counts.failures === countKind("failure") && counts.warnings === countKind("warning") && counts.findings === countKind("finding"));
  require(counts.actions === view.runs.reduce((sum, run) => sum + (run.actionCount ?? 0), 0));
  require(counts.plannedActions === view.runs.reduce((sum, run) => sum + (run.plannedActionCount ?? 0), 0));
  require(counts.unknownActionRuns === view.runs.filter(run => run.actionCount === null).length);
  require(counts.events === view.timeline.filter(event => !["execution", "planned-action"].includes(event.kind)).length);
  require(counts.excludedMedia === view.media.filter(item => item.verification === "excluded").length);
  for (const outcome of ["passed", "failed", "partial", "error"] as Outcome[]) require(counts.outcomes[outcome] === view.runs.filter(run => run.outcome === outcome).length);
  require(counts.failures + counts.warnings + counts.findings <= REPORT_LIMITS.failuresAndFindings);
  require(view.issues.every(issue => issue.severity !== "error" && (issue.sourceId === null || sources.has(issue.sourceId))));
  const degraded = counts.unknownActionRuns > 0 || view.sources.some(source => source.status !== "verified") || view.issues.some(issue => issue.severity === "warning");
  require(view.generationStatus === (degraded ? "degraded" : "ready"));
  require(view.classification === maximumClassification([...view.sources.map(source => source.classification), ...view.media.filter(item => item.path !== null).map(item => item.classification)]));
  const serialized = serializeReportData(view);
  require(Buffer.byteLength(serialized, "utf8") <= REPORT_LIMITS.viewBytes && findSensitive(serialized).length === 0);
}
