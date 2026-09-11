import { appendFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readArtifactSnapshot } from "../src/runs/artifact-snapshot.js";
import { inventoryAttestationSources } from "../src/exploration/attestation-inventory.js";
import { prepareBinaryAttestationRun } from "../src/exploration/attestation-preflight.js";
import { completeBinaryAttestationRun } from "../src/exploration/attestation-run.js";
import { AttestationDirectory } from "../src/exploration/attestation-io.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "lakda-attestation-io-stop-")); roots.push(root);
  await mkdir(join(root, "artifacts"));
  const ref = "artifacts/large.png", bytes = Buffer.alloc(2 * 1024 * 1024, 42);
  await writeFile(join(root, ref), bytes); return { root, ref, bytes };
}
async function handoffFixture() {
  const root = await mkdtemp(join(tmpdir(), "lakda-attestation-io-stop-")); roots.push(root);
  const run = join(root, "public/run"), privateRoot = join(root, "private"), trustPath = join(root, "keys.json"), key = generateKeyPairSync("ed25519");
  await mkdir(join(run, "artifacts"), { recursive: true }); await mkdir(privateRoot);
  await writeFile(trustPath, JSON.stringify([{ keyId: "fixture", publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString() }]));
  const bytes = Buffer.alloc(262_144, 42); await writeFile(join(run, "artifacts/large.png"), bytes);
  const prepared = await prepareBinaryAttestationRun({ stagingRoot: privateRoot, timeoutMs: 1000, targetManifestSha256: "sha256:" + "a".repeat(64), policyDigest: "sha256:" + "b".repeat(64) }, run, "fixture-run", trustPath, ["fixture"], true);
  return { root, run, bytes, prepared };
}
test.afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("lakda-attestation-io-stop-")) throw new Error("unexpected fixture root");
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot reading checks cancellation between chunks and preserves the original bytes", async () => {
  const input = await fixture(), stopped = new Error("fixture-stop"); let checks = 0, stoppedAt = 0;
  await expect(readArtifactSnapshot(input.root, input.ref, { maxBytes: input.bytes.length, check: async () => {
    if (++checks === 4) { stoppedAt = performance.now(); throw stopped; }
  } })).rejects.toBe(stopped);
  expect(performance.now() - stoppedAt).toBeLessThan(1000);
  expect(await readFile(join(input.root, input.ref))).toEqual(input.bytes);
  expect((await readArtifactSnapshot(input.root, input.ref)).size).toBe(input.bytes.length);
});

test("inventory carries its stop check into the hash of a single large capture", async () => {
  const input = await fixture(), stopped = new Error("inventory-stop"); let checks = 0, stoppedAt = 0;
  await expect(inventoryAttestationSources(input.root, input.bytes.length, async () => {
    if (++checks === 8) { stoppedAt = performance.now(); throw stopped; }
  })).rejects.toBe(stopped);
  expect(performance.now() - stoppedAt).toBeLessThan(1000);
  expect(await readFile(join(input.root, input.ref))).toEqual(input.bytes);
});

test("a source resized at any asynchronous read checkpoint cannot satisfy its original snapshot", async () => {
  const input = await fixture(), bytes = Buffer.alloc(131_072, 42);
  await writeFile(join(input.root, input.ref), bytes);
  const expected = { size: bytes.length, sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex") };
  let checkpoints = 0;
  await readArtifactSnapshot(input.root, input.ref, { expected, check: async () => { checkpoints += 1; } });
  for (let checkpoint = 1; checkpoint <= checkpoints; checkpoint++) {
    await writeFile(join(input.root, input.ref), bytes); let checks = 0;
    await expect(readArtifactSnapshot(input.root, input.ref, { expected, check: async () => {
      if (++checks === checkpoint) await appendFile(join(input.root, input.ref), Buffer.from([43]));
    } }), "checkpoint " + checkpoint).rejects.toThrow(/changed|mismatch/);
  }
});

test("handoff inventory consumes the original wall and monotonic budget before any request is published", async () => {
  for (const mode of ["wall", "monotonic", "backward"] as const) {
    const { run, bytes, prepared } = await handoffFixture();
    let now = Date.now(), mono = 0, checks = 0;
    await expect(completeBinaryAttestationRun(prepared, 524_288, async () => {
      if (++checks === 8) { if (mode === "wall") now += 1000; else if (mode === "monotonic") mono = 1000; else now -= 1; }
      return false;
    }, { clock: () => now, monotonic: () => mono })).rejects.toMatchObject({ code: mode === "backward" ? "time-invalid" : "request-expired" });
    expect(await readdir(join(prepared.io.root, "attestations/requests"))).toEqual([]);
    expect(await readFile(join(run, "artifacts/large.png"))).toEqual(bytes);
  }
});

test("diagnostic finalization has its own deadline and reacts to new stops while retaining cancelled receipts", async () => {
  for (const mode of ["expired", "new-stop", "already-stopped"] as const) {
    const { run, bytes, prepared } = await handoffFixture(), now = Date.now();
    const write = prepared.io.write.bind(prepared.io), read = prepared.io.readMedia.bind(prepared.io);
    let mono = 0, stopped = false, receiptWritten = false, publication = false, checks = 0, stoppedAt = 0;
    prepared.io.write = async (ref, value) => {
      const saved = await write(ref, value);
      if (ref.startsWith("attestations/requests/")) { if (mode === "already-stopped") stopped = true; else mono = 1000; }
      if (ref.startsWith("attestations/receipts/")) receiptWritten = true;
      return saved;
    };
    prepared.io.readMedia = async (...args) => {
      publication = receiptWritten && args[0] === "source";
      try { return await read(...args); } finally { publication = false; }
    };
    const operation = completeBinaryAttestationRun(prepared, 524_288, async () => {
      if (publication && ++checks === 4) {
        stoppedAt = performance.now(); if (mode === "new-stop") stopped = true; else if (mode === "expired") mono = 2000;
      }
      return stopped;
    }, { clock: () => now, monotonic: () => mono });
    if (mode === "already-stopped") {
      expect(await operation).toMatchObject({ requested: 1, adopted: 0, results: [{ receiptStatus: "cancelled", adoption: "not-attempted" }] });
      expect(await readdir(join(run, "attestations/results"))).toHaveLength(1);
    } else {
      await expect(operation).rejects.toMatchObject({ code: mode === "expired" ? "publication-expired" : "request-cancelled" });
      expect(stoppedAt).toBeGreaterThan(0); expect(performance.now() - stoppedAt).toBeLessThan(1000);
      await expect(readdir(join(run, "attestations/results"))).rejects.toThrow(/ENOENT/);
    }
    expect(await readFile(join(prepared.io.root, "sources/artifacts/large.png"))).toEqual(bytes);
  }
});

test("publication writes stop between chunks and remove only their uncommitted temporary file", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-attestation-io-stop-")); roots.push(root);
  const run = join(root, "run"); await mkdir(run);
  const io = await AttestationDirectory.create(root, run), bytes = Buffer.alloc(262_144, 42), stopped = new Error("publication-stop");
  await writeFile(join(run, "existing.json"), "existing"); let checks = 0, stoppedAt = 0;
  await expect(io.writePublished("attestations/binary-artifacts.jsonl", bytes, bytes.length, undefined, async () => {
    if (++checks === 4) { stoppedAt = performance.now(); throw stopped; }
  })).rejects.toBe(stopped);
  expect(performance.now() - stoppedAt).toBeLessThan(1000);
  expect(await readdir(join(run, "attestations"))).toEqual([]);
  expect(await readFile(join(run, "existing.json"), "utf8")).toBe("existing");
});
