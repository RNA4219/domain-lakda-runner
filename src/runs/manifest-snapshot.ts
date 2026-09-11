import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertHateManifest } from "../core/hate.js";
import { readArtifactSnapshot, type ArtifactSnapshot } from "./artifact-snapshot.js";
import { assertPortableArtifactRef, object, parseJson, type HateArtifact, type JsonObject } from "./catalog-values.js";

export const MANIFEST_REF = "exports/artifact-manifest.json";
export type ManifestArtifact = HateArtifact & JsonObject;
export type ManifestReadOptions = {
  retain?: (ref: string) => boolean;
  textLimit?: number;
  artifactLimit?: number;
  signal?: AbortSignal;
  policy?: (artifact: ManifestArtifact, index: number) => unknown;
};
export type ManifestSnapshot = {
  root: string;
  manifest: JsonObject;
  manifestSha256: string;
  artifacts: ManifestArtifact[];
  snapshots: Map<string, ArtifactSnapshot>;
  verifiedArtifactBytes: number;
  retainedTextBytes: number;
};

/** Read-only integrity checks. Publication eligibility belongs to the caller. */
export async function readManifestSnapshot(runDir: string, options: ManifestReadOptions = {}): Promise<ManifestSnapshot> {
  options.signal?.throwIfAborted();
  let root: string;
  try { root = await realpath(resolve(runDir)); } catch { throw new Error("run directory does not exist"); }
  if (!(await stat(root)).isDirectory()) throw new Error("run directory is not a directory");
  const textLimit = options.textLimit ?? Infinity;
  const artifactLimit = options.artifactLimit ?? Infinity;
  for (const limit of [textLimit, artifactLimit]) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error("invalid artifact byte limit");
  }
  const source = await readArtifactSnapshot(root, MANIFEST_REF, { retain: true, maxBytes: textLimit, signal: options.signal });
  const value = parseJson(source.bytes!, "HATE manifest");
  assertHateManifest(value);
  const manifest = object(value, "HATE manifest");
  const artifacts = manifest.artifacts as ManifestArtifact[];
  if (artifacts.length === 0) throw new Error("HATE manifest has no artifacts");
  const refs = new Set<string>();
  let verifiedArtifactBytes = 0;
  let retainedTextBytes = source.size;
  for (const [index, artifact] of artifacts.entries()) {
    assertPortableArtifactRef(artifact.path);
    if (artifact.path === MANIFEST_REF || refs.has(artifact.path)) throw new Error("HATE manifest contains a duplicate or self reference");
    refs.add(artifact.path);
    if (!Number.isSafeInteger(artifact.size_bytes)) throw new Error("HATE artifact size_bytes must be a safe integer");
    verifiedArtifactBytes += artifact.size_bytes;
    if (!Number.isSafeInteger(verifiedArtifactBytes) || verifiedArtifactBytes > artifactLimit) throw new Error("artifact byte limit exceeded");
    if (options.retain?.(artifact.path)) retainedTextBytes += artifact.size_bytes;
    if (!Number.isSafeInteger(retainedTextBytes) || retainedTextBytes > textLimit) throw new Error("structured text byte limit exceeded");
    options.policy?.(artifact, index);
  }
  const snapshots = new Map<string, ArtifactSnapshot>();
  for (const artifact of artifacts) {
    snapshots.set(artifact.path, await readArtifactSnapshot(root, artifact.path, {
      expected: { size: artifact.size_bytes, sha256: artifact.sha256 },
      retain: options.retain?.(artifact.path) ?? false,
      maxBytes: artifact.size_bytes,
      signal: options.signal,
    }));
  }
  // Detect a producer replacing the manifest while its artifacts are inspected.
  await readArtifactSnapshot(root, MANIFEST_REF, { expected: { size: source.size, sha256: source.sha256 }, signal: options.signal });
  return { root, manifest, manifestSha256: source.sha256, artifacts, snapshots, verifiedArtifactBytes, retainedTextBytes };
}
