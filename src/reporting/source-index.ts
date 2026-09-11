import { realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { readArtifactSnapshot, type ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { assertPortableArtifactRef, isContained } from "../runs/catalog-values.js";
import { assertReportSchema, ReportInputError, REPORT_LIMITS } from "./contracts.js";
import { resolveBatchIndex } from "./batch-index.js";
import type { BatchIndexInput } from "./batch-types.js";

export type ReportSourceSelector = { runDir?: string; session?: string; sources?: string };
export type SourceEntry = { kind: "run" | "session"; root: string };
export type SourceSelection = { entries: SourceEntry[]; duplicatePaths: number; indexBytes: number; indexSnapshot?: ArtifactSnapshot; batch?: BatchIndexInput; protectedRoots?: string[] };
type SourcesDocument = { schemaVersion: "lakda/report-sources/v1"; root: string; entries: Array<{ kind: "run" | "session"; path: string }> };

async function directory(path: string): Promise<string> {
  try {
    const actual = await realpath(path);
    if ((await stat(actual)).isDirectory()) return actual;
  } catch { /* Do not include private input paths in public diagnostics. */ }
  throw new ReportInputError("source-missing", "レポート入力directoryが存在しません");
}

export async function resolveReportSources(selector: ReportSourceSelector, signal?: AbortSignal): Promise<SourceSelection> {
  signal?.throwIfAborted();
  if (Object.values(selector).filter(value => value !== undefined).length !== 1) {
    throw new ReportInputError("invalid-sources", "run、session、sourcesから入力を1つ指定してください");
  }
  if (selector.runDir !== undefined || selector.session !== undefined) {
    const value = selector.runDir ?? selector.session!;
    if (!value) throw new ReportInputError("source-missing", "レポート入力directoryが空です");
    return { entries: [{ kind: selector.runDir !== undefined ? "run" : "session", root: await directory(resolve(value)) }], duplicatePaths: 0, indexBytes: 0 };
  }
  let path: string;
  try { path = await realpath(resolve(selector.sources!)); }
  catch { throw new ReportInputError("source-missing", "レポート入力indexが存在しません"); }
  const snapshot = await readArtifactSnapshot(dirname(path), basename(path), { retain: true, maxBytes: REPORT_LIMITS.textBytes, signal });
  let data: unknown;
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes!)); }
  catch { throw new ReportInputError("invalid-sources", "レポート入力indexがJSONではありません"); }
  if ((data as { schemaVersion?: unknown } | null)?.schemaVersion === "lakda/report-batch-sources/v1") {
    const batch = await resolveBatchIndex(data, snapshot, signal);
    const entries: SourceEntry[] = batch.document.workers.flatMap(worker => worker.status === "completed" && worker.run.manifestSha256 !== null ? [{ kind: "run", root: batch.directories.get(worker.workerIndex)! }] : []);
    return { entries, batch, duplicatePaths: 0, indexBytes: snapshot.size, indexSnapshot: batch.snapshot, protectedRoots: [dirname(snapshot.path), ...batch.directories.values()] };
  }
  assertReportSchema("sources", data);
  const source = data as SourcesDocument;
  const root = await directory(resolve(dirname(path), source.root));
  const keys = new Set<string>();
  const entries: SourceEntry[] = [];
  let duplicatePaths = 0;
  for (const entry of source.entries) {
    signal?.throwIfAborted();
    assertPortableArtifactRef(entry.path);
    const candidate = await directory(resolve(root, entry.path));
    if (!isContained(root, candidate)) throw new ReportInputError("source-escape", "レポート入力がroot外を参照しています");
    const key = entry.kind + ":" + candidate;
    if (keys.has(key)) { duplicatePaths += 1; continue; }
    keys.add(key);
    entries.push({ kind: entry.kind, root: candidate });
  }
  // Identity/digest deduplication and the 100-source limit follow artifact verification.
  return { entries, duplicatePaths, indexBytes: snapshot.size, indexSnapshot: { path: snapshot.path, size: snapshot.size, sha256: snapshot.sha256 } };
}
