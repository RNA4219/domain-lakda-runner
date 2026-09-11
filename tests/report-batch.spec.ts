import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactCollector } from "../src/core/artifacts.js";
import { loadConfig } from "../src/core/config.js";
import { exportHate } from "../src/core/hate.js";
import { sha256 } from "../src/core/redaction.js";
import { resolveReportSources } from "../src/reporting/source-index.js";
import { loadReportSourceCollection } from "../src/reporting/source-collection.js";
import { buildReportView } from "../src/reporting/view-builder.js";
import { verifyReportSourceIndex } from "../src/reporting/source-verifier.js";
import { assertReportViewSemantics } from "../src/reporting/view-validation.js";
import type { ReportView } from "../src/reporting/types.js";
import type { RunBatchResult } from "../src/core/types.js";
import { saveReportBatchSources } from "../src/reporting/batch-writer.js";

const options = { reportId: "report-batch-fixture", generatedAt: "2026-09-10T00:00:00.000Z", producerVersion: "fixture", profile: "local" as const, media: [], issues: [] };

async function fixture(root: string) {
  const config = loadConfig(undefined, { mode: "smoke", baseUrl: "http://127.0.0.1:9", outputDir: join(root, "runs"), seed: 7, artifacts: { video: false } });
  const collector = await ArtifactCollector.create(config, "smoke", { workerIndex: 0, batchId: "fixture-batch" });
  const finalized = await collector.finalize({ schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: 7, baseUrl: config.baseUrl!, actions: [] }, "passed", 0, "not_requested", "completed");
  await exportHate(finalized.runDir, finalized.manifestPath);
  const index = {
    schemaVersion: "lakda/report-batch-sources/v1", batchId: "fixture-batch", recordedAt: options.generatedAt, root: "../runs", classification: "internal", outcome: "error", exitCode: 1, requestedWorkers: 2, completedWorkers: 1,
    workers: [
      { workerIndex: 0, seed: 7, status: "completed", run: { runId: collector.metadata.runId, attempt: 1, path: basename(finalized.runDir), manifestSha256: "sha256:" + sha256(await readFile(finalized.manifestPath)), outcome: "passed", exitCode: 0, terminationReason: "completed" } },
      { workerIndex: 1, seed: 8, status: "error", error: { name: "Error", message: "worker execution failed" } },
    ],
  };
  await mkdir(join(root, "private")); const path = join(root, "private", "sources.json");
  const save = async () => writeFile(path, JSON.stringify(index)); await save();
  return { index, path, save, finalized };
}

