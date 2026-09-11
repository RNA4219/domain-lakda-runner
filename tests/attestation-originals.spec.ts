import fs, { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { sha256 } from "../src/core/redaction.js";
import { createAttestationRequest } from "../src/exploration/attestation-contracts.js";
import { AttestationDirectory } from "../src/exploration/attestation-io.js";
import { quarantineAttestationSource } from "../src/exploration/attestation-media.js";

const roots: string[] = [];
test.afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("lakda-attestation-originals-")) throw new Error("unexpected fixture root");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "lakda-attestation-originals-")); roots.push(root);
  const run = join(root, "run"), sourcePath = "artifacts/capture.png", bytes = Buffer.alloc(131_072, 42);
  await mkdir(join(run, "artifacts"), { recursive: true }); await writeFile(join(run, sourcePath), bytes);
  const request = createAttestationRequest({ runId: "original-fixture", targetManifestSha256: "sha256:" + "a".repeat(64),
    sourcePath, sourceSize: bytes.length, sourceSha256: "sha256:" + sha256(bytes), mediaType: "image/png", policyDigest: "sha256:" + "b".repeat(64) });
  const io = await AttestationDirectory.create(root, run);
  return { root, run, io, request, bytes, source: join(run, sourcePath), copied: join(io.root, "sources", sourcePath),
    original: join(io.root, "originals", request.requestId, sourcePath), options: { maxBytes: 262_144 } };
}

test("quarantine keeps the original file identity privately as well as the independent inspection copy", async () => {
  const value = await fixture(), before = await lstat(value.source, { bigint: true });
  await quarantineAttestationSource(value.io, value.request, value.options);
  const preserved = await lstat(value.original, { bigint: true }), copied = await lstat(value.copied, { bigint: true });
  expect([preserved.dev, preserved.ino]).toEqual([before.dev, before.ino]);
  expect([copied.dev, copied.ino]).not.toEqual([before.dev, before.ino]);
  expect(await readFile(value.original)).toEqual(value.bytes); expect(await readFile(value.copied)).toEqual(value.bytes);
  await expect(readFile(value.source)).rejects.toThrow(/ENOENT/);
});

for (const mode of ["in-place", "replacement"] as const) test("quarantine preserves " + mode + " updates occurring after the last source stat", async () => {
  const value = await fixture(), realStat = fs.lstat, changed = Buffer.alloc(value.bytes.length, 43);
  let checks = 0, updated = false;
  fs.lstat = (async (...args: Parameters<typeof realStat>) => {
    const result = await realStat(...args);
    if (String(args[0]) === value.source && args[1]?.bigint && ++checks === 2) {
      if (mode === "replacement") await rename(value.source, join(value.root, "displaced.png"));
      await writeFile(value.source, changed); updated = true;
    }
    return result;
  }) as typeof realStat;
  syncBuiltinESMExports();
  try { await expect(quarantineAttestationSource(value.io, value.request, value.options)).rejects.toThrow(/changed|mismatch|digest/); }
  finally { fs.lstat = realStat; syncBuiltinESMExports(); }
  expect(updated).toBe(true);
  expect(await readFile(value.original)).toEqual(changed); expect(await readFile(value.copied)).toEqual(value.bytes);
  await expect(readFile(value.source)).rejects.toThrow(/ENOENT/);
  if (mode === "replacement") expect(await readFile(join(value.root, "displaced.png"))).toEqual(value.bytes);
});

test("an existing original archive is not reused or overwritten", async () => {
  const value = await fixture(), existing = Buffer.from("previously preserved evidence");
  await mkdir(dirname(value.original), { recursive: true }); await writeFile(value.original, existing);
  await expect(quarantineAttestationSource(value.io, value.request, value.options)).rejects.toThrow(/original-already-preserved/);
  expect(await readFile(value.source)).toEqual(value.bytes); expect(await readFile(value.original)).toEqual(existing);
  expect(await readFile(value.copied)).toEqual(value.bytes);
});

test("failed original transfer never falls back to deleting its source", async () => {
  for (const code of ["EXDEV", "EACCES", "EPERM"]) {
    const value = await fixture(), realRename = fs.rename; let attempted = false;
    fs.rename = async (...args) => {
      if (String(args[0]) === value.source) { attempted = true; throw Object.assign(new Error("fixture transfer failure"), { code }); }
      return realRename(...args);
    };
    syncBuiltinESMExports();
    try { await expect(quarantineAttestationSource(value.io, value.request, value.options), code).rejects.toThrow(/media-preservation-unavailable/); }
    finally { fs.rename = realRename; syncBuiltinESMExports(); }
    expect(attempted).toBe(true); expect(await readFile(value.source)).toEqual(value.bytes); expect(await readFile(value.copied)).toEqual(value.bytes);
    await expect(readFile(value.original)).rejects.toThrow(/ENOENT/);
  }
});

test("a stop or expiry immediately after transfer preserves the original and inspection copy", async () => {
  for (const mode of ["stop", "expiry"] as const) {
    const value = await fixture(), realRename = fs.rename, controller = new AbortController();
    let moved = false, now = Date.parse(value.request.createdAt) + 1, stoppedAt = 0;
    fs.rename = async (...args) => {
      await realRename(...args);
      if (String(args[0]) === value.source) {
        moved = true; stoppedAt = performance.now();
        if (mode === "stop") controller.abort(); else now = Date.parse(value.request.expiresAt);
      }
    };
    syncBuiltinESMExports();
    try { await expect(quarantineAttestationSource(value.io, value.request, { ...value.options, signal: controller.signal, clock: () => now })).rejects.toThrow(); }
    finally { fs.rename = realRename; syncBuiltinESMExports(); }
    expect(moved).toBe(true); expect(performance.now() - stoppedAt).toBeLessThan(1000);
    expect(await readFile(value.original)).toEqual(value.bytes); expect(await readFile(value.copied)).toEqual(value.bytes);
    await expect(readFile(value.source)).rejects.toThrow(/ENOENT/);
  }
});

test("a stop before transfer keeps the source at its original path", async () => {
  const value = await fixture(), controller = new AbortController(); let stoppedAt = 0;
  await expect(quarantineAttestationSource(value.io, value.request, { ...value.options, signal: controller.signal, check: async () => {
    try { await lstat(dirname(value.original)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    stoppedAt = performance.now(); controller.abort();
  } })).rejects.toThrow();
  expect(stoppedAt).toBeGreaterThan(0); expect(performance.now() - stoppedAt).toBeLessThan(1000);
  expect(await readFile(value.source)).toEqual(value.bytes); expect(await readFile(value.copied)).toEqual(value.bytes);
  await expect(readFile(value.original)).rejects.toThrow(/ENOENT/);
});
