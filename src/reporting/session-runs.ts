import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { explorationRunRoot } from "../exploration/session.js";
import { isContained } from "../runs/catalog-values.js";
import { ReportInputError } from "./contracts.js";
import { maximumClassification } from "./projection-values.js";
import type { ReportRunInput } from "./run-source.js";
import type { SessionRunReference } from "./session-records.js";
import type { ReportSessionInput } from "./session-source.js";

export async function resolveSessionRunDirectory(input: ReportSessionInput, ref: SessionRunReference): Promise<string> {
  if (!ref.relativeDir) throw new ReportInputError("source-incomplete", "参照runの保存先がありません。明示source集合へrunを追加してください");
  try {
    const root = await realpath(explorationRunRoot(input.charter));
    const candidate = await realpath(resolve(root, ref.relativeDir));
    if (!isContained(root, candidate) || root === candidate) throw new Error("outside run root");
    return candidate;
  } catch { throw new ReportInputError("source-incomplete", "参照runの保存先が存在しないか、保存rootの外にあります"); }
}

export function bindSessionRun(input: ReportSessionInput, ref: SessionRunReference, run: ReportRunInput): void {
  const fail = () => new ReportInputError("session-run-binding-mismatch", "sessionの参照runと保存済みrunのbindingが不一致です");
  if (run.snapshot.manifest.run_id !== ref.runId || run.snapshot.manifest.run_attempt !== ref.attempt || run.snapshot.manifestSha256 !== ref.manifestSha256 || run.metadata.mode !== "adaptive-explore") throw fail();
  if (!input.summary) return;
  input.summary.runKeys.push(run.source.id);
  const row = input.rows.find(row => row.id === input.source.id);
  row?.relatedIds.push(run.source.id);
  for (const event of input.events) {
    if (event.payload?.runId === ref.runId) {
      const projected = input.timeline.find(item => item.sequence === event.sequence);
      if (projected) projected.runKey = run.run?.key ?? null;
    }
  }
  if (!run.run) return;
  for (const field of ["platform", "executionMode", "targetRevision", "acceptanceStatus"] as const) {
    const value = input.summary[field];
    if (run.run[field] !== null && run.run[field] !== value) throw fail();
    run.run[field] = value;
  }
  run.source.targetRevision = run.run.targetRevision;
  run.source.classification = maximumClassification([run.source.classification, input.source.classification]);
}
