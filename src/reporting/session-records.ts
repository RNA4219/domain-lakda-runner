import { assertHateManifest } from "../core/hate.js";
import { canonicalJson } from "../core/plan.js";
import { assertExplorationFinding, type ExplorationFinding } from "../exploration/contracts.js";
import { assertPortableArtifactRef, integerValue, object } from "../runs/catalog-values.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import type { ReportSessionSnapshot } from "./session-snapshot.js";
import { reportTimestamp, snapshotJson, snapshotLines } from "./source-values.js";

export type SessionRunReference = { runId: string; attempt: number; manifestSha256: string; manifestSize: number; relativeDir?: string };

function requireBinding(valid: boolean): asserts valid {
  if (!valid) throw new ReportInputError("session-binding-mismatch", "探索sessionの記録またはrun参照が不一致です");
}

export function readSessionRunReferences(input: ReportSessionSnapshot): SessionRunReference[] {
  const { snapshot, session, events } = input;
  requireBinding(new Set(session.runIds).size === session.runIds.length);
  if (session.runIds.length > REPORT_LIMITS.runs) throw new ReportInputError("run-limit", "展開後runの上限を超えています");
  const refs = new Map<string, SessionRunReference>();
  for (const ref of session.runManifestRefs ?? []) {
    assertPortableArtifactRef(ref.path);
    const copy = snapshot.snapshots.get(ref.path);
    requireBinding(Boolean(copy) && copy!.size === ref.size && copy!.sha256 === ref.sha256);
    const manifest = snapshotJson(snapshot, ref.path);
    assertHateManifest(manifest);
    const value = object(manifest, "session run manifest");
    requireBinding(value.run_id === ref.runId && session.runIds.includes(ref.runId));
    const current = { runId: ref.runId, attempt: integerValue(value.run_attempt, "run attempt", 1), manifestSha256: ref.sha256, manifestSize: ref.size };
    const previous = refs.get(ref.runId);
    requireBinding(!previous || canonicalJson(previous) === canonicalJson(current));
    refs.set(ref.runId, current);
  }
  requireBinding(refs.size === session.runIds.length);
  for (const event of events) {
    const id = event.payload?.runId;
    const directory = event.payload?.lastRunDir;
    if (id === undefined || directory === undefined) continue;
    requireBinding(typeof id === "string" && typeof directory === "string");
    assertPortableArtifactRef(directory);
    const ref = refs.get(id);
    requireBinding(Boolean(ref) && (ref!.relativeDir === undefined || ref!.relativeDir === directory));
    ref!.relativeDir = directory;
  }
  return session.runIds.map(id => refs.get(id)!);
}

export function readSessionFindings(input: ReportSessionSnapshot): ExplorationFinding[] {
  const unique = (values: unknown[]): Map<string, ExplorationFinding> => {
    const found = new Map<string, ExplorationFinding>();
    for (const value of values) {
      assertExplorationFinding(value);
      requireBinding(value.sessionId === input.session.sessionId && value.platform === input.session.platform && value.targetRevision === input.charter.targetRevision);
      reportTimestamp(value.observedAt);
      const previous = found.get(value.findingId);
      if (previous && canonicalJson(previous) !== canonicalJson(value)) throw new ReportInputError("conflicting-finding", "同じfinding IDの内容が競合しています");
      found.set(value.findingId, value);
      if (found.size > REPORT_LIMITS.failuresAndFindings) throw new ReportInputError("row-limit", "findingの表示上限を超えています");
    }
    return found;
  };
  // The structured-text bound limits duplicate records before identity deduplication.
  const lines = snapshotLines(input.snapshot, "findings.jsonl", Infinity);
  const values: unknown[] = lines.map(line => {
    try { return JSON.parse(line); }
    catch { throw new ReportInputError("invalid-json", "finding記録が有効なJSONではありません"); }
  });
  const findings = unique(values);
  const reported = unique(input.report.findings);
  requireBinding(findings.size === reported.size && new Set(input.session.findingIds).size === input.session.findingIds.length && input.session.findingIds.length === findings.size);
  for (const [id, finding] of findings) requireBinding(input.session.findingIds.includes(id) && canonicalJson(reported.get(id) ?? null) === canonicalJson(finding));
  return [...findings.values()];
}
