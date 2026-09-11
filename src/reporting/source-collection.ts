import type { ManifestSnapshot } from "../runs/manifest-snapshot.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { loadReportRun, type ReportRunInput } from "./run-source.js";
import { loadReportSessionSnapshot } from "./session-snapshot.js";
import { projectReportSession, type ReportSessionInput } from "./session-source.js";
import { bindSessionRun, resolveSessionRunDirectory } from "./session-runs.js";
import type { SourceEntry, SourceSelection } from "./source-index.js";
import { projectReportBatch, type ReportBatchInput } from "./batch-source.js";
import { loadRunDiagnosticIfAbsent, type ReportRunDiagnosticInput, type RunDiagnosticSnapshot } from "./incomplete-run.js";
import type { ReportTrustStore } from "./trust-store.js";
import type { ReportNativeEvidence } from "./native-evidence.js";

export type ReportSourceCollection = {
  runs: ReportRunInput[]; sessions: ReportSessionInput[]; snapshots: ManifestSnapshot[];
  batch?: ReportBatchInput;
  diagnostics?: ReportRunDiagnosticInput[]; diagnosticSnapshots?: RunDiagnosticSnapshot[];
  nativeSnapshots?: Array<{ root: string; evidence: ReportNativeEvidence }>;
  explicitSourceCount: number; explicitSourceIds: string[]; duplicateSources: number; textBytes: number; artifactBytes: number;
};
type Input = ReportRunInput | ReportSessionInput | ReportRunDiagnosticInput;
const identity = (kind: SourceEntry["kind"], id: unknown, attempt: unknown) => kind + "\0" + id + (kind === "run" ? "\0" + attempt : "");
const inputIdentity = (input: Input) => "start" in input ? identity("run", input.start.runId, input.start.attempt) : identity(input.source.kind as SourceEntry["kind"], input.snapshot.manifest.run_id, input.snapshot.manifest.run_attempt);
const inputDigest = (input: Input) => "start" in input ? "start:" + input.snapshot.start.sha256 : "manifest:" + input.snapshot.manifestSha256;

