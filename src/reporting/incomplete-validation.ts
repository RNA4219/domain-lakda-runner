import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { reportTimestamp } from "./source-values.js";
import type { ReportView } from "./types.js";

export function assertIncompleteRunSemantics(view: ReportView): void {
  const require = (condition: boolean) => { if (!condition) throw new ReportInputError("inconsistent-incomplete-run", "未確定runの開始記録・件数・状態が一致しません"); };
  const summaries = view.incompleteRuns ?? [];
  const sources = view.sources.filter(source => source.startRecordSha256 !== undefined);
  require((view.counts.incompleteRuns ?? 0) === summaries.length);
  require(view.sources.filter(source => source.kind === "run").length <= REPORT_LIMITS.runs);
  require(view.sources.filter(source => source.kind === "run" && source.status === "unverified").every(source => source.startRecordSha256 !== undefined));
  require(sources.length === 0 || view.profile === "local");
  require(new Set(summaries.map(summary => summary.sourceId)).size === summaries.length);
  require(sources.filter(source => source.status !== "restricted").length === summaries.length);
  for (const source of sources) {
    require(source.kind === "run" && source.status !== "verified" && source.manifestSha256 === null && source.eventHeadDigest === null && source.targetRevision === null && source.indexSha256 === undefined);
    require(view.inputSourceIds.includes(source.id));
    require(!view.runs.some(run => run.sourceId === source.id) && !view.timeline.some(event => event.sourceId === source.id) && !view.media.some(item => item.sourceId === source.id));
    if (source.status === "restricted") {
      require(source.producerRevision === null && !summaries.some(summary => summary.sourceId === source.id) && !view.rows.some(row => row.sourceId === source.id));
      continue;
    }
    const summary = summaries.find(summary => summary.sourceId === source.id);
    require(summary !== undefined);
    require(summary!.key === source.id && source.id === "run:" + summary!.runId + ":" + summary!.attempt && summary!.producerRevision === source.producerRevision);
    require(reportTimestamp(summary!.startedAt) === summary!.startedAt);
    const rows = view.rows.filter(row => row.sourceId === source.id);
    require(rows.length === 1);
    const row = rows[0];
    require(row.id === source.id && row.kind === "run" && row.runKey === null && row.status === "unfinalized" && row.at === summary!.startedAt && row.title === summary!.runId && row.ruleId === null && row.severity === null && row.evidenceIds.length === 0 && row.relatedIds.length === 0);
    require(view.issues.some(issue => issue.sourceId === source.id && issue.code === "run-unfinalized" && issue.severity === "warning"));
  }
}
