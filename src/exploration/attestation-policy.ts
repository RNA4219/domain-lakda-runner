import { resolve } from "node:path";
import { readArtifactSnapshot, type ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { ATTESTATION_MESSAGE_MAX_BYTES, AttestationContractError } from "./attestation-contracts.js";
import { readAttestationResults, type BinaryAttestationResult } from "./attestation-results.js";
import type { AttestationBinding } from "./attestation-evidence.js";

type File = { path: string; size: number; sha256: string };

export async function readPublishedAttestationResults(runDirectory: string, files: readonly File[], binding: AttestationBinding, summary?: unknown): Promise<BinaryAttestationResult[]> {
  const snapshots = new Map<string, ArtifactSnapshot>();
  for (const file of files) {
    if (!/^attestations\/(results|receipts)\//.test(file.path)) continue;
    const snapshot = await readArtifactSnapshot(resolve(runDirectory), file.path, { expected: file, retain: true, maxBytes: ATTESTATION_MESSAGE_MAX_BYTES });
    if (snapshot.path !== resolve(runDirectory, file.path)) throw new AttestationContractError("result-path-invalid");
    snapshots.set(file.path, snapshot);
  }
  return readAttestationResults(snapshots, binding, summary);
}

/** Missing media stays missing; these records only explain why an error run retained no media. */
export function checkAttestationResultMedia(results: readonly BinaryAttestationResult[], files: readonly File[]): string[] {
  const paths = new Map(files.map(file => [file.path, file])), hashes = new Map<string, Set<string>>(), unavailable: string[] = [];
  for (const file of files) {
    const key = `${file.size}:${file.sha256}`, aliases = hashes.get(key) ?? new Set<string>();
    aliases.add(file.path); hashes.set(key, aliases);
  }
  for (const result of results) {
    const { request, artifact } = result;
    if (result.adoption === "adopted") {
      const file = artifact && paths.get(artifact.path);
      if (!file || file.size !== artifact!.size || file.sha256 !== artifact!.sha256) throw new AttestationContractError("result-artifact-mismatch");
    } else unavailable.push(request.sourcePath);
    if (result.adoption !== "adopted" || artifact!.path === request.outputPath) {
      const aliases = hashes.get(`${request.sourceSize}:${request.sourceSha256}`), allowed = artifact?.path;
      if (paths.has(request.sourcePath) || (!allowed && paths.has(request.outputPath))
        || (aliases && (aliases.size > 1 || !aliases.has(allowed ?? "")))) throw new AttestationContractError("raw-media-retained");
    }
  }
  return unavailable;
}
