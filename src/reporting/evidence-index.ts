import { canonicalJson } from "../core/plan.js";
import type { EvidenceArtifactRef, OracleResult } from "../adaptive/contracts.js";
import { assertPortableArtifactRef } from "../runs/catalog-values.js";
import type { ManifestSnapshot } from "../runs/manifest-snapshot.js";
import { ReportInputError } from "./contracts.js";
import type { ReportEvidence, ReportEvidenceRef } from "./evidence-history.js";
import { maximumClassification } from "./projection-values.js";
import { indexVerifiedMediaReplacements, type VerifiedMediaReplacement } from "./media-replacements.js";
import type { ReportMediaCandidate } from "./run-source.js";
import type { Classification } from "./types.js";

export type EvidenceTarget = { key: string; path: string; sourceId: string; runKey: string | null; mediaId?: string; classification: Classification };
export type EvidenceIndex = ReturnType<typeof buildEvidenceIndex>;
export function buildEvidenceIndex(input: { source: { id: string }; snapshot: ManifestSnapshot; mediaCandidates: ReportMediaCandidate[]; evidence?: ReportEvidence }, replacements: readonly VerifiedMediaReplacement[] = []) {
  const artifacts = new Map(input.snapshot.artifacts.map(artifact => [artifact.path, artifact]));
  const candidates = new Map(input.mediaCandidates.map(candidate => [candidate.artifact.path, candidate]));
  const replacementIndex = indexVerifiedMediaReplacements(input, replacements);
  const targets = new Map<string, EvidenceTarget>();
  const aliases = new Map<string, Set<string>>();
  const oracles = new Map<string, Map<string, OracleResult>>();
  const resolvedRefs = new WeakMap<EvidenceArtifactRef, EvidenceTarget | undefined>();
  const alias = (id: string, path: string) => { if (!aliases.has(id)) aliases.set(id, new Set()); aliases.get(id)!.add(path); };
  for (const artifact of input.snapshot.artifacts) {
    const candidate = candidates.get(artifact.path);
    targets.set(artifact.path, { key: input.source.id + "\0" + artifact.path, path: artifact.path, sourceId: input.source.id, runKey: candidate?.runKey ?? null, ...(candidate ? { mediaId: candidate.id } : {}), classification: artifact.classification as Classification });
    if (typeof artifact.artifact_id === "string") alias(artifact.artifact_id, artifact.path);
  }
  const full = (ref: EvidenceArtifactRef): EvidenceTarget | undefined => {
    if (resolvedRefs.has(ref)) return resolvedRefs.get(ref);
    assertPortableArtifactRef(ref.path);
    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.size) || ref.size < 0) throw new ReportInputError("invalid-evidence-reference", "証跡参照のdigestまたは容量が不正です");
    const artifact = artifacts.get(ref.path), direct = targets.get(ref.path), replacements = replacementIndex.get(ref.path);
    if (!artifact && !replacements) { resolvedRefs.set(ref, undefined); return undefined; }
    const digest = ref.sha256.replace(/^sha256:/, "");
    const mismatch = () => new ReportInputError("evidence-reference-mismatch", "保存済み証跡の参照と検証済み媒体が一致しません");
    if (ref.redactionStatus === "failed" || ref.securityStatus === "fail") throw mismatch();
    let matched: EvidenceTarget[];
    if (artifact) {
      const snapshot = input.snapshot.snapshots.get(ref.path);
      if (!direct || !snapshot || ref.size !== snapshot.size || digest !== snapshot.sha256.replace(/^sha256:/, "") || ref.size !== artifact.size_bytes || digest !== artifact.sha256.replace(/^sha256:/, "")) throw mismatch();
      matched = [direct];
    } else {
      matched = replacements!.filter(value => value.sourceSize === ref.size && value.sourceSha256.replace(/^sha256:/, "") === digest).map(value => targets.get(value.outputPath)!);
      if (!matched.length) throw mismatch();
    }
    for (const target of matched) target.classification = maximumClassification([target.classification, ref.classification]);
    const target = matched.length === 1 ? matched[0] : undefined;
    resolvedRefs.set(ref, target);
    return target;
  };
  for (const oracle of input.evidence?.oracles ?? []) {
    if (!oracles.has(oracle.oracleId)) oracles.set(oracle.oracleId, new Map());
    oracles.get(oracle.oracleId)!.set(canonicalJson(oracle), oracle);
  }
  const refs = [...(input.evidence?.records.values() ?? []), ...(input.evidence?.oracles.map(oracle => oracle.evidenceRefs) ?? [])];
  for (const group of refs) for (const ref of group) if (typeof ref !== "string") { const target = full(ref); alias(ref.artifactId, target?.path ?? ref.path); }
  const resolve = (ref: ReportEvidenceRef): EvidenceTarget | undefined => {
    if (typeof ref !== "string") return full(ref);
    const paths = aliases.get(ref);
    return paths?.size === 1 ? targets.get(paths.values().next().value!) : undefined;
  };
  return { sourceId: input.source.id, targets, oracles, resolve };
}
