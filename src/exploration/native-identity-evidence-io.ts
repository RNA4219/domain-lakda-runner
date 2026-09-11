import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { NativeIdentityError } from "./native-identity-contracts.js";

const error = () => new NativeIdentityError("native-evidence-io-failed");
const identifier = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export const nativeEvidencePath = new RegExp(`^native-identity/${identifier}/[0-9]{6}\\.json$`);
const permitted = (path: string) => nativeEvidencePath.test(path) || ["session.json", "events.jsonl", "target-manifest.json", "charter.json"].includes(path);
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

async function boundary(root: string, relative: string) {
  if (!permitted(relative)) throw error();
  const absolute = resolve(root), parts = relative.split("/").slice(0, -1), directories = [absolute];
  for (const part of parts) directories.push(join(directories.at(-1)!, part));
  const identities: Array<{ path: string; dev: number; ino: number }> = [];
  for (const path of directories) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(path), path)) throw error();
    identities.push({ path, dev: info.dev, ino: info.ino });
  }
  return async () => {
    for (const identity of identities) {
      const info = await lstat(identity.path);
      if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino
        || !samePath(await realpath(identity.path), identity.path)) throw error();
    }
  };
}

export async function createNativeEvidenceDirectory(root: string, journalId: string): Promise<void> {
  if (!(new RegExp(`^${identifier}$`)).test(journalId)) throw error();
  const check = await boundary(root, "session.json");
  const base = join(resolve(root), "native-identity");
  try { await mkdir(base); } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "EEXIST") throw error(); }
  const info = await lstat(base);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(base), base)) throw error();
  await check();
  await mkdir(join(base, journalId));
  await boundary(root, `native-identity/${journalId}/000001.json`);
}

export async function readNativeEvidenceBytes(root: string, relative: string, limit: number, signal = AbortSignal.timeout(5000)): Promise<Buffer> {
  try {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 32 * 1024 * 1024) throw error();
    signal.throwIfAborted();
    const check = await boundary(root, relative), path = join(resolve(root), ...relative.split("/"));
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > limit) throw error();
    const handle = await open(path, "r");
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > limit) throw error();
      const chunks: Buffer[] = [];
      let offset = 0;
      while (true) {
        signal.throwIfAborted();
        const chunk = Buffer.alloc(Math.min(32768, limit + 1 - offset));
        const result = await handle.read(chunk, 0, chunk.length, offset);
        signal.throwIfAborted();
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
        if (offset > limit) throw error();
        chunks.push(chunk.subarray(0, result.bytesRead));
      }
      const bytes = Buffer.concat(chunks, offset);
      const after = await handle.stat(), named = await lstat(path);
      if (bytes.length > limit || bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || !named.isFile() || named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino) throw error();
      await check(); signal.throwIfAborted();
      return bytes;
    } finally { await handle.close(); }
  } catch { throw error(); }
}

export async function publishNativeEvidenceBytes(root: string, relative: string, bytes: Buffer, signal: AbortSignal): Promise<void> {
  if (!nativeEvidencePath.test(relative)) throw error();
  const check = await boundary(root, relative), destination = join(resolve(root), ...relative.split("/"));
  const temporary = join(dirname(destination), `.pending-${randomUUID()}`);
  let identity: { ino: number; dev: number } | undefined;
  try {
    signal.throwIfAborted();
    const handle = await open(temporary, "wx");
    try {
      identity = await handle.stat();
      await writeFile(handle, bytes, { signal });
      await handle.sync();
    } finally { await handle.close(); }
    await check(); signal.throwIfAborted();
    await link(temporary, destination);
    await check(); signal.throwIfAborted();
  } catch { throw error(); }
  finally {
    if (identity) {
      try {
        await check();
        const info = await lstat(temporary);
        if (info.isFile() && !info.isSymbolicLink() && info.ino === identity.ino && info.dev === identity.dev) await unlink(temporary);
      } catch { /* Preserve unconfirmed temporary files; the inventory verifier rejects them. */ }
    }
  }
}
