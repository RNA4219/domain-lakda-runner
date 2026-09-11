import { assertExplorationCapabilitySnapshot } from "../exploration/contracts.js";
import { verifySignedExplorationTargetManifestSnapshot } from "../exploration/target-manifest.js";
import { hateArtifact } from "../runs/catalog-values.js";
import { ReportInputError } from "./contracts.js";
import { maximumClassification } from "./projection-values.js";
import { snapshotJson } from "./source-values.js";
import type { ReportSessionInput } from "./session-source.js";
import type { ReportTrustStore } from "./trust-store.js";
import type { Classification } from "./types.js";
import { verifyReportNativeEvidence } from "./native-evidence.js";

export type ReportMediaTarget = { allowedKeyIds: readonly string[]; manifestSha256: string; classification: Classification; sessionId: string; attestationPolicyDigest?: string };

/** Historical target proof, using only the session's integrity-checked snapshots. */
export async function verifyReportMediaTarget(input: ReportSessionInput, trust: ReportTrustStore, signal?: AbortSignal): Promise<ReportMediaTarget> {
  signal?.throwIfAborted();
  const reject = () => new ReportInputError("invalid-media-target", "保存時点の対象・許可鍵・検査記録の対応を確認できません");
  const target = input.snapshot.snapshots.get("target-manifest.json");
  const started = input.events.find(event => event.type === "session-started");
  if (input.charter.executionMode !== "real" || !target?.bytes || !started || target.sha256 !== input.session.targetManifestDigest || !input.session.capabilityDigest) throw reject();
  const artifacts = ["target-manifest.json", "capability-snapshot.json"].map(ref => input.snapshot.artifacts.find(artifact => artifact.path === ref));
  if (artifacts.some(artifact => !artifact || artifact.classification === "restricted")) throw reject();
  artifacts.forEach(artifact => hateArtifact(artifact!, 0));
  const capability = snapshotJson(input.snapshot, "capability-snapshot.json");
  assertExplorationCapabilitySnapshot(capability);
  const native = await verifyReportNativeEvidence(input, trust, signal);
  const { manifest, sha256 } = native?.target ?? await verifySignedExplorationTargetManifestSnapshot(target.bytes, input.charter, input.session.configDigest, { trustKeys: trust.keys, at: started.at });
  if (manifest.bridgeBinding.capabilityDigest !== capability.rawCapabilityDigest || capability.bridgeDigest && manifest.bridgeBinding.bridgeDigest !== capability.bridgeDigest) throw reject();
  signal?.throwIfAborted();
  const classification = maximumClassification([input.source.classification, ...artifacts.map(artifact => artifact!.classification as Classification)]);
  input.source.classification = classification;
  return { allowedKeyIds: manifest.artifactAttestorKeyIds ?? [], manifestSha256: sha256, classification, sessionId: input.session.sessionId,
    ...(input.charter.capture.binaryAttestation ? { attestationPolicyDigest: input.charter.capture.binaryAttestation.policyDigest } : {}) };
}
