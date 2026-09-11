import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { secureArtifactFile } from "./catalog-values.js";

export type SnapshotOptions = {
  retain?: boolean;
  maxBytes?: number;
  expected?: { size: number; sha256: string };
  signal?: AbortSignal;
  check?: () => Promise<void>;
};

export type ArtifactSnapshot = { path: string; size: number; sha256: string; bytes?: Buffer };

/** Verify one immutable artifact without buffering media. Policy is a separate caller concern. */
export async function readArtifactSnapshot(root: string, ref: string, options: SnapshotOptions = {}): Promise<ArtifactSnapshot> {
  const check = async () => { options.signal?.throwIfAborted(); await options.check?.(); options.signal?.throwIfAborted(); };
  await check();
  const path = await secureArtifactFile(root, ref);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error("HATE artifact changed during inspection: " + ref);
  }
  const limit = options.maxBytes ?? Infinity;
  if (limit < 0 || Number.isNaN(limit) || before.size > limit) throw new Error("artifact byte limit exceeded: " + ref);
  const mismatch = () => new Error("HATE artifact bytes/hash mismatch: " + ref);
  if (options.expected && before.size !== options.expected.size) throw mismatch();
  await check();
  const file = await open(path, "r");
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error("HATE artifact changed during open: " + ref);
    }
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let size = 0;
    const buffer = Buffer.allocUnsafe(65_536);
    for (;;) {
      await check();
      const { bytesRead } = await file.read(buffer, 0, buffer.length, size);
      await check();
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > limit) throw new Error("artifact byte limit exceeded: " + ref);
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      if (options.retain) chunks.push(Buffer.from(bytes));
    }
    await check();
    const unchanged = async () => {
      const after = await file.stat(), current = await lstat(path);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
        || current.dev !== before.dev || current.ino !== before.ino || !current.isFile()
        || await realpath(path) !== path || await secureArtifactFile(root, ref) !== path || size !== before.size) {
        throw new Error("HATE artifact changed during inspection: " + ref);
      }
    };
    await unchanged();
    const sha256 = "sha256:" + hash.digest("hex");
    if (options.expected && sha256 !== "sha256:" + options.expected.sha256.replace(/^sha256:/, "").toLowerCase()) throw mismatch();
    if (options.check) { await check(); await unchanged(); }
    options.signal?.throwIfAborted();
    return { path, size, sha256, ...(options.retain ? { bytes: Buffer.concat(chunks, size) } : {}) };
  } finally {
    await file.close();
  }
}
