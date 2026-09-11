import { setImmediate } from "node:timers/promises";
import { sha256 } from "../core/redaction.js";
import { verifyBinaryAttestationSnapshot } from "../exploration/binary-attestation.js";
import { ReportInputError } from "./contracts.js";
import { BINARY_PROOF_REF, readReportMediaAttestations, readReportMediaReceipt } from "./media-attestations.js";
import { verifyReportMediaTarget, type ReportMediaTarget } from "./media-target.js";
import type { VerifiedMediaReplacement } from "./media-replacements.js";
import { maximumClassification } from "./projection-values.js";
import type { ReportSourceCollection } from "./source-collection.js";
import type { ReportTrustStore } from "./trust-store.js";
import type { ReportIssue, ReportMediaProof } from "./types.js";

export async function verifyReportMediaProofs(collection: ReportSourceCollection, trust?: ReportTrustStore, signal?: AbortSignal): Promise<{ verifiedIds: Set<string>; proofs: Map<string, ReportMediaProof>; replacements: VerifiedMediaReplacement[]; issues: ReportIssue[] }> {
  const verifiedIds = new Set<string>(); const issues: ReportIssue[] = [];
  const proofs = new Map<string, ReportMediaProof>();
  const replacements: VerifiedMediaReplacement[] = [];
  if (!trust) return { verifiedIds, proofs, replacements, issues };
  const problem = (sourceId: string, code: string) => {
    if (!issues.some(issue => issue.sourceId === sourceId && issue.code === code)) issues.push({ sourceId, code, severity: "warning", message: "媒体の署名・検査条件・対象との対応を確認できません。検証済み媒体として採用しません" });
  };
  const sessionTargets = new Map<string, ReportMediaTarget>();
  const runTargets = new Map<string, Array<ReportMediaTarget | undefined>>();
  for (const input of collection.sessions) {
    signal?.throwIfAborted();
    const relatedRuns = collection.runs.filter(run => input.runReferences.some(ref => ref.runId === run.snapshot.manifest.run_id && ref.attempt === run.snapshot.manifest.run_attempt && ref.manifestSha256 === run.snapshot.manifestSha256));
    let target: ReportMediaTarget | undefined;
    const hasMedia = input.mediaCandidates.length || relatedRuns.some(run => run.mediaCandidates.length);
    if (input.source.status !== "restricted" && input.charter.executionMode === "real" && hasMedia) {
      try { target = await verifyReportMediaTarget(input, trust, signal); sessionTargets.set(input.source.id, target); }
      catch { signal?.throwIfAborted(); problem(input.source.id, "invalid-media-target"); }
    }
    for (const run of relatedRuns) runTargets.set(run.source.id, [...(runTargets.get(run.source.id) ?? []), target]);
  }
  let inspected = 0;
  for (const input of [...collection.runs, ...collection.sessions]) {
    signal?.throwIfAborted();
    if (!input.mediaCandidates.length) continue;
    let records;
    try { records = readReportMediaAttestations(input); }
    catch { problem(input.source.id, "invalid-media-proof"); continue; }
    if (!records) continue;
    const nameKey = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
    const retainedNames = new Set(input.snapshot.artifacts.map(artifact => nameKey(artifact.path)));
    const retainedDigests = new Map<string, Set<string>>();
    for (const artifact of input.snapshot.artifacts) {
      const snapshot = input.snapshot.snapshots.get(artifact.path)!; const digestKey = snapshot.size + ":" + snapshot.sha256;
      const paths = retainedDigests.get(digestKey) ?? new Set<string>(); paths.add(artifact.path); retainedDigests.set(digestKey, paths);
    }
    for (const candidate of input.mediaCandidates) {
      signal?.throwIfAborted();
      if (++inspected % 64 === 0) await setImmediate(undefined, { signal });
      const proof = records.get(candidate.artifact.path);
      if (!proof) { problem(input.source.id, "invalid-media-proof"); continue; }
      let targets: Array<ReportMediaTarget | undefined> = [];
      if ("charter" in input && input.charter.executionMode === "real") targets = [sessionTargets.get(input.source.id)];
      else if ("metadata" in input && input.metadata.mode === "adaptive-explore") targets = runTargets.get(input.source.id) ?? [undefined];
      const targetPermitted = !targets.some(target => !target || !target.allowedKeyIds.includes(proof.signature.keyId));
      let receipt: ReturnType<typeof readReportMediaReceipt> | undefined;
      if (proof.schemaVersion === "lakda/binary-artifact-attestation/v2") {
        if (!targetPermitted || !targets.length || targets.some(target => !target!.attestationPolicyDigest)) { problem(input.source.id, "invalid-media-target"); continue; }
        try { receipt = readReportMediaReceipt(input, proof.request.requestId); }
        catch { problem(input.source.id, "invalid-media-proof"); continue; }
        if (!targets.every(target => verifyBinaryAttestationSnapshot(input.snapshot.root, candidate.artifact.path, proof, candidate.snapshot, {
          trustKeys: trust.keys, allowedKeyIds: target!.allowedKeyIds, receipt: receipt!.receipt,
          binding: { runId: String(input.snapshot.manifest.run_id), sessionId: target!.sessionId, targetManifestSha256: target!.manifestSha256, policyDigest: target!.attestationPolicyDigest! },
        }))) { problem(input.source.id, "invalid-media-proof"); continue; }
      } else if (!verifyBinaryAttestationSnapshot(input.snapshot.root, candidate.artifact.path, proof, candidate.snapshot, { trustKeys: trust.keys })) {
        problem(input.source.id, "invalid-media-proof"); continue;
      }
      const sameBytes = retainedDigests.get(proof.sourceSize + ":" + proof.sourceSha256);
      if (proof.decision === "sanitized" && (retainedNames.has(nameKey(proof.sourcePath)) || sameBytes && (sameBytes.size > 1 || !sameBytes.has(candidate.artifact.path)))) throw new ReportInputError("retained-raw-media", "検査済み出力の元媒体がHATEに残っているため入力を採用できません");
      if (candidate.artifact.classification === "restricted") continue;
      if (!targetPermitted) { problem(input.source.id, "invalid-media-target"); continue; }
      if (proof.schemaVersion === "lakda/binary-artifact-attestation/v1" && targets.some(target => target!.attestationPolicyDigest !== undefined)) {
        problem(input.source.id, "invalid-media-proof"); continue;
      }
      input.source.classification = maximumClassification([input.source.classification, ...targets.map(target => target!.classification), ...(receipt ? [receipt.classification] : [])]);
      verifiedIds.add(candidate.id);
      if (proof.decision === "sanitized") replacements.push({ sourceId: input.source.id, sourcePath: proof.sourcePath, sourceSize: proof.sourceSize, sourceSha256: proof.sourceSha256,
        mediaId: candidate.id, outputPath: candidate.artifact.path, outputSize: candidate.snapshot.size, outputSha256: candidate.snapshot.sha256 });
      const versionProof = proof.schemaVersion === "lakda/binary-artifact-attestation/v2"
        ? { schemaVersion: proof.schemaVersion, requestSha256: proof.requestSha256, receiptSha256: receipt!.sha256 } : { schemaVersion: proof.schemaVersion };
      proofs.set(candidate.id, { ...versionProof, decision: proof.decision, attestationSha256: input.snapshot.snapshots.get(BINARY_PROOF_REF)!.sha256,
        signedPayloadDigest: proof.signature.signedPayloadDigest, trustStoreSha256: trust.snapshot.sha256, keyIdDigest: "sha256:" + sha256(proof.signature.keyId), policyDigest: proof.tool.policyDigest,
        targetManifestSha256s: [...new Set(targets.map(target => target!.manifestSha256))].sort() });
    }
  }
  return { verifiedIds, proofs, replacements, issues };
}
