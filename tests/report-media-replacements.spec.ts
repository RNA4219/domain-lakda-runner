import { expect, test } from "@playwright/test";
import { ADAPTIVE_SCHEMA_VERSION, type EvidenceArtifactRef } from "../src/adaptive/contracts.js";
import { buildEvidenceIndex } from "../src/reporting/evidence-index.js";

const reference: EvidenceArtifactRef = { schemaVersion: ADAPTIVE_SCHEMA_VERSION, artifactId: "adapter:original", path: "artifacts/original.png", size: 100, sha256: "sha256:" + "a".repeat(64), classification: "internal", redactionStatus: "pending", securityStatus: "not_applicable" };
function fixture(count = 1, ref = reference) {
  const sourceId = "run:fixture:1";
  const candidates = Array.from({ length: count }, (_, index) => {
    const path = `artifacts/output-${index}.png`, sha256 = "sha256:" + "b".repeat(64);
    const artifact = { artifact_id: `hate:output-${index}`, kind: "screenshot", path, size_bytes: 50, sha256, classification: "internal", redaction_status: "redacted", public_exposure: "none", security_checks: { secrets_scan: "pass", pii_scan: "pass" } };
    return { id: `media-${index}`, sourceId, runKey: sourceId, artifact, root: "/fixture", snapshot: { path: "/fixture/" + path, size: 50, sha256 } };
  });
  const input: Parameters<typeof buildEvidenceIndex>[0] = { source: { id: sourceId }, mediaCandidates: candidates,
    snapshot: { root: "/fixture", manifest: {}, manifestSha256: "sha256:" + "c".repeat(64), artifacts: candidates.map(value => value.artifact), snapshots: new Map(candidates.map(value => [value.artifact.path, value.snapshot])), verifiedArtifactBytes: count * 50, retainedTextBytes: 0 },
    evidence: { records: new Map([["full", [ref]], ["bookmark", [ref.artifactId]]]), oracles: [] } };
  const replacements = candidates.map(value => ({ sourceId, sourcePath: reference.path, sourceSize: reference.size, sourceSha256: reference.sha256,
    mediaId: value.id, outputPath: value.artifact.path, outputSize: value.snapshot.size, outputSha256: value.snapshot.sha256 }));
  return { input, replacements };
}

test("verified replacements resolve full references and explicit aliases to the existing output", () => {
  const { input, replacements } = fixture(); const index = buildEvidenceIndex(input, replacements);
  const target = index.targets.get(replacements[0].outputPath);
  expect(index.resolve(reference)).toBe(target); expect(index.resolve(reference.artifactId)).toBe(target);
  expect(index.resolve("hate:output-0")).toBe(target); expect(index.targets).toHaveProperty("size", 1);
  expect(index.resolve({ ...reference, sha256: "a".repeat(64) })).toBe(target);
  expect(index.resolve("hate:original")).toBeUndefined(); expect(index.resolve(reference.path)).toBeUndefined();
  expect(buildEvidenceIndex(input).resolve(reference)).toBeUndefined();
});

test("wrong source size or digest is rejected while an unknown source remains unavailable", () => {
  for (const change of [{ size: 101 }, { sha256: "sha256:" + "d".repeat(64) }, { redactionStatus: "failed" as const }, { securityStatus: "fail" as const }]) {
    const { input, replacements } = fixture(1, { ...reference, ...change });
    expect(() => buildEvidenceIndex(input, replacements)).toThrow(/参照/);
  }
  const { input, replacements } = fixture(1, { ...reference, path: "artifacts/unknown.png" });
  expect(buildEvidenceIndex(input, replacements).resolve(reference.artifactId)).toBeUndefined();
});

test("replacement output binding accepts the existing HATE digest prefix and case variants", () => {
  const { input, replacements } = fixture();
  input.snapshot.artifacts[0].sha256 = "B".repeat(64);
  expect(buildEvidenceIndex(input, replacements).resolve(reference)).toMatchObject({ mediaId: "media-0" });
});

test("ambiguous replacements stay unresolved and propagate restricted classification to every output", () => {
  const { input, replacements } = fixture(2, { ...reference, classification: "restricted" }); const index = buildEvidenceIndex(input, replacements);
  expect(index.resolve(reference.artifactId)).toBeUndefined();
  expect([...index.targets.values()].map(target => target.classification)).toEqual(["restricted", "restricted"]);
});

test("replacements must belong to the same source and its exact existing output", () => {
  for (const change of [{ sourceId: "run:other:1" }, { mediaId: "media-other" }, { outputPath: "artifacts/absent.png" }, { outputSize: 51 }, { outputSha256: "sha256:" + "d".repeat(64) }]) {
    const { input, replacements } = fixture();
    expect(() => buildEvidenceIndex(input, [{ ...replacements[0], ...change }])).toThrow();
  }
});

test("conflicting full-reference aliases cannot select one of two different outputs", () => {
  const { input, replacements } = fixture(2);
  replacements[1].sourcePath = "artifacts/second.png";
  input.evidence!.records.set("other", [{ ...reference, path: replacements[1].sourcePath }]);
  const index = buildEvidenceIndex(input, replacements);
  expect(index.resolve(reference)).toMatchObject({ mediaId: "media-0" });
  expect(index.resolve(reference.artifactId)).toBeUndefined();
});
