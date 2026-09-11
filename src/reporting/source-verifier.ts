import { basename, dirname } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { MANIFEST_REF } from "../runs/manifest-snapshot.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { assertSessionUnlocked } from "./session-snapshot.js";
import type { ReportSourceCollection } from "./source-collection.js";
import type { SourceSelection } from "./source-index.js";
import { assertBatchManifestAbsent } from "./batch-index.js";
import { verifyRunDiagnosticSnapshot } from "./incomplete-run.js";
import { verifyReportNativeEvidenceUnchanged } from "./native-evidence.js";

async function unchanged(operation: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  try { await operation(); }
  catch {
    signal?.throwIfAborted();
    throw new ReportInputError("source-not-finalized", "入力の更新または不一致を検出しました。確定後に生成してください");
  }
  signal?.throwIfAborted();
}

export async function verifyReportSourceIndex(selection: SourceSelection, signal?: AbortSignal): Promise<void> {
  const expected = selection.indexSnapshot;
  if (!expected) { signal?.throwIfAborted(); return; }
  await unchanged(async () => {
    await readArtifactSnapshot(dirname(expected.path), basename(expected.path), { expected, maxBytes: REPORT_LIMITS.textBytes, signal });
    for (const entry of selection.batch?.unfinalized ?? []) {
      const actual = await realpath(entry.root);
      const stat = await lstat(actual);
      if (actual !== entry.root || !stat.isDirectory() || stat.dev !== entry.dev || stat.ino !== entry.ino) throw new Error("unfinalized run changed");
      await assertBatchManifestAbsent(actual, signal);
    }
  }, signal);
}

/** Rechecks the exact selected bytes. It never acquires a producer lock, repairs or re-exports. */
export async function verifyReportSourcesUnchanged(collection: ReportSourceCollection, signal?: AbortSignal): Promise<void> {
  await unchanged(async () => {
    for (const snapshot of collection.diagnosticSnapshots ?? []) await verifyRunDiagnosticSnapshot(snapshot, signal);
    for (const snapshot of collection.snapshots) {
      const isSession = snapshot.artifacts.some(artifact => artifact.path === "session.json");
      if (isSession) await assertSessionUnlocked(snapshot.root);
      const manifest = await readArtifactSnapshot(snapshot.root, MANIFEST_REF, { maxBytes: REPORT_LIMITS.textBytes, signal });
      if (manifest.sha256 !== snapshot.manifestSha256) throw new Error("manifest changed");
      for (const [ref, expected] of snapshot.snapshots) {
        await readArtifactSnapshot(snapshot.root, ref, { expected, maxBytes: expected.size, signal });
      }
      await readArtifactSnapshot(snapshot.root, MANIFEST_REF, { expected: manifest, maxBytes: manifest.size, signal });
      if (isSession) await assertSessionUnlocked(snapshot.root);
    }
    for (const native of collection.nativeSnapshots ?? []) {
      await assertSessionUnlocked(native.root);
      await verifyReportNativeEvidenceUnchanged(native.root, native.evidence, signal);
      await assertSessionUnlocked(native.root);
    }
  }, signal);
}