test("batch projection preserves a worker that failed before a run existed and counts child runs once", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-batch-"));
  try {
    const input = await fixture(root);
    input.index.workers[1].error!.message = "password=hidden-worker-token user@example.invalid"; await input.save();
    const selection = await resolveReportSources({ sources: input.path });
    const collection = await loadReportSourceCollection(selection);
    const view = buildReportView(collection, options);
    expect(view).toMatchObject({ generationStatus: "degraded", counts: { sources: 1, runs: 1, workerIncomplete: 1, outcomes: { passed: 1, failed: 0, partial: 0, error: 0 } }, batches: [{ requestedWorkers: 2, completedWorkers: 1, outcome: "error", exitCode: 1 }] });
    expect(view.rows.filter(row => row.kind === "worker")).toHaveLength(2);
    expect(view.rows.find(row => row.kind === "worker" && row.runKey === null)?.status).toBe("error");
    expect(view.sources.find(source => source.kind === "batch")).toMatchObject({ manifestSha256: null, indexSha256: selection.indexSnapshot!.sha256 });
    for (const privateValue of [root, "hidden-worker-token", "user@example.invalid"]) expect(JSON.stringify(view)).not.toContain(privateValue);
    await writeFile(input.path, JSON.stringify({ ...input.index, recordedAt: "2026-09-10T00:00:01.000Z" }));
    await expect(verifyReportSourceIndex(selection)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("batch input rejects worker topology, aggregate, seed, path and manifest binding mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-batch-"));
  try {
    const input = await fixture(root); const original = structuredClone(input.index);
    const changes: Array<(value: typeof original) => void> = [
      value => { value.workers[1].workerIndex = 0; }, value => { value.completedWorkers = 2; },
      value => { value.outcome = "passed"; value.exitCode = 0; }, value => { value.workers[0].seed = 99; },
      value => { value.workers[0].run!.path = "../escape"; },
      value => { value.workers[0].run!.manifestSha256 = "sha256:" + "0".repeat(64); },
      value => { value.batchId = "different-batch"; }, value => { value.workers[0].run!.exitCode = 2; },
    ];
    for (const change of changes) {
      const value = structuredClone(original); change(value); await writeFile(input.path, JSON.stringify(value));
      await expect(resolveReportSources({ sources: input.path }).then(selection => loadReportSourceCollection(selection))).rejects.toThrow();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("all-worker failure needs no invented run and a restricted batch exposes no worker details", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-batch-"));
  try {
    const input = await fixture(root);
    input.index.root = "../never-created"; input.index.completedWorkers = 0;
    input.index.workers = [0, 1].map(workerIndex => ({ workerIndex, seed: 7 + workerIndex, status: "error", error: { name: "Error", message: "worker execution failed" } }));
    await input.save();
    const view = buildReportView(await loadReportSourceCollection(await resolveReportSources({ sources: input.path })), options);
    expect(view.counts).toMatchObject({ sources: 1, runs: 0, workerIncomplete: 2 });
    expect(view.runs).toEqual([]); expect(view.generationStatus).toBe("degraded");
    input.index.classification = "restricted"; await input.save();
    const restricted = buildReportView(await loadReportSourceCollection(await resolveReportSources({ sources: input.path })), options);
    expect(restricted.rows).toEqual([]); expect(restricted.sources).toHaveLength(1);
    expect(restricted.sources[0].status).toBe("restricted");
    expect(JSON.stringify(restricted)).not.toContain("fixture-batch");
    expect(JSON.stringify(restricted)).not.toContain("worker execution failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("batch diagnostics distinguish absent finalization from an existing invalid manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-batch-"));
  try {
    const input = await fixture(root);
    const document = { ...input.index, requestedWorkers: 1, completedWorkers: 1, workers: [{ workerIndex: 0, seed: 7, status: "completed", run: { ...input.index.workers[0].run!, manifestSha256: null, outcome: "error", exitCode: 1, terminationReason: "artifact_failure" } }] };
    await writeFile(input.path, JSON.stringify(document));
    await expect(resolveReportSources({ sources: input.path })).rejects.toMatchObject({ issueCode: "batch-manifest-conflict" });
    await rename(input.finalized.manifestPath, input.finalized.manifestPath + ".held");
    const selection = await resolveReportSources({ sources: input.path });
    const collection = await loadReportSourceCollection(selection);
    const view = buildReportView(collection, options);
    expect(view).toMatchObject({ generationStatus: "degraded", counts: { runs: 0, workerIncomplete: 1 }, batches: [{ completedWorkers: 1, workers: [{ status: "completed", runKey: null, runUnavailable: true }] }] });
    expect(() => buildReportView(collection, { ...options, profile: "share" })).toThrow(/未確定run/);
    await verifyReportSourceIndex(selection);
    await writeFile(input.finalized.manifestPath, "invalid manifest");
    await expect(verifyReportSourceIndex(selection)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    await expect(resolveReportSources({ sources: input.path })).rejects.toMatchObject({ issueCode: "batch-manifest-conflict" });
    await rename(join(input.finalized.runDir, "exports"), join(input.finalized.runDir, "exports-held"));
    await symlink(join(input.finalized.runDir, "missing-exports"), join(input.finalized.runDir, "exports"), "junction");
    await expect(verifyReportSourceIndex(selection)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    await expect(resolveReportSources({ sources: input.path })).rejects.toMatchObject({ issueCode: "invalid-manifest-location" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bundle semantics reject inconsistent batch worker summaries and mislabeled index proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-batch-"));
  try {
    const input = await fixture(root);
    const original = buildReportView(await loadReportSourceCollection(await resolveReportSources({ sources: input.path })), options);
    const changes: Array<(view: ReportView) => void> = [
      view => { view.batches![0].outcome = "passed"; view.batches![0].exitCode = 0; },
      view => { view.batches![0].workers[1].workerIndex = 0; },
      view => { view.batches![0].workers[0].seed = 99; },
      view => { view.batches![0].completedWorkers = 2; },
      view => { view.batches![0].workers[1].runUnavailable = false; },
      view => { view.rows.find(row => row.kind === "worker")!.status = "partial"; },
      view => { delete view.sources.find(source => source.kind === "batch")!.indexSha256; },
      view => { view.sources.find(source => source.kind === "run")!.indexSha256 = "sha256:" + "0".repeat(64); },
      view => { delete view.batches; },
    ];
    for (const change of changes) { const view = structuredClone(original); change(view); expect(() => assertReportViewSemantics(view)).toThrow(); }
    input.index.classification = "restricted"; await input.save();
    const restricted = buildReportView(await loadReportSourceCollection(await resolveReportSources({ sources: input.path })), options);
    expect(restricted.sources).toHaveLength(1); expect(restricted.runs).toEqual([]); expect(restricted.rows).toEqual([]);
    expect(JSON.stringify(restricted)).not.toContain(input.index.workers[0].run!.runId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("private batch producer saves only captured topology and can regenerate mixed worker results", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-batch-"));
  try {
    const input = await fixture(root); const run = input.index.workers[0].run!;
    const batch: RunBatchResult = { schemaVersion: "lakda/run-batch/v1", batchId: input.index.batchId, outcome: "error", exitCode: 1, requestedWorkers: 2, completedWorkers: 1, workerResults: [
      { workerIndex: 0, seed: 7, status: "completed", result: { runId: run.runId, attempt: 1, outcome: "passed", exitCode: 0, terminationReason: "completed", workerIndex: 0, batchId: input.index.batchId, artifactManifestPath: input.finalized.manifestPath, actionSequencePath: join(input.finalized.runDir, "action-sequence.json"), failures: [], llmStatus: "not_requested" } },
      { workerIndex: 1, seed: 8, status: "error", error: { name: "Error", message: "password=private-worker-secret" } },
    ] };
    const parameters = { runOutputRoot: join(root, "runs"), outputRoot: join(root, "reports"), classification: "internal" as const };
    const selector = await saveReportBatchSources(batch, parameters);
    expect(await readFile(selector.sources!, "utf8")).not.toContain("private-worker-secret");
    const view = buildReportView(await loadReportSourceCollection(await resolveReportSources(selector)), options);
    expect(view.counts).toMatchObject({ sources: 1, runs: 1, workerIncomplete: 1 });
    const second = await saveReportBatchSources(batch, parameters);
    expect(second.sources).not.toBe(selector.sources);
    await expect(saveReportBatchSources(batch, { ...parameters, outputRoot: join(root, "runs", "reports") })).rejects.toMatchObject({ issueCode: "output-overlap" });
    expect(await readdir(join(root, "runs"))).not.toContain("reports");
    const broken = structuredClone(batch); broken.batchId = "wrong-batch";
    await expect(saveReportBatchSources(broken, parameters)).rejects.toThrow();
    expect((await readdir(parameters.outputRoot)).filter(name => name.startsWith("sources-"))).toHaveLength(2);
    const allFailed: RunBatchResult = { ...batch, completedWorkers: 0, workerResults: [0, 1].map(workerIndex => ({ workerIndex, seed: 7 + workerIndex, status: "error", error: { name: "Error", message: "worker execution failed" } })) };
    const empty = await saveReportBatchSources(allFailed, { ...parameters, runOutputRoot: join(root, "no-runs") });
    expect((await resolveReportSources(empty)).entries).toEqual([]);
    expect(await readdir(root)).not.toContain("no-runs");
    const aborted = new AbortController(); aborted.abort();
    await expect(saveReportBatchSources(batch, { ...parameters, signal: aborted.signal })).rejects.toThrow();
    expect((await readdir(parameters.outputRoot)).filter(name => name.startsWith(".lakda-report-"))).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
