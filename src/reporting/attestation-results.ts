import { attestationReceiptPath, type AttestationBinding } from "../exploration/attestation-evidence.js";
import { checkAttestationResultMedia } from "../exploration/attestation-policy.js";
import { attestationResultPath, readAttestationResults } from "../exploration/attestation-results.js";
import { hateArtifact, object } from "../runs/catalog-values.js";
import type { ManifestSnapshot } from "../runs/manifest-snapshot.js";
import { ReportInputError } from "./contracts.js";
import { cleanReportText, maximumClassification } from "./projection-values.js";
import type { Classification, ReportIssue, ReportSource } from "./types.js";

/** A verified error record can explain absent media without claiming that media passed inspection. */
export function projectAttestationResults(snapshot: ManifestSnapshot, metadata: Record<string, unknown>, source: ReportSource, issues: ReportIssue[]): void {
  if (metadata.binaryAttestation === undefined && !snapshot.artifacts.some(artifact => artifact.path.startsWith("attestations/results/"))) return;
  try {
    const policy = object(metadata.artifactPolicy, "artifact policy"), binding = object(policy.binaryAttestationBinding, "attestation binding");
    if (policy.binaryAttestationRequired !== true || binding.runId !== metadata.runId) throw new Error();
    const results = readAttestationResults(snapshot.snapshots, binding as AttestationBinding, metadata.binaryAttestation);
    const unavailable = checkAttestationResultMedia(results, snapshot.artifacts.map(artifact => ({ path: artifact.path, size: artifact.size_bytes, sha256: artifact.sha256 })));
    if (unavailable.length && metadata.outcome !== "error") throw new Error();
    const artifacts = new Map(snapshot.artifacts.map(artifact => [artifact.path, artifact]));
    for (const result of results) {
      const record = artifacts.get(attestationResultPath(result.request.requestId)), receipt = artifacts.get(attestationReceiptPath(result.request.requestId));
      if (!record || !receipt) throw new Error();
      if (record.classification === "restricted" || receipt.classification === "restricted") {
        issues.push({ code: "restricted-attestation-result", severity: "info", sourceId: source.id, message: "取扱い制限のある媒体採用記録を除外しました" });
        continue;
      }
      for (const artifact of [record, receipt]) {
        hateArtifact(artifact, 0);
        if (artifact.security_checks.secrets_scan !== "pass" || artifact.security_checks.pii_scan !== "pass" || artifact.safe_for_summary !== true) throw new Error();
        source.classification = maximumClassification([source.classification, artifact.classification as Classification]);
      }
      if (result.adoption !== "adopted") issues.push({ code: "attestation-media-unavailable", severity: "info", sourceId: source.id,
        message: cleanReportText(`媒体を保持できませんでした: ${result.request.sourcePath}（${result.reason}）`) });
    }
  } catch { throw new ReportInputError("invalid-attestation-result", "媒体の採用記録と要求・受領・保持内容を照合できません"); }
}
