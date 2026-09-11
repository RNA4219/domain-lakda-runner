import { findSensitive } from "../core/redaction.js";
import { assertSafePublicValue } from "../runs/catalog-values.js";
import { assertReportSchema, REPORT_LIMITS, ReportInputError, type ReportProfile } from "./contracts.js";
import { maximumClassification, serializeReportData } from "./projection-values.js";
import type { ReportSourceCollection } from "./source-collection.js";
import { reportTimestamp } from "./source-values.js";
import { assertReportViewSemantics } from "./view-validation.js";
import { prepareReportEvidenceLinks, type ReportEvidenceLinks } from "./evidence-links.js";
import type { Outcome, ReportIncompleteRun, ReportIssue, ReportMedia, ReportRow, ReportRun, ReportSession, ReportView } from "./types.js";

type ViewOptions = { reportId: string; generatedAt: string; producerVersion: string; profile: ReportProfile; media: ReportMedia[]; issues: ReportIssue[]; evidence?: ReportEvidenceLinks };
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const rank = (status: string | null | undefined) => ["error", "failed", "partial", "passed"].indexOf(status ?? "") < 0 ? 4 : ["error", "failed", "partial", "passed"].indexOf(status!);

export function buildReportView(collection: ReportSourceCollection, options: ViewOptions): ReportView {
  assertSafePublicValue(options.reportId, "report ID");
  assertSafePublicValue(options.producerVersion, "report producer version");
  const inputs = [...collection.runs, ...collection.sessions, ...(collection.diagnostics ?? []), ...(collection.batch ? [collection.batch] : [])];
  if (options.profile === "share" && collection.diagnostics?.length) throw new ReportInputError("source-not-finalized", "未確定runは共有用レポートへ出力できません");
  if (options.profile === "share" && collection.batch?.summary?.workers.some(worker => worker.status === "completed" && worker.runUnavailable)) {
    throw new ReportInputError("source-not-finalized", "未確定runを含むbatchは共有用レポートへ出力できません");
  }
  if (!inputs.length || collection.explicitSourceCount < 1) throw new ReportInputError("source-missing", "レポート入力がありません");
  const sources = inputs.map(input => input.source).sort((a, b) => compare(a.id, b.id));
  const inputSourceIds = [...new Set(collection.explicitSourceIds)].sort(compare);
  if (inputSourceIds.length !== collection.explicitSourceCount || inputSourceIds.some(id => !sources.some(source => source.id === id))) {
    throw new ReportInputError("invalid-source-projection", "明示入力のsource IDと件数が一致しません");
  }
  const runs = collection.runs.map(input => input.run).filter((run): run is ReportRun => run !== undefined);
  const sessions = collection.sessions.map(input => input.summary).filter((session): session is ReportSession => session !== undefined);
  const incompleteRuns = (collection.diagnostics ?? []).map(input => input.summary).filter((run): run is ReportIncompleteRun => run !== undefined).sort((a, b) => compare(a.startedAt, b.startedAt) || compare(a.key, b.key));
  runs.sort((a, b) => rank(a.outcome) - rank(b.outcome) || compare(a.startedAt, b.startedAt) || compare(a.key, b.key));
  sessions.sort((a, b) => rank(a.technicalOutcome) - rank(b.technicalOutcome) || compare(a.startedAt, b.startedAt) || compare(a.key, b.key));
  const parentOutcomes = new Map<string, Outcome | null>([...runs.map(run => [run.sourceId, run.outcome] as const), ...sessions.map(session => [session.sourceId, session.technicalOutcome] as const)]);
  const evidence = options.evidence ?? prepareReportEvidenceLinks(collection);
  const projectEvidence = <T extends { id: string; evidenceIds: string[] }>(record: T): T => {
    const links = evidence.records.get(record.id);
    return { ...record, evidenceIds: [...(links?.ids ?? record.evidenceIds)], ...(links?.notes.length ? { evidenceNotes: links.notes } : {}) };
  };
  const rows = inputs.flatMap(input => input.rows).map(projectEvidence);
  const rowRank = (row: ReportRow) => rank(parentOutcomes.get(row.sourceId) ?? row.status);
  rows.sort((a, b) => rowRank(a) - rowRank(b) || compare(a.at ?? "~", b.at ?? "~") || compare(a.id, b.id));
  const timeline = inputs.flatMap(input => input.timeline).map(projectEvidence).sort((a, b) => compare(a.sourceId, b.sourceId) || a.sequence - b.sequence || compare(a.id, b.id));
  const issues = [...inputs.flatMap(input => input.issues), ...options.issues, ...evidence.issues].sort((a, b) => compare(a.sourceId ?? "", b.sourceId ?? "") || compare(a.code, b.code) || compare(a.message, b.message));
  if (issues.some(issue => issue.severity === "error")) throw new ReportInputError("invalid-projection", "未解決の入力errorがあるためレポートを生成できません");
  const media = options.media.map(item => ({ ...item, recordIds: [...item.recordIds] })).sort((a, b) => compare(a.id, b.id));
  const mediaById = new Map(media.map(item => [item.id, item]));
  const mediaRecords = new Map(media.map(item => [item.id, new Set(item.recordIds)]));
  for (const item of media) if (evidence.classifications.has(item.id) && item.classification !== evidence.classifications.get(item.id)) throw new ReportInputError("invalid-media-projection", "証跡参照と媒体の機密区分が一致しません");
  for (const [recordId, links] of evidence.records) for (const mediaId of links.ids) {
    const item = mediaById.get(mediaId);
    if (!item) throw new ReportInputError("invalid-media-projection", "項目が参照する媒体がありません");
    mediaRecords.get(mediaId)!.add(recordId);
    item.scope = "record";
  }
  for (const item of media) item.recordIds = [...mediaRecords.get(item.id)!].sort(compare);
  const candidates = new Map(inputs.flatMap(input => input.mediaCandidates).map(candidate => [candidate.id, candidate]));
  if (media.length !== candidates.size || new Set(media.map(item => item.id)).size !== media.length || media.some(item => candidates.get(item.id)?.sourceId !== item.sourceId || candidates.get(item.id)?.runKey !== item.runKey)) {
    throw new ReportInputError("invalid-media-projection", "媒体の採用・除外記録が入力と一致しません");
  }
  const outcomes: Record<Outcome, number> = { passed: 0, failed: 0, partial: 0, error: 0 };
  for (const run of runs) outcomes[run.outcome] += 1;
  const countKind = (kind: ReportRow["kind"]) => rows.filter(row => row.kind === kind).length;
  const counts = {
    sources: collection.explicitSourceCount, duplicateSources: collection.duplicateSources, runs: runs.length,
    ...(incompleteRuns.length ? { incompleteRuns: incompleteRuns.length } : {}),
    workerIncomplete: rows.filter(row => row.kind === "worker" && row.status === "error" && row.runKey === null).length,
    failures: countKind("failure"), warnings: countKind("warning"), findings: countKind("finding"),
    actions: runs.reduce((total, run) => total + (run.actionCount ?? 0), 0), plannedActions: runs.reduce((total, run) => total + (run.plannedActionCount ?? 0), 0),
    unknownActionRuns: runs.filter(run => run.actionCount === null).length,
    events: timeline.filter(event => event.kind !== "execution" && event.kind !== "planned-action").length,
    excludedMedia: media.filter(item => item.verification === "excluded").length, outcomes,
  };
  if (counts.sources > REPORT_LIMITS.sources || counts.runs > REPORT_LIMITS.runs || timeline.length > REPORT_LIMITS.actionsAndEvents || counts.failures + counts.warnings + counts.findings > REPORT_LIMITS.failuresAndFindings) {
    throw new ReportInputError("record-limit", "レポートの表示件数上限を超えています");
  }
  const view: ReportView = {
    schemaVersion: "lakda/report-view/v1", reportId: options.reportId, generatedAt: reportTimestamp(options.generatedAt), producerVersion: options.producerVersion, profile: options.profile,
    generationStatus: counts.unknownActionRuns || sources.some(source => source.status !== "verified") || issues.some(issue => issue.severity === "warning") ? "degraded" : "ready",
    classification: maximumClassification([...sources.map(source => source.classification), ...media.filter(item => item.path !== null).map(item => item.classification)]),
    timeZone: "UTC", inputSourceIds, sources, runs, sessions, rows, timeline, media, issues, counts,
    ...(collection.batch?.summary ? { batches: [collection.batch.summary] } : {}),
    ...(incompleteRuns.length ? { incompleteRuns } : {}),
  };
  assertReportSchema("view", view);
  const serialized = serializeReportData(view);
  if (Buffer.byteLength(serialized, "utf8") > REPORT_LIMITS.viewBytes) throw new ReportInputError("view-byte-limit", "表示データの容量上限を超えています");
  if (findSensitive(serialized).length) throw new ReportInputError("sensitive-projection", "表示データの秘密値検査に失敗しました");
  assertReportViewSemantics(view);
  return view;
}
