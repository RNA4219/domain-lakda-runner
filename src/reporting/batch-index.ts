import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { aggregateOutcomes } from "../core/outcome.js";
import type { ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { assertPortableArtifactRef, assertSafePublicValue, isContained } from "../runs/catalog-values.js";
import { assertReportSchema, ReportInputError } from "./contracts.js";
import { hasRunManifest } from "./incomplete-run.js";
import { reportTimestamp } from "./source-values.js";
import type { BatchIndexInput, BatchSourcesDocument } from "./batch-types.js";

export function assertBatchDocument(value: unknown): asserts value is BatchSourcesDocument {
  assertReportSchema("batch-sources", value);
  const data = value as BatchSourcesDocument;
  const invalid = () => new ReportInputError("invalid-batch", "batchのworker構成・件数・結果が一致しません");
  assertSafePublicValue(data.batchId, "batch ID");
  if (reportTimestamp(data.recordedAt) !== data.recordedAt || data.workers.length !== data.requestedWorkers) throw invalid();
  const completed = data.workers.filter(worker => worker.status === "completed");
  if (completed.length !== data.completedWorkers) throw invalid();
  const positions = new Set(data.workers.map(worker => worker.workerIndex));
  if (positions.size !== data.requestedWorkers || Array.from({ length: data.requestedWorkers }, (_, index) => index).some(index => !positions.has(index))) throw invalid();
  const outcome = aggregateOutcomes(data.workers.map(worker => worker.status === "completed" ? worker.run.outcome : "error"));
  const exit = (result: string) => result === "passed" ? 0 : result === "error" ? 1 : 2;
  if (data.outcome !== outcome || data.exitCode !== exit(outcome)) throw invalid();
  const ids = new Set<string>(); const paths = new Set<string>();
  for (const worker of completed) {
    const run = worker.run;
    assertSafePublicValue(run.runId, "batch run ID");
    assertPortableArtifactRef(run.path);
    const key = run.runId + ":" + run.attempt;
    if (ids.has(key) || paths.has(run.path) || run.exitCode !== exit(run.outcome)) throw invalid();
    if (run.manifestSha256 === null && (run.outcome !== "error" || run.terminationReason !== "artifact_failure")) throw invalid();
    ids.add(key); paths.add(run.path);
  }
}

/** Absence is a distinct, minimal diagnostic; an existing bad manifest cannot take this route. */
export async function assertBatchManifestAbsent(root: string, signal?: AbortSignal): Promise<void> {
  if (!await hasRunManifest(root, signal)) return;
  throw new ReportInputError("batch-manifest-conflict", "未成立と記録されたrunにmanifestが存在します。入力を検証してください");
}

export async function resolveBatchIndex(value: unknown, snapshot: ArtifactSnapshot, signal?: AbortSignal): Promise<BatchIndexInput> {
  assertBatchDocument(value);
  const directories = new Map<number, string>();
  const unfinalized: BatchIndexInput["unfinalized"] = [];
  const completed = value.workers.filter(worker => worker.status === "completed");
  // No run directory is inferred or required for workers whose execution never returned a run.
  const root = completed.length ? await realpath(resolve(dirname(snapshot.path), value.root)) : undefined;
  if (root && !(await lstat(root)).isDirectory()) throw new ReportInputError("source-missing", "batchの保存rootがdirectoryではありません");
  for (const worker of completed) {
    signal?.throwIfAborted();
    const actual = await realpath(resolve(root!, worker.run.path));
    const stat = await lstat(actual);
    if (!stat.isDirectory() || !isContained(root!, actual)) throw new ReportInputError("source-escape", "batchのrun参照が保存root外です");
    directories.set(worker.workerIndex, actual);
    if (worker.run.manifestSha256 === null) {
      await assertBatchManifestAbsent(actual, signal);
      unfinalized.push({ root: actual, dev: stat.dev, ino: stat.ino });
    }
  }
  return { document: value, directories, unfinalized, snapshot: { path: snapshot.path, size: snapshot.size, sha256: snapshot.sha256 } };
}
