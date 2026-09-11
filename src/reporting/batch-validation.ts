import { aggregateOutcomes } from "../core/outcome.js";
import { sha256 } from "../core/redaction.js";
import { ReportInputError } from "./contracts.js";
import { reportTimestamp } from "./source-values.js";
import type { ReportView } from "./types.js";

export function assertReportBatchSemantics(view: ReportView): void {
  const require = (condition: boolean) => { if (!condition) throw new ReportInputError("inconsistent-batch", "batchの構成・worker結果・入力参照が一致しません"); };
  const sources = view.sources.filter(source => source.kind === "batch");
  require(sources.length <= 1);
  for (const source of view.sources) {
    require(source.kind === "batch" ? source.indexSha256 !== undefined && source.manifestSha256 === null && source.eventHeadDigest === null && source.producerRevision === null && source.targetRevision === null : source.indexSha256 === undefined);
  }
  const summaries = view.batches ?? [];
  const rows = view.rows.filter(row => row.kind === "worker");
  if (!sources.length) { require(summaries.length === 0 && rows.length === 0); return; }
  const source = sources[0];
  require(view.inputSourceIds.length === 1 && view.inputSourceIds[0] === source.id && view.sessions.length === 0);
  if (source.status === "restricted") {
    require(summaries.length === 0 && view.sources.length === 1 && view.runs.length === 0 && view.rows.length === 0 && view.timeline.length === 0 && view.media.length === 0);
    return;
  }
  require(source.status === "verified" && summaries.length === 1);
  const batch = summaries[0];
  require(batch.sourceId === source.id && source.id === "batch:" + sha256(batch.batchId).slice(0, 24));
  require(reportTimestamp(batch.recordedAt) === batch.recordedAt);
  require(batch.workers.length === batch.requestedWorkers && rows.length === batch.requestedWorkers);
  require(batch.completedWorkers === batch.workers.filter(worker => worker.status === "completed").length);
  const positions = new Set(batch.workers.map(worker => worker.workerIndex));
  require(positions.size === batch.requestedWorkers && Array.from({ length: batch.requestedWorkers }, (_, index) => index).every(index => positions.has(index)));
  const runKeys = new Set<string>();
  const outcomes = batch.workers.map(worker => {
    const row = rows.find(row => row.id === worker.id);
    const run = view.runs.find(run => run.key === worker.runKey);
    require(worker.id === source.id + ":worker:" + worker.workerIndex && row !== undefined);
    require(row?.sourceId === source.id && row.runKey === worker.runKey && row.relatedIds.length === 1 && row.relatedIds[0] === batch.batchId);
    require(worker.runUnavailable === (worker.runKey === null));
    if (worker.runUnavailable) {
      require(row?.status === "error" && row.at === null);
      require(worker.status === "error" || view.profile === "local");
      const code = worker.status === "error" ? "worker-incomplete" : "worker-run-unfinalized";
      require(view.issues.some(issue => issue.sourceId === source.id && issue.code === code && issue.severity === "warning"));
      return "error" as const;
    }
    require(worker.status === "completed" && run !== undefined && run?.seed === worker.seed && row?.status === run?.outcome && row?.at === run?.endedAt);
    require(!runKeys.has(worker.runKey!)); runKeys.add(worker.runKey!);
    return run!.outcome;
  });
  require(runKeys.size === view.runs.length && view.sources.length === view.runs.length + 1);
  const outcome = aggregateOutcomes(outcomes);
  require(batch.outcome === outcome && batch.exitCode === (outcome === "passed" ? 0 : outcome === "error" ? 1 : 2));
}
