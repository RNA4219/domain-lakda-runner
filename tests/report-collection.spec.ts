import { expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { sha256 } from "../src/core/redaction.js";
import { loadReportSourceCollection } from "../src/reporting/source-collection.js";
import { buildReportView } from "../src/reporting/view-builder.js";
import { startFixture } from "./fixtures/server.js";

test("report resolves a produced session's verified child run and counts explicit duplicates once", async () => {
  const fixture = await startFixture(() => ({ body: "<main><h1>Report fixture</h1></main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-report-collection-"));
  try {
    const charter = {
      schemaVersion: "lakda/exploration-charter/v1", charterId: "report-collection", targetRevision: "fixture-v1", platform: "pc-web", executionMode: "fixture", adapter: { id: "playwright" }, baseUrl: fixture.baseUrl, persona: "guest", scope: { allowHosts: ["127.0.0.1"] }, budget: { durationMs: 10_000, maxActions: 2, maxActionsPerMinute: 10 }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" }, capture: { video: "off", screenshot: "finding-non-pass-bookmark", sampledFrames: { enabled: false, intervalMs: 1000, maxFrames: 2, maxBytes: 1000, source: "playwright", stopTimeoutMs: 1000 } }, templateCorpusVersion: "none", seed: 7, outputDir: join(root, "runs"),
    };
    const charterPath = join(root, "charter.json");
    await writeFile(charterPath, JSON.stringify(charter));
    expect(await runCli(["explore", "run", "--charter", charterPath])).toBe(0);
    const sessionRoot = join(root, "explorations", (await readdir(join(root, "explorations")))[0]);
    const runRoot = join(root, "runs", (await readdir(join(root, "runs")))[0]);
    const entries = [{ kind: "session" as const, root: sessionRoot }, { kind: "run" as const, root: runRoot }];
    const result = await loadReportSourceCollection({ entries, duplicatePaths: 0, indexBytes: 0 });
    expect(result.runs).toHaveLength(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.explicitSourceCount).toBe(2);
    expect(result.duplicateSources).toBe(1);
    expect(result.runs[0].run).toMatchObject({ platform: "pc-web", executionMode: "fixture", targetRevision: "fixture-v1" });
    expect(result.sessions[0].summary?.runKeys).toEqual([result.runs[0].source.id]);
    const view = buildReportView(result, { reportId: "report-collection", generatedAt: "2026-09-10T00:00:00Z", producerVersion: "fixture", profile: "local", media: [], issues: [] });
    expect(view.generationStatus).toBe("ready");
    expect(view.counts).toMatchObject({ sources: 2, runs: 1, actions: 0, unknownActionRuns: 0, outcomes: { passed: 1, failed: 0, partial: 0, error: 0 } });
    expect(view.sessions[0]).toMatchObject({ status: "completed", technicalOutcome: "passed", acceptanceStatus: "fixture_only" });
    const sessionOnly = await loadReportSourceCollection({ entries: entries.slice(0, 1), duplicatePaths: 0, indexBytes: 0 });
    expect(sessionOnly.runs[0].snapshot.manifestSha256).toBe(result.runs[0].snapshot.manifestSha256);
    const repeated = await loadReportSourceCollection({ entries: Array.from({ length: 101 }, () => entries[1]), duplicatePaths: 0, indexBytes: 0 });
    expect(repeated.explicitSourceCount).toBe(1);
    expect(repeated.duplicateSources).toBe(100);
    // Identical manifest bytes do not let a damaged duplicate bypass artifact verification.
    const copied = join(root, "damaged-copy");
    await cp(runRoot, copied, { recursive: true });
    const metadataPath = join(copied, "run-metadata.json");
    const damaged = await readFile(metadataPath);
    damaged[damaged.length - 1] ^= 1;
    await writeFile(metadataPath, damaged);
    await expect(loadReportSourceCollection({ entries: [...entries, { kind: "run", root: copied }], duplicatePaths: 0, indexBytes: 0 })).rejects.toThrow(/mismatch/);
    const changedMetadata = JSON.parse(await readFile(join(runRoot, "run-metadata.json"), "utf8"));
    changedMetadata.seed += 1;
    const changedBytes = Buffer.from(JSON.stringify(changedMetadata));
    await writeFile(metadataPath, changedBytes);
    const manifestPath = join(copied, "exports/artifact-manifest.json");
    const changedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const entry = changedManifest.artifacts.find((artifact: { path: string }) => artifact.path === "run-metadata.json");
    entry.sha256 = "sha256:" + sha256(changedBytes);
    entry.size_bytes = changedBytes.length;
    // Keep each copy internally coherent so the test reaches cross-source identity conflict.
    const startPath = join(copied, "run-start.json");
    const changedStart = JSON.parse(await readFile(startPath, "utf8")); changedStart.seed = changedMetadata.seed;
    const startBytes = Buffer.from(JSON.stringify(changedStart)); await writeFile(startPath, startBytes);
    const startEntry = changedManifest.artifacts.find((artifact: { path: string }) => artifact.path === "run-start.json");
    startEntry.sha256 = "sha256:" + sha256(startBytes); startEntry.size_bytes = startBytes.length;
    await writeFile(manifestPath, JSON.stringify(changedManifest));
    await expect(loadReportSourceCollection({ entries: [...entries, { kind: "run", root: copied }], duplicatePaths: 0, indexBytes: 0 })).rejects.toMatchObject({ issueCode: "conflicting-source" });
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
