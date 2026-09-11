import { readManifestSnapshot, type ManifestArtifact, type ManifestReadOptions, type ManifestSnapshot } from "../runs/manifest-snapshot.js";
import type { ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { hateArtifact, integerValue, object, parseRunSummary, stringValue } from "../runs/catalog-values.js";
import { sha256 } from "../core/redaction.js";
import { canonicalJson } from "../core/plan.js";
import { assertRunStartRecord, RUN_START_REF } from "../core/run-start.js";
import { ReportInputError, REPORT_LIMITS } from "./contracts.js";
import { cleanReportText, maximumClassification } from "./projection-values.js";
import { projectRunHistory } from "./run-history.js";
import { projectAttestationResults } from "./attestation-results.js";
import { readSourceOracles, type ReportEvidence } from "./evidence-history.js";
import { reportTimestamp } from "./source-values.js";
import type { Classification, ReportIssue, ReportRow, ReportRun, ReportSource, ReportTimeline } from "./types.js";

export type ReportMediaCandidate = { id: string; sourceId: string; runKey: string | null; artifact: ManifestArtifact; snapshot: ArtifactSnapshot; root: string };
export type ReportRunInput = {
  snapshot: ManifestSnapshot; metadata: Record<string, unknown>; source: ReportSource; run?: ReportRun;
  rows: ReportRow[]; timeline: ReportTimeline[]; issues: ReportIssue[]; mediaCandidates: ReportMediaCandidate[];
  evidence?: ReportEvidence;
};

export async function loadReportRun(runDir: string, options: Pick<ManifestReadOptions, "signal" | "textLimit" | "artifactLimit"> = {}): Promise<ReportRunInput> {
  const snapshot = await readManifestSnapshot(runDir, { textLimit: REPORT_LIMITS.textBytes, artifactLimit: REPORT_LIMITS.artifactBytes, ...options, retain: ref => /\.(json|jsonl)$/i.test(ref) });
  const byPath = new Map(snapshot.artifacts.map(artifact => [artifact.path, artifact]));
  const decode = (ref: string): unknown => {
    const bytes = snapshot.snapshots.get(ref)?.bytes;
    if (!bytes) throw new ReportInputError("source-incomplete", "必須の保存記録がHATE manifestにありません");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new ReportInputError("invalid-json", "保存記録が有効なUTF-8 JSONではありません"); }
  };
  const metadata = object(decode("run-metadata.json"), "run metadata");
  const summary = parseRunSummary(metadata, "source");
  const attempt = integerValue(metadata.attempt, "run attempt", 1);
  if (snapshot.manifest.run_id !== summary.runId || snapshot.manifest.run_attempt !== attempt || snapshot.manifest.commit_sha !== summary.commitSha) {
    throw new ReportInputError("run-binding-mismatch", "run metadataとHATE manifestのbindingが不一致です");
  }
  if (!["smoke", "seeded-random", "regression-replay", "llm-explore", "adaptive-explore"].includes(summary.mode)) throw new ReportInputError("unsupported-mode", "未対応のrun modeです");
  const key = "run:" + summary.runId + ":" + attempt;
  const policy = metadata.artifactPolicy ? object(metadata.artifactPolicy, "artifact policy") : {};
  if (byPath.has(RUN_START_REF)) {
    const start = decode(RUN_START_REF); assertRunStartRecord(start);
    const same = (["runId", "attempt", "startedAt", "mode", "seed", "workerIndex", "batchId", "producerVersion"] as const).every(field => start[field] === metadata[field]);
    if (!same || start.producerRevision !== metadata.commitSha || start.classification !== policy.classification) throw new ReportInputError("run-start-binding", "開始記録と確定済みrun metadataが一致しません");
  }
  const classification = maximumClassification([byPath.get("run-metadata.json")!.classification as Classification, ...(byPath.has(RUN_START_REF) ? [byPath.get(RUN_START_REF)!.classification as Classification] : []), ...(policy.classification ? [policy.classification as Classification] : [])]);
  const source: ReportSource = { id: key, kind: "run", status: "verified", manifestSha256: snapshot.manifestSha256, eventHeadDigest: null, producerRevision: summary.commitSha, targetRevision: null, classification };
  const issues: ReportIssue[] = [];
  const rows: ReportRow[] = [];
  const mediaCandidates: ReportMediaCandidate[] = [];
  if (classification === "restricted") {
    source.id = "restricted:" + sha256(snapshot.manifestSha256).slice(0, 24);
    source.status = "restricted";
    source.producerRevision = null;
    issues.push({ code: "restricted-source", severity: "warning", sourceId: source.id, message: "取扱い制限により入力の内容を表示しません" });
    return { snapshot, metadata, source, rows, timeline: [], issues, mediaCandidates };
  }
  const json = (ref: string): unknown | undefined => {
    const artifact = byPath.get(ref);
    if (!artifact) return undefined;
    if (artifact.classification === "restricted") {
      issues.push({ code: "restricted-input", severity: "warning", sourceId: key, message: "取扱い制限のある記録を除外しました" });
      return undefined;
    }
    hateArtifact(artifact, 0);
    source.classification = maximumClassification([source.classification, artifact.classification as Classification]);
    return decode(ref);
  };
  json("run-metadata.json");
  projectAttestationResults(snapshot, metadata, source, issues);
  const history = projectRunHistory(key, summary.mode, json, issues);
  if (summary.mode === "adaptive-explore") history.evidence.oracles.push(...readSourceOracles(snapshot, source, issues));
  const startedAt = reportTimestamp(summary.startedAt);
  const endedAt = reportTimestamp(summary.endedAt);
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  const run: ReportRun = { key, sourceId: key, runId: summary.runId, attempt, mode: summary.mode, platform: summary.mode === "adaptive-explore" ? null : "pc-web", executionMode: null, outcome: summary.outcome, terminationReason: cleanReportText(summary.terminationReason), startedAt, endedAt, durationMs: duration >= 0 ? duration : null, seed: summary.seed, producerVersion: summary.producerVersion, producerRevision: summary.commitSha, targetRevision: null, acceptanceStatus: null, actionCount: history.actionCount, plannedActionCount: history.plannedActionCount, coverage: history.coverage };
  rows.push({ id: key, sourceId: key, runKey: key, kind: "run", status: run.outcome, severity: null, title: run.runId, message: run.terminationReason, at: run.endedAt, ruleId: null, relatedIds: [], evidenceIds: [] });
  const failureValue = json("failure-report.json");
  if (failureValue === undefined) issues.push({ code: "failures-unavailable", severity: "warning", sourceId: key, message: "failure記録が未取得です" });
  else {
    const failures = object(failureValue, "failure report").failures;
    if (!Array.isArray(failures)) throw new ReportInputError("invalid-failures", "failure記録が配列ではありません");
    const ids = new Map<string, string>();
    for (const raw of failures) {
      const failure = object(raw, "failure");
      const id = stringValue(failure.failureId, "failure ID");
      const record = canonicalJson(failure);
      if (ids.has(id)) {
        if (ids.get(id) !== record) throw new ReportInputError("conflicting-failure", "同じfailure IDの内容が競合しています");
        continue;
      }
      ids.set(id, record);
      if (ids.size > REPORT_LIMITS.failuresAndFindings) throw new ReportInputError("row-limit", "failure記録の表示上限を超えています");
      if (failure.severity !== "failure" && failure.severity !== "warning") throw new ReportInputError("invalid-failures", "failure severityが不正です");
      const ruleId = cleanReportText(stringValue(failure.ruleId, "failure rule"));
      rows.push({ id: key + ":failure:" + sha256(id).slice(0, 24), sourceId: key, runKey: key, kind: failure.severity, status: failure.severity, severity: failure.severity, title: cleanReportText(id), message: cleanReportText(stringValue(failure.message, "failure message")), at: null, ruleId, relatedIds: [], evidenceIds: [] });
    }
  }
  for (const artifact of snapshot.artifacts) {
    if (!["screenshot", "video", "trace"].includes(String(artifact.kind)) && !/\.(png|jpe?g|webp|gif|webm|mp4|svg)$/i.test(artifact.path)) continue;
    mediaCandidates.push({ id: "media:" + sha256(key + "\0" + artifact.path), sourceId: key, runKey: key, artifact, snapshot: snapshot.snapshots.get(artifact.path)!, root: snapshot.root });
  }
  return { snapshot, metadata, source, run, rows, timeline: history.timeline, issues, mediaCandidates, evidence: history.evidence };
}
