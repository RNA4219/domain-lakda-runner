import { lstat, readdir, realpath } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { AttestationContractError, type BinaryMediaType } from "./attestation-contracts.js";

export type AttestationSource = { path: string; size: number; sha256: string; mediaType: BinaryMediaType };
const mediaTypes: Record<string, BinaryMediaType> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4", ".zip": "application/zip" };

/** Inventory only finalized files; aliases and non-regular capture entries are not followed. */
export async function inventoryAttestationSources(runDirectory: string, maxBytes: number, check: () => Promise<void>): Promise<AttestationSource[]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new AttestationContractError("media-byte-limit");
  const root = resolve(runDirectory), sources: AttestationSource[] = [];
  let total = 0;
  const walk = async (ref: string) => {
    await check();
    const directory = join(root, ref), entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(directory) !== directory) throw new AttestationContractError("media-path-invalid");
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const item of entries) {
      await check();
      const path = ref ? ref + "/" + item.name : item.name;
      if (item.isSymbolicLink()) throw new AttestationContractError("media-path-invalid");
      if (item.isDirectory()) { if (path !== "exports") await walk(path); continue; }
      if (!item.isFile()) throw new AttestationContractError("media-path-invalid");
      const mediaType = mediaTypes[extname(item.name).toLowerCase()];
      if (!mediaType) continue;
      const snapshot = await readArtifactSnapshot(root, path, { maxBytes: maxBytes - total, check });
      if (snapshot.path !== resolve(root, path) || snapshot.size === 0) throw new AttestationContractError("media-path-invalid");
      total += snapshot.size;
      if (!Number.isSafeInteger(total) || total > maxBytes) throw new AttestationContractError("media-byte-limit");
      sources.push({ path, size: snapshot.size, sha256: snapshot.sha256, mediaType });
    }
  };
  await walk(""); await check(); return sources;
}
