import { canonicalJson } from "../core/plan.js";
import { parseBinaryAttestations, type BinaryArtifactAttestation, type StoredBinaryArtifactAttestation } from "../exploration/binary-attestation.js";
import { assertAttestationReceipt, ATTESTATION_MESSAGE_MAX_BYTES, type AcceptedBinaryAttestation } from "../exploration/attestation-contracts.js";
import { attestationReceiptPath } from "../exploration/attestation-evidence.js";
import { assertPortableArtifactRef, hateArtifact } from "../runs/catalog-values.js";
import { assertBinaryAttestationSchema, ReportInputError, REPORT_LIMITS } from "./contracts.js";
import { maximumClassification } from "./projection-values.js";
import { snapshotLines, snapshotText } from "./source-values.js";
import type { ReportRunInput } from "./run-source.js";
import type { ReportSessionInput } from "./session-source.js";
import type { Classification } from "./types.js";

export const BINARY_PROOF_REF = "attestations/binary-artifacts.jsonl";
export type ReportBinaryAttestation = (BinaryArtifactAttestation & Required<Pick<BinaryArtifactAttestation, "signature" | "tool">>) | AcceptedBinaryAttestation;

export function readReportMediaAttestations(input: ReportRunInput | ReportSessionInput): Map<string, ReportBinaryAttestation> | undefined {
  const artifact = input.snapshot.artifacts.find(value => value.path === BINARY_PROOF_REF);
  if (!artifact) return undefined;
  if (artifact.classification === "restricted") throw new ReportInputError("restricted-media-proof", "取扱い制限のある検査記録は媒体の採用に使用できません");
  hateArtifact(artifact, 0);
  const lines = snapshotLines(input.snapshot, BINARY_PROOF_REF, REPORT_LIMITS.actionsAndEvents);
  for (const line of lines) {
    const value: unknown = JSON.parse(line);
    assertBinaryAttestationSchema(value);
    const attestation = value as StoredBinaryArtifactAttestation;
    if (!attestation.signature || !attestation.tool) throw new ReportInputError("invalid-media-proof", "署名・検査tool・policyの記録が必要です");
    assertPortableArtifactRef(attestation.sourcePath);
    if (attestation.outputPath !== undefined) assertPortableArtifactRef(attestation.outputPath);
  }
  const records = parseBinaryAttestations(input.snapshot.root, lines.join("\n"));
  if (records.size !== lines.length) throw new ReportInputError("invalid-media-proof", "媒体の検査記録が不正、または重複しています");
  input.source.classification = maximumClassification([input.source.classification, artifact.classification as Classification]);
  return records as Map<string, ReportBinaryAttestation>;
}

/** Only the integrity-checked HATE snapshot can supply an arrival record. */
export function readReportMediaReceipt(input: ReportRunInput | ReportSessionInput, requestId: string) {
  const ref = attestationReceiptPath(requestId), artifact = input.snapshot.artifacts.find(value => value.path === ref);
  const snapshot = input.snapshot.snapshots.get(ref);
  if (!artifact || artifact.classification === "restricted" || !snapshot?.bytes || snapshot.size > ATTESTATION_MESSAGE_MAX_BYTES) {
    throw new ReportInputError("invalid-media-proof", "公開可能な受領記録を確認できません");
  }
  hateArtifact(artifact, 0);
  const text = snapshotText(input.snapshot, ref), receipt: unknown = JSON.parse(text);
  assertAttestationReceipt(receipt);
  if (receipt.requestId !== requestId || text !== canonicalJson(receipt) + "\n") throw new ReportInputError("invalid-media-proof", "受領記録の形式が一致しません");
  return { receipt, sha256: snapshot.sha256, classification: artifact.classification as Classification };
}
