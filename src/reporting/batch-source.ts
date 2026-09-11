import { sha256 } from "../core/redaction.js";
import { ReportInputError } from "./contracts.js";
import { cleanReportText, maximumClassification } from "./projection-values.js";
import type { BatchIndexInput } from "./batch-types.js";
import type { ReportRunInput } from "./run-source.js";
import type { ReportBatch, ReportIssue, ReportRow, ReportSource } from "./types.js";

export type ReportBatchInput = {
  source: ReportSource; summary?: ReportBatch; rows: ReportRow[]; issues: ReportIssue[];
  timeline: []; mediaCandidates: [];
};

export function projectReportBatch(index: BatchIndexInput, runs: ReportRunInput[]): ReportBatchInput {
  const data = index.document;
  const bound = new Map<number, ReportRunInput>();
  for (const worker of data.workers) {
    if (worker.status !== "completed" || worker.run.manifestSha256 === null) continue;
    const input = runs.find(input => input.snapshot.root === index.directories.get(worker.workerIndex));
    const expected = worker.run;
    const metadata = input?.metadata;
    if (!input || input.snapshot.manifestSha256 !== expected.manifestSha256 ||
      metadata?.batchId !== data.batchId || metadata.workerIndex !== worker.workerIndex || metadata.seed !== worker.seed ||
      metadata.runId !== expected.runId || metadata.attempt !== expected.attempt || metadata.outcome !== expected.outcome ||
      metadata.exitCode !== expected.exitCode || metadata.terminationReason !== expected.terminationReason) {
      throw new ReportInputError("batch-run-binding", "batchのworker結果と保存済みrunが一致しません");
    }
    bound.set(worker.workerIndex, input);
  }
  const classification = maximumClassification([data.classification, ...runs.map(run => run.source.classification)]);
  const source: ReportSource = {
    id: "batch:" + sha256(data.batchId).slice(0, 24), kind: "batch", status: "verified",
    manifestSha256: null, eventHeadDigest: null, indexSha256: index.snapshot.sha256,
    producerRevision: null, targetRevision: null, classification,
  };
  const result: ReportBatchInput = { source, rows: [], issues: [], timeline: [], mediaCandidates: [] };
  if (classification === "restricted") {
    source.id = "restricted:" + sha256(index.snapshot.sha256).slice(0, 24); source.status = "restricted";
    result.issues.push({ code: "restricted-source", severity: "warning", sourceId: source.id, message: "取扱い制限によりbatchの内容を表示しません" });
    return result;
  }
  const workers: ReportBatch["workers"] = [];
  for (const worker of [...data.workers].sort((a, b) => a.workerIndex - b.workerIndex)) {
    const run = bound.get(worker.workerIndex)?.run;
    const id = source.id + ":worker:" + worker.workerIndex;
    workers.push({ id, workerIndex: worker.workerIndex, seed: worker.seed, status: worker.status, runKey: run?.key ?? null, runUnavailable: !run });
    const unavailable = worker.status === "error" ? "workerの実行が完了しませんでした" : "runの確定済み結果を取得できません";
    result.rows.push({ id, sourceId: source.id, runKey: run?.key ?? null, kind: "worker", status: run?.outcome ?? "error", severity: null,
      title: "worker " + worker.workerIndex, message: cleanReportText(worker.status === "error" ? worker.error.name + ": " + worker.error.message : run ? "run結果: " + run.outcome : unavailable),
      at: run?.endedAt ?? null, ruleId: null, relatedIds: [data.batchId], evidenceIds: [] });
    if (!run) result.issues.push({ code: worker.status === "error" ? "worker-incomplete" : "worker-run-unfinalized", severity: "warning", sourceId: source.id, message: "worker " + worker.workerIndex + ": " + unavailable });
  }
  result.summary = { sourceId: source.id, batchId: data.batchId, recordedAt: data.recordedAt, outcome: data.outcome, exitCode: data.exitCode, requestedWorkers: data.requestedWorkers, completedWorkers: data.completedWorkers, workers };
  return result;
}
