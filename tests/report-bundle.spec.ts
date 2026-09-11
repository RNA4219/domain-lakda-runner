import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/core/redaction.js";
import { renderReportDocument, REPORT_FILES } from "../src/reporting/bundle-format.js";
import { verifyReportBundle } from "../src/reporting/bundle-verifier.js";
import { writeReportBundle } from "../src/reporting/bundle-writer.js";
import { serializeReportData } from "../src/reporting/projection-values.js";
import type { ReportBundleManifest, ReportView } from "../src/reporting/types.js";

function fixtureView(): ReportView {
  const source = { id: "restricted-fixture", kind: "run" as const, status: "restricted" as const, manifestSha256: "sha256:" + "a".repeat(64), eventHeadDigest: null, producerRevision: null, targetRevision: null, classification: "restricted" as const };
  return { schemaVersion: "lakda/report-view/v1", reportId: "fixture", generatedAt: "2026-09-10T00:00:00.000Z", producerVersion: "fixture", profile: "local", generationStatus: "degraded", classification: "restricted", timeZone: "UTC", inputSourceIds: [source.id], sources: [source], runs: [], sessions: [], rows: [], timeline: [], media: [], issues: [],
    counts: { sources: 1, duplicateSources: 0, runs: 0, workerIncomplete: 0, failures: 0, warnings: 0, findings: 0, actions: 0, events: 0, excludedMedia: 0, plannedActions: 0, unknownActionRuns: 0, outcomes: { passed: 0, failed: 0, partial: 0, error: 0 } } };
}

async function fixtureBundle(root: string): Promise<ReportBundleManifest> {
  const view = fixtureView();
  const content = new Map([[REPORT_FILES.html, renderReportDocument(view)], [REPORT_FILES.data, serializeReportData(view)], [REPORT_FILES.css, "body { color: black; }"], [REPORT_FILES.js, '"use strict";']]);
  const files: ReportBundleManifest["files"] = [];
  for (const [path, text] of content) {
    await writeFile(join(root, path), text);
    files.push({ path, size: Buffer.byteLength(text), sha256: "sha256:" + sha256(text) });
  }
  const manifest: ReportBundleManifest = { schemaVersion: "lakda/report-bundle-manifest/v1", reportId: view.reportId, producerVersion: view.producerVersion, rendererVersion: "lakda/report-renderer/v1", policyVersion: "lakda/report-policy/v1", profile: view.profile, classification: view.classification, generatedAt: view.generatedAt, verification: { scope: "report-bundle-files", inputVerifiedAt: view.generatedAt }, sources: view.sources, excludedMedia: [], files, viewSha256: "sha256:" + sha256(content.get(REPORT_FILES.data)!) };
  await writeFile(join(root, REPORT_FILES.manifest), serializeReportData(manifest));
  return manifest;
}

test("report document follows explicit language while preserving legacy Japanese HTML", () => {
  const legacy = fixtureView();
  const japanese = renderReportDocument(legacy);
  expect(japanese).toContain('<html lang="ja">');
  expect(japanese).toContain("Lakda 実行レポート");
  const english = renderReportDocument({ ...legacy, language: "en" });
  expect(english).toContain('<html lang="en">');
  expect(english).toContain("Lakda Execution Report");
  expect(english).toContain("JavaScript is required");
  expect(english).not.toContain("表示を準備しています。");
  expect(renderReportDocument(legacy)).toBe(japanese);
});

test("bundle verification remains portable and returns only the verified bundle scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-bundle-"));
  const moved = root + "-moved";
  try {
    await fixtureBundle(root);
    await rename(root, moved);
    const result = await verifyReportBundle(moved);
    expect(result.view.generationStatus).toBe("degraded");
    expect(result.manifest.verification.scope).toBe("report-bundle-files");
    expect(result.manifestSha256).toBe("sha256:" + sha256(await readFile(join(moved, REPORT_FILES.manifest))));
    expect(result.fileCount).toBe(5);
  } finally { await rm(root, { recursive: true, force: true }); await rm(moved, { recursive: true, force: true }); }
});

