import { expect, test } from "@playwright/test";
import { mkdir, open, writeFile, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { mock } from "node:test";
import { readNativeEvidenceBytes } from "../src/exploration/native-identity-evidence-io.js";

test("native evidence reads stop at the limit even when the file grows after its initial stat", async () => {
  const info = test.info();
  const root = info.outputPath("session");
  await mkdir(root, { recursive: true });
  const path = join(root, "session.json"), limit = 65536;
  await writeFile(path, "{}");
  const probe = await open(path, "r"), prototype = Object.getPrototypeOf(probe) as FileHandle;
  const originalStat = prototype.stat, originalRead = prototype.read;
  let grew = false, totalRead = 0;
  const sizes: number[] = [];
  const statMock = mock.method(prototype, "stat", async function(this: FileHandle, ...args: unknown[]) {
    const value = await Reflect.apply(originalStat, this, args) as Stats;
    if (!grew) { grew = true; await writeFile(path, Buffer.alloc(limit + 4096)); }
    return value;
  });
  const readMock = mock.method(prototype, "read", async function(this: FileHandle, buffer: Buffer, offset: number, length: number, position: number) {
    sizes.push(buffer.length);
    const result = await Reflect.apply(originalRead, this, [buffer, offset, length, position]) as { bytesRead: number; buffer: Buffer };
    totalRead += result.bytesRead;
    return result;
  });
  try {
    await expect(readNativeEvidenceBytes(root, "session.json", limit)).rejects.toThrow("native-evidence");
    expect(grew).toBe(true);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every(size => size <= 32768)).toBe(true);
    expect(totalRead).toBeLessThanOrEqual(limit + 1);
  } finally { statMock.mock.restore(); readMock.mock.restore(); await probe.close(); }
});

test("native evidence bytes obey exact limits, path restrictions and cancellation", async () => {
  const info = test.info();
  const root = info.outputPath("session");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "session.json"), "1234");
  expect((await readNativeEvidenceBytes(root, "session.json", 4)).toString()).toBe("1234");
  await expect(readNativeEvidenceBytes(root, "session.json", 3)).rejects.toThrow("native-evidence");
  await expect(readNativeEvidenceBytes(root, "../session.json", 100)).rejects.toThrow("native-evidence");
  const controller = new AbortController(); controller.abort();
  await expect(readNativeEvidenceBytes(root, "session.json", 100, controller.signal)).rejects.toThrow("native-evidence");
});
