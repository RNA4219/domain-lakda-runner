import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readArtifactSnapshot } from "../src/runs/artifact-snapshot.js";
import { readManifestSnapshot } from "../src/runs/manifest-snapshot.js";
import { hateArtifact } from "../src/runs/catalog-values.js";

const digest = (bytes: Buffer) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

async function manifestFixture(root: string) {
  await mkdir(join(root, "exports"));
  const data = Buffer.from('{"fixture":true}');
  await writeFile(join(root, "data.json"), data);
  const artifact = { artifact_id: "lakda:data", kind: "report", path: "data.json", sha256: digest(data), size_bytes: data.length,
    classification: "internal", redaction_status: "not_required", redaction_rule_version: "fixture-v1", safe_for_summary: true,
    public_exposure: "none", retention: {}, security_checks: { secrets_scan: "pass", pii_scan: "pass" } };
  const manifest = { schema_version: "HATE/v1", run_id: "fixture", run_attempt: 1, commit_sha: "a".repeat(40), artifacts: [artifact] };
  const save = async () => writeFile(join(root, "exports/artifact-manifest.json"), JSON.stringify(manifest));
  await save();
  return { data, manifest, save };
}

test("manifest reader verifies every artifact and caller controls retained text", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-manifest-"));
  try {
    const { data } = await manifestFixture(root);
    const before = await readFile(join(root, "exports/artifact-manifest.json"));
    const summary = await readManifestSnapshot(root);
    expect(summary.snapshots.get("data.json")?.bytes).toBeUndefined();
    expect(summary.verifiedArtifactBytes).toBe(data.length);
    const detail = await readManifestSnapshot(root, { retain: ref => ref === "data.json", textLimit: before.length + data.length });
    expect(detail.snapshots.get("data.json")?.bytes).toEqual(data);
    expect(detail.manifestSha256).toBe(digest(before));
    await expect(readManifestSnapshot(root, { retain: () => true, textLimit: before.length + data.length - 1 })).rejects.toThrow(/limit/);
    await expect(readManifestSnapshot(root, { artifactLimit: data.length - 1 })).rejects.toThrow(/limit/);
    expect(await readFile(join(root, "exports/artifact-manifest.json"))).toEqual(before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("integrity validation is separate from catalog publication policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-manifest-"));
  try {
    const { manifest, save } = await manifestFixture(root);
    manifest.artifacts[0].kind = "screenshot";
    manifest.artifacts[0].redaction_status = "pending";
    manifest.artifacts[0].security_checks = { secrets_scan: "not_run", pii_scan: "not_run" };
    await save();
    expect((await readManifestSnapshot(root)).artifacts).toHaveLength(1);
    await expect(readManifestSnapshot(root, { policy: hateArtifact })).rejects.toThrow(/redaction/);
    await writeFile(join(root, "data.json"), "tampered bytes");
    await expect(readManifestSnapshot(root)).rejects.toThrow(/bytes\/hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manifest reader rejects unknown schema, duplicate and escaping references", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-manifest-"));
  try {
    const { manifest, save } = await manifestFixture(root);
    manifest.schema_version = "HATE/v99";
    await save();
    await expect(readManifestSnapshot(root)).rejects.toThrow(/schema/);
    manifest.schema_version = "HATE/v1";
    manifest.artifacts.push({ ...manifest.artifacts[0], artifact_id: "lakda:duplicate" });
    await save();
    await expect(readManifestSnapshot(root)).rejects.toThrow(/duplicate/);
    manifest.artifacts.pop();
    manifest.artifacts[0].path = "../data.json";
    await save();
    await expect(readManifestSnapshot(root)).rejects.toThrow(/portable|schema/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact snapshot verifies bytes while retaining only explicitly requested text", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-snapshot-"));
  try {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 7);
    await writeFile(join(root, "video.webm"), bytes);
    const metadata = Buffer.from('{"result":"fixture"}');
    await writeFile(join(root, "metadata.json"), metadata);
    const media = await readArtifactSnapshot(root, "video.webm", { expected: { size: bytes.length, sha256: digest(bytes) } });
    expect(media.bytes).toBeUndefined();
    expect(media.size).toBe(bytes.length);
    expect(media.sha256).toBe(digest(bytes));
    const text = await readArtifactSnapshot(root, "metadata.json", { retain: true, maxBytes: metadata.length });
    expect(text.bytes).toEqual(metadata);
    expect(await readFile(join(root, "video.webm"))).toEqual(bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact snapshot rejects boundary overruns, wrong hashes and wrong sizes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-snapshot-"));
  try {
    const bytes = Buffer.from("12345");
    await writeFile(join(root, "data.txt"), bytes);
    await expect(readArtifactSnapshot(root, "data.txt", { maxBytes: 4 })).rejects.toThrow(/limit/);
    await expect(readArtifactSnapshot(root, "data.txt", { expected: { size: 4, sha256: digest(bytes) } })).rejects.toThrow(/bytes\/hash mismatch/);
    await expect(readArtifactSnapshot(root, "data.txt", { expected: { size: 5, sha256: "sha256:" + "0".repeat(64) } })).rejects.toThrow(/bytes\/hash mismatch/);
    expect((await readArtifactSnapshot(root, "data.txt", { maxBytes: 5 })).size).toBe(5);
    expect((await readArtifactSnapshot(root, "data.txt", { maxBytes: 6 })).size).toBe(5);
    await expect(readArtifactSnapshot(root, "../outside", {})).rejects.toThrow(/portable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aborted artifact reads release the file and do not return a partial snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-snapshot-"));
  try {
    await writeFile(join(root, "data.bin"), Buffer.alloc(4 * 1024 * 1024));
    const controller = new AbortController();
    const read = readArtifactSnapshot(root, "data.bin", { retain: true, signal: controller.signal });
    controller.abort();
    await expect(read).rejects.toThrow();
    await rename(join(root, "data.bin"), join(root, "renamed.bin"));
    expect((await readFile(join(root, "renamed.bin"))).length).toBe(4 * 1024 * 1024);
  } finally { await rm(root, { recursive: true, force: true }); }
});