export async function loadReportSourceCollection(selection: SourceSelection, signal?: AbortSignal, trust?: ReportTrustStore): Promise<ReportSourceCollection> {
  if (!selection.entries.length && !selection.batch) throw new ReportInputError("source-missing", "レポート入力を1つ以上指定してください");
  const inputs = new Map<string, Input>();
  const paths = new Map<string, string>();
  const explicit = new Set<string>();
  const visibleRuns = new Set<string>();
  const snapshots: ManifestSnapshot[] = [];
  const diagnosticSnapshots: RunDiagnosticSnapshot[] = [];
  const nativeSnapshots: Array<{ root: string; evidence: ReportNativeEvidence }> = [];
  let duplicateSources = selection.duplicatePaths;
  let textBytes = selection.indexBytes;
  let artifactBytes = 0;
  const load = async (entry: SourceEntry, declared: boolean): Promise<Input> => {
    signal?.throwIfAborted();
    const pathKey = entry.kind + "\0" + entry.root;
    const known = paths.get(pathKey);
    if (known) { duplicateSources += 1; if (declared) explicit.add(known); return inputs.get(known)!; }
    const diagnostic = entry.kind === "run" && declared ? await loadRunDiagnosticIfAbsent(entry.root, signal) : undefined;
    const input = diagnostic ?? (entry.kind === "run" ? await loadReportRun(entry.root, { signal }) : projectReportSession(await loadReportSessionSnapshot(entry.root, { signal, trust })));
    if ("nativeEvidence" in input && input.nativeEvidence) nativeSnapshots.push({ root: input.snapshot.root, evidence: input.nativeEvidence });
    const key = inputIdentity(input);
    const previous = inputs.get(key);
    if (previous && inputDigest(previous) !== inputDigest(input)) throw new ReportInputError("conflicting-source", "同じsource IDの保存内容が競合しています");
    paths.set(pathKey, key);
    if (declared) explicit.add(key);
    if (explicit.size > REPORT_LIMITS.sources) throw new ReportInputError("source-limit", "明示sourceの上限を超えています");
    if (previous) {
      duplicateSources += 1;
      // Keep digest handles for the final recheck without retaining duplicate text buffers.
      if ("start" in input) diagnosticSnapshots.push(input.snapshot);
      else snapshots.push({ ...input.snapshot, snapshots: new Map([...input.snapshot.snapshots].map(([ref, value]) => [ref, { path: value.path, size: value.size, sha256: value.sha256 }])) });
      return previous;
    }
    inputs.set(key, input);
    if ("start" in input) diagnosticSnapshots.push(input.snapshot); else snapshots.push(input.snapshot);
    textBytes += "start" in input ? input.snapshot.start.size : input.snapshot.retainedTextBytes;
    artifactBytes += "start" in input ? input.snapshot.start.size : input.snapshot.verifiedArtifactBytes;
    if (textBytes > REPORT_LIMITS.textBytes || artifactBytes > REPORT_LIMITS.artifactBytes) throw new ReportInputError("input-byte-limit", "入力集合の容量上限を超えています");
    if ([...inputs.values()].filter(value => value.source.kind === "run").length > REPORT_LIMITS.runs) throw new ReportInputError("run-limit", "展開後runの上限を超えています");
    return input;
  };
  // Explicit runs allow moved archives to resolve a session reference by verified identity/digest.
  for (const entry of selection.entries.filter(entry => entry.kind === "run")) {
    const input = await load(entry, !selection.batch);
    visibleRuns.add(inputIdentity(input));
  }
  for (const entry of selection.entries.filter(entry => entry.kind === "session")) await load(entry, true);
  const sessions = [...inputs.values()].filter((input): input is ReportSessionInput => input.source.kind === "session");
  for (const session of sessions) {
    for (const ref of session.runReferences) {
      signal?.throwIfAborted();
      const key = identity("run", ref.runId, ref.attempt);
      const selected = inputs.get(key);
      if (selected && "start" in selected) throw new ReportInputError("source-not-finalized", "sessionが参照するrunの最終manifestがありません");
      let run = selected as ReportRunInput | undefined;
      if (run) duplicateSources += 1;
      else run = await load({ kind: "run", root: await resolveSessionRunDirectory(session, ref) }, false) as ReportRunInput;
      bindSessionRun(session, ref, run);
      if (session.source.status !== "restricted") visibleRuns.add(key);
    }
  }
  const visible = [...visibleRuns].map(key => inputs.get(key)!);
  const diagnostics = visible.filter((input): input is ReportRunDiagnosticInput => "start" in input);
  let runs = visible.filter((input): input is ReportRunInput => !("start" in input));
  const batch = selection.batch ? projectReportBatch(selection.batch, runs) : undefined;
  if (batch?.source.status === "restricted") runs = [];
  const timelines = [...runs, ...sessions].reduce((count, input) => count + input.timeline.length, 0);
  const rows = [...runs, ...sessions].reduce((count, input) => count + input.rows.filter(row => ["failure", "warning", "finding"].includes(row.kind)).length, 0);
  if (timelines > REPORT_LIMITS.actionsAndEvents || rows > REPORT_LIMITS.failuresAndFindings) throw new ReportInputError("record-limit", "入力集合の表示件数上限を超えています");
  const explicitSourceIds = batch ? [batch.source.id] : [...explicit].map(key => inputs.get(key)!.source.id).sort();
  return { runs, sessions, snapshots, ...(nativeSnapshots.length ? { nativeSnapshots } : {}), ...(diagnostics.length ? { diagnostics, diagnosticSnapshots } : {}), ...(batch ? { batch } : {}), explicitSourceCount: explicitSourceIds.length, explicitSourceIds, duplicateSources, textBytes, artifactBytes };
}
