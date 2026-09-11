import { assertPortableArtifactRef } from "../runs/catalog-values.js";
import type { ManifestSnapshot } from "../runs/manifest-snapshot.js";
import { ReportInputError } from "./contracts.js";
import type { ReportMediaCandidate } from "./run-source.js";

/** Internal correspondence produced only after signature, output and applicable target verification. */
export type VerifiedMediaReplacement = {
  sourceId: string; sourcePath: string; sourceSize: number; sourceSha256: string;
  mediaId: string; outputPath: string; outputSize: number; outputSha256: string;
};

export function indexVerifiedMediaReplacements(input: { source: { id: string }; snapshot: ManifestSnapshot; mediaCandidates: ReportMediaCandidate[] }, replacements: readonly VerifiedMediaReplacement[]) {
  const candidates = new Map(input.mediaCandidates.map(candidate => [candidate.artifact.path, candidate]));
  const artifacts = new Map(input.snapshot.artifacts.map(artifact => [artifact.path, artifact]));
  const bySource = new Map<string, VerifiedMediaReplacement[]>();
  for (const replacement of replacements) {
    assertPortableArtifactRef(replacement.sourcePath); assertPortableArtifactRef(replacement.outputPath);
    const candidate = candidates.get(replacement.outputPath), artifact = artifacts.get(replacement.outputPath), snapshot = input.snapshot.snapshots.get(replacement.outputPath);
    if (replacement.sourceId !== input.source.id || candidate?.sourceId !== input.source.id || candidate.id !== replacement.mediaId || !artifact || !snapshot
      || replacement.outputSize !== snapshot.size || replacement.outputSha256 !== snapshot.sha256
      || replacement.outputSize !== artifact.size_bytes || replacement.outputSha256.replace(/^sha256:/, "") !== artifact.sha256.replace(/^sha256:/, "").toLowerCase()
      || replacement.outputSize !== candidate.snapshot.size || replacement.outputSha256 !== candidate.snapshot.sha256) {
      throw new ReportInputError("invalid-media-replacement", "検証済み媒体の対応先と入力snapshotが一致しません");
    }
    const matches = bySource.get(replacement.sourcePath) ?? [];
    matches.push(replacement); bySource.set(replacement.sourcePath, matches);
  }
  return bySource;
}
