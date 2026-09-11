import { readSignedSessionNativeEvidence, sessionHasNativeEvidence, verifyNativeEvidenceArtifactIndex } from "../exploration/native-identity-evidence-target.js";
import { readSessionNativeEvidence } from "../exploration/native-identity-evidence-store.js";
import type { NativeEvidenceTarget } from "../exploration/native-identity-evidence.js";
import { sessionPaths } from "../exploration/session.js";
import { ReportInputError } from "./contracts.js";
import type { ReportSessionSnapshot } from "./session-snapshot.js";
import type { ReportTrustStore } from "./trust-store.js";

export type ReportNativeEvidence = { complete: boolean; sourceDigest: string; target: NativeEvidenceTarget };
type Input = Pick<ReportSessionSnapshot, "snapshot" | "session" | "events" | "charter">;
const invalid = () => new ReportInputError("invalid-native-evidence", "native対象の署名・保存観測・証跡一覧の対応を確認できません");

/** Native proof is required even when the report contains no media. */
export async function verifyReportNativeEvidence(input: Input, trust?: ReportTrustStore, signal?: AbortSignal): Promise<ReportNativeEvidence | undefined> {
  try {
    signal?.throwIfAborted();
    const paths = sessionPaths(input.snapshot.root);
    const target = input.snapshot.snapshots.get("target-manifest.json");
    const indexedTarget = target?.bytes ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(target.bytes)) as { schemaVersion?: unknown } | null : undefined;
    const declared = input.snapshot.artifacts.some(item => item.path.startsWith("native-identity/"))
      || input.events.some(event => event.payload && "nativeEvidenceRef" in event.payload)
      || indexedTarget?.schemaVersion === "lakda/exploration-target-manifest/v2";
    if (!declared && !(await sessionHasNativeEvidence(paths, signal))) return undefined;
    if (!trust || !target?.bytes || target.sha256 !== input.session.targetManifestDigest || input.charter.executionMode !== "real") throw invalid();
    const evidence = await readSignedSessionNativeEvidence(paths, { charter: input.charter, configDigest: input.session.configDigest, trustKeys: trust.keys, signal });
    verifyNativeEvidenceArtifactIndex(evidence, input.snapshot.artifacts);
    if (evidence.target.sha256 !== target.sha256) throw invalid();
    signal?.throwIfAborted();
    return { complete: evidence.complete, sourceDigest: evidence.sourceDigest, target: evidence.target };
  } catch { signal?.throwIfAborted(); throw invalid(); }
}

export async function verifyReportNativeEvidenceUnchanged(root: string, expected: ReportNativeEvidence, signal?: AbortSignal): Promise<void> {
  const current = await readSessionNativeEvidence(sessionPaths(root), expected.target, signal);
  if (current.sourceDigest !== expected.sourceDigest || current.complete !== expected.complete) throw invalid();
}
