import { randomUUID } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { RunBatchResult } from "../core/types.js";
import { isContained } from "../runs/catalog-values.js";
import { createBatchSourcesDocument } from "./batch-producer.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { canonicalFutureDirectory, reserveReportOutput } from "./output-transaction.js";
import { serializeReportData } from "./projection-values.js";
import { loadReportSourceCollection } from "./source-collection.js";
import { resolveReportSources, type ReportSourceSelector } from "./source-index.js";
import { verifyReportSourceIndex, verifyReportSourcesUnchanged } from "./source-verifier.js";
import type { Classification } from "./types.js";

type BatchSaveOptions = { runOutputRoot: string; outputRoot: string; classification: Classification; signal?: AbortSignal };

async function failedRunRoot(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "") || dirname(path) === path) throw error;
    return join(await failedRunRoot(dirname(path)), basename(path));
  }
}

/** Private input is published separately from portable output and is retained for regeneration. */
export async function saveReportBatchSources(batch: RunBatchResult, options: BatchSaveOptions): Promise<ReportSourceSelector> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const resolveRoot = () => (batch.completedWorkers ? canonicalFutureDirectory : failedRunRoot)(resolve(options.runOutputRoot));
  const root = await resolveRoot();
  const output = join(await canonicalFutureDirectory(resolve(options.outputRoot)), "sources-" + randomUUID());
  if (isContained(root, output) || isContained(output, root)) throw new ReportInputError("output-overlap", "private indexの保存先がrun入力と重なっています");
  const document = await createBatchSourcesDocument(batch, root, options.classification, signal);
  const text = serializeReportData(document) + "\n";
  if (Buffer.byteLength(text) > REPORT_LIMITS.textBytes) throw new ReportInputError("input-byte-limit", "batch入力の容量上限を超えています");
  const reserved = await reserveReportOutput(output, document.completedWorkers ? [root] : [], signal);
  try {
    signal?.throwIfAborted();
    const file = await open(join(reserved.stage, "sources.json"), "wx");
    try { await file.writeFile(text, { encoding: "utf8", signal }); }
    finally { await file.close(); }
    const selection = await resolveReportSources({ sources: join(reserved.stage, "sources.json") }, signal);
    const collection = await loadReportSourceCollection(selection, signal);
    await verifyReportSourceIndex(selection, signal);
    await verifyReportSourcesUnchanged(collection, signal);
    if (await resolveRoot() !== root) throw new ReportInputError("source-not-finalized", "run保存rootが変更されています");
    await reserved.publish();
    return { sources: join(reserved.output, "sources.json") };
  } finally { await reserved.dispose(); }
}
