import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { readArtifactSnapshot, type ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { assertPortableArtifactRef, isContained } from "../runs/catalog-values.js";
import { ATTESTATION_MESSAGE_MAX_BYTES, AttestationContractError } from "./attestation-contracts.js";

type Identity = { dev: bigint; ino: bigint };
export type AttestationMediaArea = "source" | "output" | "retained" | "original";
async function directoryIdentity(path: string): Promise<Identity> {
  const value = await lstat(path, { bigint: true });
  if (!value.isDirectory() || value.isSymbolicLink() || await realpath(path) !== path) throw new AttestationContractError("directory-invalid");
  return { dev: value.dev, ino: value.ino };
}

export class AttestationDirectory {
  private constructor(readonly root: string, readonly runDirectory: string, private readonly directories: Map<string, Identity>) {}

  static async create(stagingRoot: string, runDirectory: string): Promise<AttestationDirectory> {
    const parent = resolve(stagingRoot), run = resolve(runDirectory);
    await directoryIdentity(parent); const runIdentity = await directoryIdentity(run);
    if (isContained(run, parent)) throw new AttestationContractError("private-staging-inside-run");
    const root = await mkdtemp(join(parent, "lakda-attestation-"));
    const directories = new Map<string, Identity>([[run, runIdentity], [root, await directoryIdentity(root)]]);
    for (const ref of ["sources", "outputs", "originals", "attestations", "attestations/requests", "attestations/responses", "attestations/claims", "attestations/receipts"]) {
      const path = join(root, ref); await mkdir(path, { mode: 0o700 });
      directories.set(path, await directoryIdentity(path));
    }
    const result = new AttestationDirectory(root, run, directories);
    await result.assertOpen();
    return result;
  }

  async assertOpen(): Promise<void> {
    for (const [path, expected] of this.directories) {
      const current = await directoryIdentity(path);
      if (current.dev !== expected.dev || current.ino !== expected.ino) throw new AttestationContractError("directory-changed");
    }
    try { await lstat(join(this.runDirectory, "exports/artifact-manifest.json")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    throw new AttestationContractError("run-sealed");
  }

  private mediaRoot(area: AttestationMediaArea): string {
    return area === "retained" ? this.runDirectory : join(this.root, area === "source" ? "sources" : area === "original" ? "originals" : "outputs");
  }

  async mediaPath(area: AttestationMediaArea, ref: string, createParents = false): Promise<string> {
    await this.assertOpen(); assertPortableArtifactRef(ref);
    const root = this.mediaRoot(area);
    const path = resolve(root, ref);
    if (!isContained(root, path)) throw new AttestationContractError("media-path-invalid");
    let parent = root;
    for (const segment of ref.split("/").slice(0, -1)) {
      parent = join(parent, segment);
      if (createParents) {
        try { await mkdir(parent, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      const current = await directoryIdentity(parent), expected = this.directories.get(parent);
      if (expected && (current.dev !== expected.dev || current.ino !== expected.ino)) throw new AttestationContractError("directory-changed");
      this.directories.set(parent, current);
    }
    try {
      const value = await lstat(path);
      if (!value.isFile() || value.isSymbolicLink() || await realpath(path) !== path) throw new AttestationContractError("media-path-invalid");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await this.assertOpen();
    return path;
  }

  async readMedia(area: AttestationMediaArea, ref: string, expected: { size: number; sha256: string }, maxBytes: number, signal?: AbortSignal, check?: () => Promise<void>): Promise<ArtifactSnapshot> {
    const path = await this.mediaPath(area, ref);
    const snapshot = await readArtifactSnapshot(this.mediaRoot(area), ref, { expected, maxBytes, signal, check });
    if (snapshot.path !== path) throw new AttestationContractError("media-path-invalid");
    await this.assertOpen();
    signal?.throwIfAborted();
    return snapshot;
  }

  /** Transfer the actual source file into a fresh private archive; never delete it after copying. */
  async preserveOriginal(ref: string, requestId: string, check: () => Promise<void>): Promise<string> {
    if (!/^[0-9a-f-]{36}$/.test(requestId)) throw new AttestationContractError("request-invalid");
    await check();
    const source = await this.mediaPath("retained", ref), directory = join(this.mediaRoot("original"), requestId);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AttestationContractError("original-already-preserved");
      throw error;
    }
    this.directories.set(directory, await directoryIdentity(directory));
    const preservedRef = requestId + "/" + ref, destination = await this.mediaPath("original", preservedRef, true);
    try { await lstat(destination); throw new AttestationContractError("original-already-preserved"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await check();
    if (await this.mediaPath("retained", ref) !== source || await this.mediaPath("original", preservedRef) !== destination) throw new AttestationContractError("media-path-invalid");
    try { await rename(source, destination); }
    catch { throw new AttestationContractError("media-preservation-unavailable"); }
    await this.assertOpen(); await check();
    return preservedRef;
  }

  async write(ref: string, value: unknown): Promise<{ size: number; sha256: string }> {
    return this.writeBytes(this.root, ref, Buffer.from(canonicalJson(value) + "\n", "utf8"), ATTESTATION_MESSAGE_MAX_BYTES);
  }

  async writePublished(ref: string, bytes: Buffer, maxBytes: number, signal?: AbortSignal, check?: () => Promise<void>): Promise<{ size: number; sha256: string }> {
    if (ref !== "attestations/binary-artifacts.jsonl" && !/^attestations\/(?:receipts|results)\/[0-9a-f-]{36}\.json$/.test(ref)) throw new AttestationContractError("publication-path-invalid");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || bytes.length > maxBytes) throw new AttestationContractError("evidence-byte-limit");
    await this.mediaPath("retained", ref, true);
    return this.writeBytes(this.runDirectory, ref, bytes, maxBytes, signal, check);
  }

  private async writeBytes(root: string, ref: string, bytes: Buffer, maxBytes: number, signal?: AbortSignal, check?: () => Promise<void>): Promise<{ size: number; sha256: string }> {
    const active = async () => { signal?.throwIfAborted(); await check?.(); signal?.throwIfAborted(); };
    await active();
    assertPortableArtifactRef(ref);
    const path = resolve(root, ref);
    if (!isContained(root, path) || !this.directories.has(dirname(path))) throw new AttestationContractError("message-path-invalid");
    if (bytes.length > maxBytes) throw new AttestationContractError("message-too-large");
    await this.assertOpen();
    const temporary = join(dirname(path), ".pending-" + randomUUID());
    let created = false;
    try {
      const file = await open(temporary, "wx", 0o600); created = true;
      try {
        let offset = 0;
        while (offset < bytes.length) {
          await active();
          const { bytesWritten } = await file.write(bytes, offset, Math.min(65536, bytes.length - offset), offset);
          await active();
          if (!bytesWritten) throw new AttestationContractError("message-write-incomplete");
          offset += bytesWritten;
        }
      } finally { await file.close(); }
      await this.assertOpen();
      await active();
      await link(temporary, path);
      await active();
      return { size: bytes.length, sha256: "sha256:" + sha256(bytes) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AttestationContractError("message-already-exists");
      throw error;
    } finally {
      if (created) {
        try { await this.assertOpen(); await unlink(temporary); }
        catch { /* Preserve uncertain files rather than following a changed directory. */ }
      }
    }
  }

  async read(ref: string, expected?: { size: number; sha256: string }): Promise<ArtifactSnapshot | undefined> {
    await this.assertOpen(); assertPortableArtifactRef(ref);
    const path = resolve(this.root, ref);
    if (!isContained(this.root, path) || !this.directories.has(dirname(path))) throw new AttestationContractError("message-path-invalid");
    try { if ((await lstat(path)).isSymbolicLink()) throw new AttestationContractError("message-path-invalid"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    const snapshot = await readArtifactSnapshot(this.root, ref, { retain: true, maxBytes: ATTESTATION_MESSAGE_MAX_BYTES, ...(expected ? { expected } : {}) });
    if (snapshot.path !== path) throw new AttestationContractError("message-path-invalid");
    await this.assertOpen();
    return snapshot;
  }
}
