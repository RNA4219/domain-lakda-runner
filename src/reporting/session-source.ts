import { sha256 } from "../core/redaction.js";
import { hateArtifact } from "../runs/catalog-values.js";
import { cleanReportText, maximumClassification } from "./projection-values.js";
import { readSessionFindings, readSessionRunReferences, type SessionRunReference } from "./session-records.js";
import type { ReportSessionSnapshot } from "./session-snapshot.js";
import { reportTimestamp } from "./source-values.js";
import { readSourceOracles, type ReportEvidence } from "./evidence-history.js";
import type { ReportMediaCandidate } from "./run-source.js";
import type { Classification, ReportIssue, ReportRow, ReportSession, ReportSource, ReportTimeline } from "./types.js";

export type ReportSessionInput = ReportSessionSnapshot & {
  source: ReportSource; summary?: ReportSession; runReferences: SessionRunReference[];
  rows: ReportRow[]; timeline: ReportTimeline[]; issues: ReportIssue[]; mediaCandidates: ReportMediaCandidate[];
  findingEvidence: Map<string, string[]>;
  findingOracles?: Map<string, string[]>;
  evidence?: ReportEvidence;
};

export function projectReportSession(input: ReportSessionSnapshot): ReportSessionInput {
  const { snapshot, session, charter, report } = input;
  const runReferences = readSessionRunReferences(input);
  const findings = readSessionFindings(input);
  const key = "session:" + sha256(session.sessionId).slice(0, 24);
  const source: ReportSource = { id: key, kind: "session", status: "verified", manifestSha256: snapshot.manifestSha256, eventHeadDigest: session.eventHeadDigest ?? null, producerRevision: String(snapshot.manifest.commit_sha), targetRevision: cleanReportText(charter.targetRevision), classification: input.classification };
  const rows: ReportRow[] = [];
  const timeline: ReportTimeline[] = [];
  const issues: ReportIssue[] = [];
  const mediaCandidates: ReportMediaCandidate[] = [];
  const findingEvidence = new Map<string, string[]>();
  const findingOracles = new Map<string, string[]>();
  const result: ReportSessionInput = { ...input, source, runReferences, rows, timeline, issues, mediaCandidates, findingEvidence, findingOracles };
  if (input.classification === "restricted") {
    source.id = "restricted:" + sha256(snapshot.manifestSha256).slice(0, 24);
    source.status = "restricted";
    source.producerRevision = null;
    source.targetRevision = null;
    source.eventHeadDigest = null;
    issues.push({ code: "restricted-source", severity: "warning", sourceId: source.id, message: "取扱い制限により入力の内容を表示しません" });
    return result;
  }
  result.evidence = { records: new Map(), oracles: readSourceOracles(snapshot, source, issues) };
  const start = reportTimestamp(session.createdAt);
  const end = reportTimestamp(session.updatedAt);
  const duration = Date.parse(end) - Date.parse(start);
  const producer = snapshot.artifacts.find(artifact => artifact.path === "session.json")?.lakda as { producerVersion?: unknown } | undefined;
  result.summary = {
    key, sourceId: key, sessionId: cleanReportText(session.sessionId), status: session.status as ReportSession["status"],
    technicalOutcome: session.technicalOutcome ?? null, terminationReason: session.terminationReason ? cleanReportText(session.terminationReason) : null,
    startedAt: start, endedAt: end, durationMs: duration >= 0 ? duration : null, activeDurationMs: session.activeDurationMs ?? null,
    platform: charter.platform, executionMode: charter.executionMode, seed: charter.seed, producerVersion: typeof producer?.producerVersion === "string" ? cleanReportText(producer.producerVersion) : null,
    producerRevision: source.producerRevision!, targetRevision: source.targetRevision!, acceptanceStatus: report.acceptanceStatus ?? null, actionCount: session.actionCount, runKeys: [],
  };
  rows.push({ id: key, sourceId: key, runKey: null, kind: "session", status: session.technicalOutcome ?? session.status, severity: null, title: result.summary.sessionId, message: result.summary.terminationReason ?? "停止理由は未取得です", at: end, ruleId: null, relatedIds: [], evidenceIds: [] });
  if (input.nativeEvidence && !input.nativeEvidence.complete) {
    const message = "native操作の予定が未完了、または応答を確認できません。操作成功や実機受入を示しません";
    issues.push({ code: "native-evidence-incomplete", severity: "warning", sourceId: key, message });
    rows.push({ id: key + ":native-incomplete", sourceId: key, runKey: null, kind: "warning", status: "unknown", severity: "warning",
      title: "native操作の結果未確定", message, at: end, ruleId: null, relatedIds: [], evidenceIds: [] });
  }
  const findingArtifact = snapshot.artifacts.find(artifact => artifact.path === "findings.jsonl")!;
  if (findingArtifact.classification === "restricted") issues.push({ code: "restricted-input", severity: "warning", sourceId: key, message: "取扱い制限のあるfinding記録を除外しました" });
  else {
    hateArtifact(findingArtifact, 0);
    source.classification = maximumClassification([source.classification, findingArtifact.classification as Classification]);
    for (const finding of findings) {
      const id = key + ":finding:" + sha256(finding.findingId).slice(0, 24);
      rows.push({ id, sourceId: key, runKey: null, kind: "finding", status: finding.status, severity: finding.severity, title: cleanReportText(finding.findingId), message: cleanReportText(finding.message), at: reportTimestamp(finding.observedAt), ruleId: finding.kind, relatedIds: finding.oracleRefs.map(cleanReportText), evidenceIds: [] });
      findingEvidence.set(id, finding.evidenceRefs);
      findingOracles.set(id, finding.oracleRefs);
    }
  }
  for (const event of input.events) {
    const finding = typeof event.payload?.findingId === "string" ? key + ":finding:" + sha256(event.payload.findingId).slice(0, 24) : undefined;
    timeline.push({ id: key + ":event:" + event.sequence, sourceId: key, runKey: null, sequence: event.sequence!, at: reportTimestamp(event.at), kind: event.type, label: event.type, relatedIds: finding && rows.some(row => row.id === finding) ? [finding] : [], evidenceIds: [] });
  }
  for (const message of new Set([...report.blockers, ...report.capture.failures])) {
    rows.push({ id: key + ":warning:" + sha256(message).slice(0, 24), sourceId: key, runKey: null, kind: "warning", status: "recorded-blocker", severity: "warning", title: "sessionの停止・capture情報", message: cleanReportText(message), at: end, ruleId: null, relatedIds: [], evidenceIds: [] });
  }
  for (const artifact of snapshot.artifacts) {
    if (!["screenshot", "video", "trace"].includes(String(artifact.kind)) && !/\.(png|jpe?g|webp|gif|webm|mp4|svg)$/i.test(artifact.path)) continue;
    mediaCandidates.push({ id: "media:" + sha256(key + "\0" + artifact.path), sourceId: key, runKey: null, artifact, snapshot: snapshot.snapshots.get(artifact.path)!, root: snapshot.root });
  }
  return result;
}
