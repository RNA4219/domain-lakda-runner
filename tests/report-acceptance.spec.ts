import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadReportRun } from "../src/reporting/run-source.js";
import { generateReport } from "../src/reporting/generation.js";
import { verifyReportBundle } from "../src/reporting/bundle-verifier.js";
import { appendSessionEvent, buildExplorationReport, createExplorationSession, registerRunManifest, writeFinding } from "../src/exploration/session.js";
import type { ReportView } from "../src/reporting/types.js";

const helper = (name: string) => import(pathToFileURL(resolve("scripts/report-acceptance", name + ".mjs")).href);

test("acceptance corpus retains concentrated maximum history and long failure messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-acceptance-test-"));
  try {
    const { createCorpus } = await helper("corpus");
    const corpus = await createCorpus(root, "concentrated");
    const sources = JSON.parse(await readFile(corpus.sources, "utf8"));
    expect(sources.entries).toHaveLength(100);
    const run = await loadReportRun(join(root, sources.entries[0].path));
    expect(run.run?.actionCount).toBe(10_000);
    expect(run.timeline).toHaveLength(10_000);
    expect(run.rows.filter(row => row.kind === "failure")).toHaveLength(1_000);
    expect(run.rows.find(row => row.kind === "failure")?.message).toHaveLength(2_048);
    const empty = await loadReportRun(join(root, sources.entries[99].path));
    expect(empty.run?.actionCount).toBe(0);
    expect(empty.run?.outcome).toBe("passed");
    await expect(createCorpus(root, "concentrated")).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("acceptance metrics retain slow samples and validate actual browser zoom", async () => {
  const { summarize, matchesZoom } = await helper("metrics");
  expect(summarize([...Array(94).fill(20), ...Array(6).fill(400)])).toEqual({ count: 100, min: 20, max: 400, p95: 400 });
  expect(() => summarize([])).toThrow();
  expect(() => summarize([1, Number.NaN])).toThrow();
  expect(matchesZoom({ width: 195, ratio: 2, scale: 1 }, 390, 2)).toBe(true);
  expect(matchesZoom({ width: 390, ratio: 1, scale: 2 }, 390, 2)).toBe(false);
  expect(matchesZoom({ width: 390, ratio: 1, scale: 1 }, 390, 2)).toBe(false);
});

test("media acceptance corpus generates bound, foreign, ambiguous and excluded evidence through production readers", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-media-acceptance-"));
  try {
    const { createMediaCorpus } = await helper("media-corpus");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5K0AAAAASUVORK5CYII=", "base64");
    const corpus = await createMediaCorpus(root, { pngP: png, pngQ: png, webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("webm")]) }, { generateReport, verifyReportBundle, appendSessionEvent, buildExplorationReport, createExplorationSession, registerRunManifest, writeFinding });
    const local: ReportView = JSON.parse(await readFile(join(corpus.images.output, "report-data.json"), "utf8"));
    const shared: ReportView = JSON.parse(await readFile(join(corpus.shared.output, "report-data.json"), "utf8"));
    const linked = local.rows.find(row => row.title === "finding-A")!;
    expect(linked.evidenceIds).toHaveLength(1);
    for (const title of ["finding-foreign", "finding-ambiguous"]) expect(local.rows.find(row => row.title === title)).toMatchObject({ evidenceIds: [], evidenceNotes: ["unavailable"] });
    const foreignFinding = local.rows.find(row => row.title === "finding-foreign")!;
    expect(local.sessions.find(session => session.sourceId === foreignFinding.sourceId)?.runKeys).toEqual(["run:images-primary:1"]);
    expect(await readFile(join(root, "images-primary/adaptive/oracle-results.jsonl"), "utf8")).not.toContain("adapter:foreign-only");
    expect(await readFile(join(root, "images-foreign/adaptive/oracle-results.jsonl"), "utf8")).toContain("adapter:foreign-only");
    expect(local.media.filter(item => item.runKey === "run:images-primary:1")).toHaveLength(2);
    expect(local.media.find(item => linked.evidenceIds.includes(item.id))).toMatchObject({ verification: "pending", runKey: "run:images-primary:1" });
    expect(shared.rows.find(row => row.title === "finding-A")?.evidenceIds).toEqual(linked.evidenceIds);
    expect(shared.media.every(item => item.path === null && item.verification === "excluded")).toBe(true);
    const video: ReportView = JSON.parse(await readFile(join(corpus.video.output, "report-data.json"), "utf8"));
    expect(video.timeline.filter(event => event.evidenceIds.length)).toHaveLength(2);
    expect(video.media).toHaveLength(2);
    expect(Object.values(corpus).every(record => (record as { verification: { fileCount: number } }).verification.fileCount >= 5)).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
