import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "../src/core/redaction.js";
import { readArtifactSnapshot } from "../src/runs/artifact-snapshot.js";
import { selectReportMedia } from "../src/reporting/media-policy.js";
import { copyReportMedia } from "../src/reporting/media-copy.js";
import type { ReportMediaCandidate } from "../src/reporting/run-source.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5K0AAAAASUVORK5CYII=", "base64");
async function candidate(root: string, path = "artifacts/failure.png", bytes = png, run = "one"): Promise<ReportMediaCandidate> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
  const snapshot = await readArtifactSnapshot(root, path);
  return { id: "media:" + sha256(run + ":" + path), sourceId: "run:" + run, runKey: "run:" + run, root, snapshot,
    artifact: { path, kind: path.endsWith(".zip") ? "trace" : "screenshot", sha256: snapshot.sha256, size_bytes: snapshot.size, classification: "internal", redaction_status: "pending", public_exposure: "none", security_checks: { secrets_scan: "not_applicable", pii_scan: "not_applicable" } } };
}

test("local pending raster is explicitly unverified and share excludes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-media-"));
  try {
    const input = await candidate(root);
    const local = await selectReportMedia([input], { profile: "local" });
    expect(local.media[0]).toMatchObject({ kind: "screenshot", verification: "pending", reason: "unverified-media", sequence: null });
    expect(local.media[0].path).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
    expect(local.copies).toHaveLength(1);
    const share = await selectReportMedia([input], { profile: "share" });
    expect(share.media[0]).toMatchObject({ path: null, verification: "excluded", reason: "unverified-media" });
    expect(share.copies).toEqual([]);
    expect((await selectReportMedia([input], { profile: "local", textOnly: true })).media[0].reason).toBe("text-only");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("media copy verifies transferred bytes, refuses overwrite and never writes inside a source", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-copy-"));
  try {
    const input = await candidate(join(root, "input"));
    const selection = await selectReportMedia([input], { profile: "local" });
    const output = join(root, "output"); await mkdir(output);
    const records = await copyReportMedia(selection.copies, output);
    expect(records).toEqual([{ path: selection.media[0].path, size: png.length, sha256: input.snapshot.sha256 }]);
    expect(await readFile(join(output, records[0].path))).toEqual(png);
    await expect(copyReportMedia(selection.copies, output)).rejects.toThrow();
    await expect(copyReportMedia(selection.copies, input.root)).rejects.toMatchObject({ issueCode: "output-overlap" });
    const mixedOutput = join(root, "mixed"); await mkdir(mixedOutput);
    const nestedInput = await candidate(join(mixedOutput, "source"), "artifacts/failure.png", png, "nested");
    const nestedSelection = await selectReportMedia([nestedInput], { profile: "local" });
    await expect(copyReportMedia([...selection.copies, ...nestedSelection.copies], mixedOutput)).rejects.toMatchObject({ issueCode: "output-overlap" });
    expect(await readdir(mixedOutput)).toEqual(["source"]);
    const otherOutput = join(root, "second"); await mkdir(otherOutput);
    const damaged = Buffer.from(png); damaged[damaged.length - 1] ^= 1;
    await writeFile(input.snapshot.path, damaged);
    await expect(copyReportMedia(selection.copies, otherOutput)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    const abort = new AbortController(); abort.abort(new Error("cancelled copy"));
    const cancelledOutput = join(root, "cancelled"); await mkdir(cancelledOutput);
    await expect(copyReportMedia(selection.copies, cancelledOutput, abort.signal)).rejects.toThrow("cancelled copy");
    expect(await readdir(cancelledOutput)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restricted, failed-scan, SVG, disguised HTML and shared traces cannot be included", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-media-"));
  try {
    const restricted = await candidate(root, "artifacts/restricted.png");
    restricted.artifact.classification = "restricted";
    const failed = await candidate(root, "artifacts/failed.png");
    failed.artifact.security_checks.secrets_scan = "fail";
    const svg = await candidate(root, "artifacts/untrusted.svg", Buffer.from("<svg/>"));
    const html = await candidate(root, "artifacts/fake.png", Buffer.from("<!doctype html><script>test</script>"));
    const zip = await candidate(root, "artifacts/trace.zip", Buffer.from([0x50, 0x4b, 0x05, 0x06, ...Array(18).fill(0)]));
    const local = await selectReportMedia([restricted, failed, svg, html, zip], { profile: "local" });
    expect(local.media.map(media => media.reason)).toEqual(["restricted-media", "artifact-policy-denied", "unsupported-media", "unsupported-media", "unverified-media"]);
    expect(local.copies.map(copy => copy.candidate.id)).toEqual([zip.id]);
    expect((await selectReportMedia([zip], { profile: "share" })).media[0].reason).toBe("local-trace-only");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("attestation results still require eligible artifact policy and frame order remains explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-media-"));
  try {
    const input = await candidate(root, "artifacts/frames/frame-0007.png");
    const verifiedIds = new Set([input.id]); // Stub the separately tested attestation verifier boundary.
    expect((await selectReportMedia([input], { profile: "share", verifiedIds })).media[0].verification).toBe("excluded");
    input.artifact.redaction_status = "redacted";
    input.artifact.security_checks = { secrets_scan: "pass", pii_scan: "pass" };
    input.artifact.classification = "confidential";
    const result = await selectReportMedia([input], { profile: "share", verifiedIds });
    expect(result.media[0]).toMatchObject({ kind: "sampled-frame", sequence: 7, verification: "verified", classification: "confidential", reason: null });
    const abort = new AbortController(); abort.abort(new Error("cancelled"));
    await expect(selectReportMedia([input], { profile: "local", signal: abort.signal })).rejects.toThrow("cancelled");
  } finally { await rm(root, { recursive: true, force: true }); }
});