test("bundle verification rejects missing, changed, unlisted and self-referential files", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-bundle-"));
  try {
    await fixtureBundle(root);
    await writeFile(join(root, REPORT_FILES.css), "changed");
    await expect(verifyReportBundle(root)).rejects.toMatchObject({ issueCode: "invalid-bundle" });
    await fixtureBundle(root);
    await rm(join(root, REPORT_FILES.js));
    await expect(verifyReportBundle(root)).rejects.toMatchObject({ issueCode: "invalid-bundle" });
    let manifest = await fixtureBundle(root);
    await writeFile(join(root, "unlisted.txt"), "unlisted");
    await expect(verifyReportBundle(root)).rejects.toMatchObject({ issueCode: "invalid-bundle" });
    await rm(join(root, "unlisted.txt"));
    for (const path of [REPORT_FILES.manifest, "../outside", REPORT_FILES.css]) {
      manifest = await fixtureBundle(root);
      manifest.files.push({ path, size: 0, sha256: "sha256:" + "b".repeat(64) });
      await writeFile(join(root, REPORT_FILES.manifest), JSON.stringify(manifest));
      await expect(verifyReportBundle(root)).rejects.toThrow();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bundle verification binds embedded data and manifest metadata, and honors cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-bundle-"));
  try {
    let manifest = await fixtureBundle(root);
    const html = (await readFile(join(root, REPORT_FILES.html), "utf8")).replace('"reportId":"fixture"', '"reportId":"different"');
    await writeFile(join(root, REPORT_FILES.html), html);
    Object.assign(manifest.files.find(file => file.path === REPORT_FILES.html)!, { size: Buffer.byteLength(html), sha256: "sha256:" + sha256(html) });
    await writeFile(join(root, REPORT_FILES.manifest), JSON.stringify(manifest));
    await expect(verifyReportBundle(root)).rejects.toMatchObject({ issueCode: "invalid-bundle" });
    manifest = await fixtureBundle(root);
    manifest.sources[0].manifestSha256 = "sha256:" + "b".repeat(64);
    await writeFile(join(root, REPORT_FILES.manifest), JSON.stringify(manifest));
    await expect(verifyReportBundle(root)).rejects.toMatchObject({ issueCode: "invalid-bundle" });
    const controller = new AbortController(); controller.abort(new Error("fixture-cancel"));
    await expect(verifyReportBundle(root, controller.signal)).rejects.toThrow("fixture-cancel");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("writer publishes a verified bundle once and rejects input overlap before writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-write-"));
  try {
    const source = join(root, "source"); await mkdir(source);
    const output = join(root, "reports", "one");
    const options = { output, view: fixtureView(), renderer: { css: "body {}", js: '"use strict";' }, copies: [], sourceRoots: [source], verifyInputs: async () => {}, inputVerifiedAt: fixtureView().generatedAt };
    const result = await writeReportBundle(options);
    expect(result.manifestSha256).toBe((await verifyReportBundle(output)).manifestSha256);
    expect(await readdir(join(root, "reports"))).toEqual(["one"]);
    const before = await readFile(join(output, REPORT_FILES.manifest));
    await expect(writeReportBundle(options)).rejects.toMatchObject({ issueCode: "output-exists" });
    expect(await readFile(join(output, REPORT_FILES.manifest))).toEqual(before);
    await expect(writeReportBundle({ ...options, output: join(source, "new", "report") })).rejects.toMatchObject({ issueCode: "output-overlap" });
    await expect(writeReportBundle({ ...options, output: root })).rejects.toMatchObject({ issueCode: "output-overlap" });
    expect(await readdir(source)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("writer awaits cancellation and source verification failures, leaving no published partial report", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-write-"));
  try {
    const output = join(root, "cancelled");
    const controller = new AbortController();
    const options = { output, view: fixtureView(), renderer: { css: "body {}", js: '"use strict";' }, copies: [], sourceRoots: [], inputVerifiedAt: fixtureView().generatedAt, signal: controller.signal,
      verifyInputs: async () => { expect(await readdir(root)).not.toContain("cancelled"); controller.abort(new Error("deadline-fixture")); } };
    const cancelled = writeReportBundle(options);
    await expect(cancelled).rejects.toThrow("deadline-fixture");
    await expect(cancelled).rejects.toMatchObject({ reportWorkDir: expect.stringMatching(/^\.lakda-report-stage-[a-zA-Z0-9]+$/) });
    expect(await readdir(root)).toEqual([]);
    await expect(writeReportBundle({ ...options, signal: undefined, verifyInputs: async () => { throw new Error("source-changed-fixture"); } })).rejects.toThrow("source-changed-fixture");
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent generation reserves its destination until verification and publish complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-write-"));
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const checkpoint = new Promise<void>(resolve => { entered = resolve; });
  try {
    const options = { output: join(root, "one"), view: fixtureView(), renderer: { css: "body {}", js: '"use strict";' }, copies: [], sourceRoots: [], inputVerifiedAt: fixtureView().generatedAt, verifyInputs: async () => { entered(); await barrier; } };
    const first = writeReportBundle(options);
    try {
      await checkpoint;
      await expect(writeReportBundle({ ...options, verifyInputs: async () => {} })).rejects.toMatchObject({ issueCode: "output-busy" });
    } finally { release(); }
    await first;
    expect(await readdir(root)).toEqual(["one"]);
    await verifyReportBundle(options.output);
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});
