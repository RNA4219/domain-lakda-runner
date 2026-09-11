import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../core/redaction.js";
import { assertRunStartRecord, RUN_START_MAX_BYTES, RUN_START_REF, type RunStartRecord } from "../core/run-start.js";
import { readArtifactSnapshot, type ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { MANIFEST_REF } from "../runs/manifest-snapshot.js";
import { ReportInputError } from "./contracts.js";
import type { ReportIncompleteRun, ReportIssue, ReportRow, ReportSource } from "./types.js";

export type RunDiagnosticSnapshot = { root: string; dev: number; ino: number; start: ArtifactSnapshot };
export type ReportRunDiagnosticInput = {
  start: RunStartRecord; snapshot: RunDiagnosticSnapshot; source: ReportSource; summary?: ReportIncompleteRun;
  rows: ReportRow[]; issues: ReportIssue[]; timeline: []; mediaCandidates: [];
};

export async function hasRunManifest(root: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  // Existing manifests retain the strict reader's path and integrity rules.
  try { await lstat(join(root, MANIFEST_REF)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try {
    const parent = await lstat(join(root, "exports"));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new ReportInputError("invalid-manifest-location", "manifest保存directoryが不正です");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  return false;
}

/** Existing manifests always take the strict HATE path, including malformed files and links. */
export async function loadRunDiagnosticIfAbsent(path: string, signal?: AbortSignal): Promise<ReportRunDiagnosticInput | undefined> {
  signal?.throwIfAborted();
  const root = await realpath(path);
  if (await hasRunManifest(root, signal)) return undefined;
  const stat = await lstat(root);
  if (!stat.isDirectory()) throw new ReportInputError("source-missing", "run入力がdirectoryではありません");
  const snapshot = await readArtifactSnapshot(root, RUN_START_REF, { retain: true, maxBytes: RUN_START_MAX_BYTES, signal });
  let start: unknown;
  try { start = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes!)); assertRunStartRecord(start); }
  catch { throw new ReportInputError("invalid-start-record", "最小開始記録を検証できません"); }
  const record = start as RunStartRecord;
  const key = "run:" + record.runId + ":" + record.attempt;
  const restricted = record.classification === "restricted";
  const source: ReportSource = {
    id: restricted ? "restricted:" + sha256(snapshot.sha256).slice(0, 24) : key, kind: "run", status: restricted ? "restricted" : "unverified",
    manifestSha256: null, eventHeadDigest: null, startRecordSha256: snapshot.sha256,
    producerRevision: restricted ? null : record.producerRevision, targetRevision: null, classification: record.classification,
  };
  const input: ReportRunDiagnosticInput = { start: record, snapshot: { root, dev: stat.dev, ino: stat.ino, start: { path: snapshot.path, size: snapshot.size, sha256: snapshot.sha256 } }, source, rows: [], timeline: [], mediaCandidates: [], issues: [] };
  if (restricted) {
    input.issues.push({ code: "restricted-source", severity: "warning", sourceId: source.id, message: "取扱い制限により入力の内容を表示しません" });
    return input;
  }
  input.summary = { key, sourceId: key, status: "unfinalized", runId: record.runId, attempt: record.attempt, startedAt: record.startedAt, mode: record.mode, seed: record.seed, workerIndex: record.workerIndex, ...(record.batchId ? { batchId: record.batchId } : {}), producerVersion: record.producerVersion, producerRevision: record.producerRevision };
  input.rows.push({ id: key, sourceId: key, runKey: null, kind: "run", status: "unfinalized", severity: null, title: record.runId, message: "開始記録のみ。結果は未確定で、実行中と異常終了を区別できません。", at: record.startedAt, ruleId: null, relatedIds: [], evidenceIds: [] });
  input.issues.push({ code: "run-unfinalized", severity: "warning", sourceId: key, message: "合否・終了時刻・操作数・失敗数は未取得です。最小開始記録だけを表示します。" });
  return input;
}

export async function verifyRunDiagnosticSnapshot(snapshot: RunDiagnosticSnapshot, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const root = await realpath(snapshot.root); const stat = await lstat(root);
  if (root !== snapshot.root || !stat.isDirectory() || stat.dev !== snapshot.dev || stat.ino !== snapshot.ino) throw new Error("run directory changed");
  await readArtifactSnapshot(root, RUN_START_REF, { expected: snapshot.start, maxBytes: RUN_START_MAX_BYTES, signal });
  if (await hasRunManifest(root, signal)) throw new Error("run finalized during report generation");
}
