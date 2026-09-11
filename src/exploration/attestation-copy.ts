import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AttestationContractError } from "./attestation-contracts.js";
import type { AttestationDirectory, AttestationMediaArea } from "./attestation-io.js";

export type AttestationMediaOptions = { maxBytes: number; signal?: AbortSignal; check?: () => Promise<void>; clock?: () => number };
export type AttestationMediaRef = { area: AttestationMediaArea; ref: string };
export type AttestationMediaDigest = { size: number; sha256: string };

export async function checkAttestationMedia(options: AttestationMediaOptions): Promise<void> {
  options.signal?.throwIfAborted();
  await options.check?.();
  options.signal?.throwIfAborted();
}

export function assertAttestationMediaLimit(expected: AttestationMediaDigest, options: AttestationMediaOptions): void {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || !Number.isSafeInteger(expected.size)
    || expected.size < 1 || expected.size > options.maxBytes) throw new AttestationContractError("media-byte-limit");
}

/** Copy verified bytes to a new name; never replace a pre-existing file or buffer the full media. */
export async function copyAttestationMedia(io: AttestationDirectory, from: AttestationMediaRef, to: AttestationMediaRef,
  expected: AttestationMediaDigest, options: AttestationMediaOptions): Promise<AttestationMediaDigest> {
  assertAttestationMediaLimit(expected, options); await checkAttestationMedia(options);
  const sourcePath = await io.mediaPath(from.area, from.ref), destinationPath = await io.mediaPath(to.area, to.ref, true);
  const before = await lstat(sourcePath);
  if (!before.isFile() || before.size !== expected.size) throw new AttestationContractError("media-bytes-changed");
  const temporary = join(dirname(destinationPath), ".pending-media-" + randomUUID());
  const source = await open(sourcePath, "r");
  let created = false, linked = false, complete = false;
  let written: { dev: number; ino: number } | undefined;
  try {
    const opened = await source.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new AttestationContractError("media-bytes-changed");
    const destination = await open(temporary, "wx", 0o600); created = true;
    const hash = createHash("sha256"); let size = 0;
    try {
      written = await destination.stat();
      const buffer = Buffer.allocUnsafe(65_536);
      for (;;) {
        await checkAttestationMedia(options);
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
        await checkAttestationMedia(options);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > expected.size) throw new AttestationContractError("media-bytes-changed");
        hash.update(buffer.subarray(0, bytesRead));
        let offset = 0;
        while (offset < bytesRead) {
          await checkAttestationMedia(options);
          const { bytesWritten } = await destination.write(buffer, offset, bytesRead - offset, null);
          await checkAttestationMedia(options);
          if (!bytesWritten) throw new AttestationContractError("media-write-incomplete");
          offset += bytesWritten;
        }
      }
    } finally { await destination.close(); }
    const sha256 = "sha256:" + hash.digest("hex"), after = await source.stat(), current = await lstat(sourcePath);
    if (size !== expected.size || sha256 !== expected.sha256 || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino
      || await io.mediaPath(from.area, from.ref) !== sourcePath) throw new AttestationContractError("media-bytes-changed");
    await checkAttestationMedia(options);
    if (await io.mediaPath(to.area, to.ref) !== destinationPath) throw new AttestationContractError("media-path-invalid");
    await link(temporary, destinationPath); linked = true;
    await io.readMedia(to.area, to.ref, expected, options.maxBytes, options.signal, () => checkAttestationMedia(options));
    await checkAttestationMedia(options);
    complete = true;
    return { size, sha256 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AttestationContractError("media-already-exists");
    throw error;
  } finally {
    await source.close();
    if (created) {
      try {
        await io.assertOpen();
        if (linked && !complete && written) {
          const current = await lstat(destinationPath);
          if (current.dev === written.dev && current.ino === written.ino) await unlink(destinationPath);
        }
        await unlink(temporary);
      } catch { /* Preserve files when their directory or identity can no longer be established. */ }
    }
  }
}
