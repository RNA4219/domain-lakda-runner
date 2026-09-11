import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { assertExplorationCapabilitySnapshot, assertExplorationCharter, assertExplorationReport, capabilitySnapshotDigest, explorationDigest, type ExplorationCharter, type ExplorationReport, type ExplorationSession, type ExplorationSessionEvent } from "../exploration/contracts.js";
import { verifyExplorationSessionSnapshot } from "../exploration/session.js";
import { hateArtifact } from "../runs/catalog-values.js";
import { readManifestSnapshot, type ManifestReadOptions, type ManifestSnapshot } from "../runs/manifest-snapshot.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { maximumClassification } from "./projection-values.js";
import { reportTimestamp, snapshotJson, snapshotLines } from "./source-values.js";
import type { Classification } from "./types.js";
import { verifyReportNativeEvidence, type ReportNativeEvidence } from "./native-evidence.js";
import type { ReportTrustStore } from "./trust-store.js";

export type ReportSessionSnapshot = {
  snapshot: ManifestSnapshot; session: ExplorationSession; events: ExplorationSessionEvent[];
  charter: ExplorationCharter; report: ExplorationReport; classification: Classification;
  nativeEvidence?: ReportNativeEvidence;
};

export async function assertSessionUnlocked(root: string): Promise<void> {
  try { await lstat(join(root, ".session.lock")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new ReportInputError("source-not-finalized", "探索sessionが更新中です。確定後に生成してください");
}

function binding(valid: boolean): asserts valid {
  if (!valid) throw new ReportInputError("session-binding-mismatch", "探索sessionの保存記録のbindingが不一致です");
}

export async function loadReportSessionSnapshot(root: string, options: Pick<ManifestReadOptions, "signal" | "textLimit" | "artifactLimit"> & { trust?: ReportTrustStore } = {}): Promise<ReportSessionSnapshot> {
  await assertSessionUnlocked(root);
  const snapshot = await readManifestSnapshot(root, { textLimit: REPORT_LIMITS.textBytes, artifactLimit: REPORT_LIMITS.artifactBytes, ...options, retain: ref => /\.(json|jsonl)$/i.test(ref) });
  const eventLines = snapshotLines(snapshot, "events.jsonl", REPORT_LIMITS.actionsAndEvents);
  const { session, events } = verifyExplorationSessionSnapshot(snapshotJson(snapshot, "session.json"), eventLines.join("\n"));
  if (session.status === "running" || session.status === "draft" || !events.length) {
    throw new ReportInputError("source-not-finalized", "探索sessionが未確定です。停止後に生成してください");
  }
  const charter = snapshotJson(snapshot, "charter.json");
  const report = snapshotJson(snapshot, "report.json");
  assertExplorationCharter(charter);
  assertExplorationReport(report);
  binding(snapshot.manifest.run_id === session.sessionId && snapshot.manifest.run_attempt === 1);
  binding(explorationDigest(charter) === session.charterDigest && session.platform === charter.platform && session.lane === charter.platform);
  binding(report.sessionId === session.sessionId && report.charterDigest === session.charterDigest && report.platform === session.platform && report.lane === session.lane && report.targetRevision === charter.targetRevision);
  binding(report.executionMode === undefined || report.executionMode === charter.executionMode);
  const external = session.status === "completed" && (charter.executionMode === "real" || ["windows", "android", "ios"].includes(charter.platform));
  binding(report.status === (external ? "pending_external" : session.status));
  binding(report.sessionStatus === undefined || report.sessionStatus === session.status);
  binding(report.technicalOutcome === session.technicalOutcome && report.terminationReason === session.terminationReason);
  binding(report.runIds === undefined || canonicalJson(report.runIds) === canonicalJson(session.runIds));
  for (const value of [session.createdAt, session.updatedAt, ...events.map(event => event.at)]) reportTimestamp(value);
  for (const count of [report.coverage.actions, report.coverage.states, report.coverage.transitions]) binding(Number.isSafeInteger(count) && count >= 0);
  binding(new Set(events.map(event => event.eventId)).size === events.length && events.every(event => typeof event.eventId === "string" && event.eventId.length > 0));
  const required = ["session.json", "events.jsonl", "charter.json", "report.json"];
  if (session.capabilityDigest) {
    const capability = snapshotJson(snapshot, "capability-snapshot.json");
    assertExplorationCapabilitySnapshot(capability);
    binding(capabilitySnapshotDigest(capability) === session.capabilityDigest && capability.lane === session.platform && capability.targetRevision === charter.targetRevision && capability.adapterId === charter.adapter.id);
    binding(capability.executionMode === undefined || capability.executionMode === charter.executionMode);
    required.push("capability-snapshot.json");
  }
  const nativeEvidence = await verifyReportNativeEvidence({ snapshot, session, events, charter }, options.trust, options.signal);
  if (nativeEvidence) required.push("target-manifest.json", ...snapshot.artifacts.filter(artifact => artifact.path.startsWith("native-identity/")).map(artifact => artifact.path));
  const requiredPaths = new Set(required);
  const selected = snapshot.artifacts.filter(artifact => requiredPaths.has(artifact.path));
  const classification = maximumClassification(selected.map(artifact => artifact.classification as Classification));
  if (classification !== "restricted") selected.forEach((artifact, index) => hateArtifact(artifact, index));
  await assertSessionUnlocked(snapshot.root);
  options.signal?.throwIfAborted();
  return { snapshot, session, events, charter, report, classification, ...(nativeEvidence ? { nativeEvidence } : {}) };
}
