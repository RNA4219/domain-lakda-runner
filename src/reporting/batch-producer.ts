import { lstat, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { RunBatchResult } from "../core/types.js";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { isContained } from "../runs/catalog-values.js";
import { MANIFEST_REF } from "../runs/manifest-snapshot.js";
import { assertBatchDocument } from "./batch-index.js";
import type { BatchSourcesDocument, BatchWorker } from "./batch-types.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { cleanReportText } from "./projection-values.js";
import type { Classification } from "./types.js";
import { canonicalFutureDirectory } from "./output-transaction.js";

/** Project the actual returned worker results; neither directory names nor previous batches supply IDs. */
export async function createBatchSourcesDocument(batch: RunBatchResult, root: string, classification: Classification, signal?: AbortSignal): Promise<BatchSourcesDocument> {
  if (batch.schemaVersion !== "lakda/run-batch/v1" || batch.workerResults.length < 1 || batch.workerResults.length > 4) throw new ReportInputError("invalid-batch", "batchのworker構成が不正です");
  const workers: BatchWorker[] = [];
  for (const entry of batch.workerResults) {
    signal?.throwIfAborted();
    const common = { workerIndex: entry.workerIndex, seed: entry.seed };
    if (entry.status === "error") {
      workers.push({ ...common, status: "error", error: { name: cleanReportText(entry.error.name), message: cleanReportText(entry.error.message) } });
      continue;
    }
    const result = entry.result;
    if (!result.actionSequencePath || result.batchId !== batch.batchId || result.workerIndex !== entry.workerIndex) throw new ReportInputError("batch-run-binding", "worker結果のrun参照が一致しません");
    const directory = await realpath(dirname(resolve(result.actionSequencePath)));
    if (!isContained(root, directory) || directory === root) throw new ReportInputError("source-escape", "workerのrunが保存root外です");
    const manifest = join(directory, MANIFEST_REF);
    if (result.artifactManifestPath && join(await canonicalFutureDirectory(dirname(resolve(result.artifactManifestPath))), result.artifactManifestPath.split(/[\\/]/).at(-1)!) !== manifest) throw new ReportInputError("batch-run-binding", "workerのmanifest参照が一致しません");
    let present = true;
    try { await lstat(manifest); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") present = false; else throw error; }
    const manifestSha256 = present ? (await readArtifactSnapshot(directory, MANIFEST_REF, { maxBytes: REPORT_LIMITS.textBytes, signal })).sha256 : null;
    workers.push({ ...common, status: "completed", run: { runId: result.runId, attempt: result.attempt, path: relative(root, directory).split(sep).join("/"), manifestSha256, outcome: result.outcome, exitCode: result.exitCode, terminationReason: result.terminationReason } });
  }
  const document: BatchSourcesDocument = { schemaVersion: "lakda/report-batch-sources/v1", batchId: batch.batchId, recordedAt: new Date().toISOString(), root, classification, outcome: batch.outcome, exitCode: batch.exitCode, requestedWorkers: batch.requestedWorkers, completedWorkers: batch.completedWorkers, workers };
  assertBatchDocument(document);
  return document;
}
