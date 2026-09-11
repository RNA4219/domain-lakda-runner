import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactCollector } from "../src/core/artifacts.js";
import { loadConfig } from "../src/core/config.js";
import { exportHate } from "../src/core/hate.js";
import { generateReport } from "../src/reporting/generation.js";
import { sha256 } from "../src/core/redaction.js";
import { loadReportSourceCollection } from "../src/reporting/source-collection.js";
import { resolveReportSources } from "../src/reporting/source-index.js";
import { verifyReportSourcesUnchanged } from "../src/reporting/source-verifier.js";
import { assertReportViewSemantics } from "../src/reporting/view-validation.js";
import type { ReportView } from "../src/reporting/types.js";
import { loadReportRun } from "../src/reporting/run-source.js";
import { loadRunDiagnosticIfAbsent } from "../src/reporting/incomplete-run.js";
import { runLakda } from "../src/core/runner.js";
import { startFixture } from "./fixtures/server.js";

const generation = { producerVersion: "fixture", profile: "local" as const, timeoutMs: 10_000, textOnly: true };
async function started(root: string, classification: "internal" | "restricted" = "internal") {
  return ArtifactCollector.create(loadConfig(undefined, { mode: "smoke", outputDir: join(root, "runs"), seed: 7, baseUrl: "http://127.0.0.1:9", artifacts: { video: false, classification } }), "smoke");
}

test("collector persists a minimal start record before execution and includes its unchanged bytes in HATE", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-incomplete-"));
  try {
    const config = loadConfig(undefined, { mode: "smoke", outputDir: root, seed: 7, baseUrl: "http://127.0.0.1:9", artifacts: { video: false } });
    const collector = await ArtifactCollector.create(config, "smoke", { workerIndex: 0, batchId: "start-fixture" });
    const path = join(collector.paths.runDir, "run-start.json"); const bytes = await readFile(path);
    const record = JSON.parse(bytes.toString());
    expect(record).toEqual({ schemaVersion: "lakda/run-start/v1", runId: collector.metadata.runId, attempt: 1, startedAt: collector.metadata.startedAt, mode: "smoke", seed: 7, workerIndex: 0, batchId: "start-fixture", producerVersion: collector.metadata.producerVersion, producerRevision: collector.metadata.commitSha, classification: "internal" });
    expect(await readdir(collector.paths.runDir)).not.toContain("run-metadata.json");
    const result = await collector.finalize({ schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: 7, baseUrl: config.baseUrl!, actions: [] }, "passed", 0, "not_requested", "completed");
    await exportHate(result.runDir, result.manifestPath);
    expect(await readFile(path)).toEqual(bytes);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    expect(manifest.artifacts.find((artifact: { path: string }) => artifact.path === "run-start.json")).toMatchObject({ size_bytes: bytes.length, classification: "internal", security_checks: { secrets_scan: "pass", pii_scan: "pass" } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("incomplete snapshot and view verification reject updates and invented results", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-incomplete-"));
  try {
    const collector = await started(root); const runDir = collector.paths.runDir; const path = join(runDir, "run-start.json");
    const collection = await loadReportSourceCollection(await resolveReportSources({ runDir }));
    await verifyReportSourcesUnchanged(collection);
    const output = join(root, "report"); await generateReport({ runDir }, { ...generation, output });
    const original = JSON.parse(await readFile(join(output, "report-data.json"), "utf8")) as ReportView;
    const changes: Array<(view: ReportView) => void> = [
      view => { view.counts.incompleteRuns = 2; },
      view => { delete view.incompleteRuns; delete view.counts.incompleteRuns; },
      view => { delete view.sources[0].startRecordSha256; },
      view => { view.rows[0].status = "error"; },
      view => { view.sources[0].status = "verified"; },
      view => { view.incompleteRuns![0].producerRevision = "b".repeat(40); },
      view => { view.profile = "share"; },
    ];
    for (const change of changes) { const view = structuredClone(original); change(view); expect(() => assertReportViewSemantics(view)).toThrow(); }
    const bytes = await readFile(path); const record = JSON.parse(bytes.toString());
    await writeFile(path, JSON.stringify({ ...record, seed: 99 }));
    await expect(verifyReportSourcesUnchanged(collection)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    await writeFile(path, bytes); await writeFile(collector.paths.manifest, "new incomplete manifest");
    await expect(verifyReportSourcesUnchanged(collection)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("completed runs bind their start record to final metadata without changing legacy inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-incomplete-"));
  try {
    const collector = await started(root); const runDir = collector.paths.runDir;
    await collector.finalize({ schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: 7, baseUrl: "http://127.0.0.1:9", actions: [] }, "passed", 0, "not_requested", "completed");
    await exportHate(runDir, collector.paths.manifest);
    await loadReportRun(runDir);
    const path = join(runDir, "run-start.json"); const original = JSON.parse(await readFile(path, "utf8"));
    for (const change of [{ seed: 99 }, { workerIndex: 1 }, { mode: "seeded-random" }, { producerRevision: "a".repeat(40) }, { startedAt: "2000-01-01T00:00:00.000Z" }]) {
      await writeFile(path, JSON.stringify({ ...original, ...change })); await exportHate(runDir, collector.paths.manifest);
      await expect(loadReportRun(runDir)).rejects.toMatchObject({ issueCode: "run-start-binding" });
    }
    await rm(path); await exportHate(runDir, collector.paths.manifest);
    expect((await loadReportRun(runDir)).run?.outcome).toBe("passed");
    await rename(join(runDir, "exports"), join(runDir, "saved-exports"));
    await symlink(join(runDir, "saved-exports"), join(runDir, "exports"), "junction");
    const collection = await loadReportSourceCollection(await resolveReportSources({ runDir }));
    expect(collection.runs[0].run?.outcome).toBe("passed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("start-only local report labels unknown outcomes and ignores all unverified result files", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-incomplete-"));
  try {
    const collector = await started(root); const input = collector.paths.runDir;
    await mkdir(join(input, "run-metadata.json"));
    await writeFile(join(input, "failure-report.json"), '{"message":"password=untrusted-secret user@example.invalid"}');
    const output = join(root, "local");
    const result = await generateReport({ runDir: input }, { ...generation, output });
    expect(result, JSON.stringify(result.receipt)).toMatchObject({ exitCode: 2, receipt: { generationStatus: "degraded" } });
    const text = await readFile(join(output, "report-data.json"), "utf8"); const view = JSON.parse(text);
    expect(view).toMatchObject({ counts: { sources: 1, runs: 0, incompleteRuns: 1, actions: 0, failures: 0, outcomes: { passed: 0, failed: 0, partial: 0, error: 0 } }, incompleteRuns: [{ runId: collector.metadata.runId, seed: 7, status: "unfinalized" }] });
    expect(view.runs).toEqual([]); expect(view.timeline).toEqual([]); expect(view.media).toEqual([]);
    expect(view.sources[0]).toMatchObject({ kind: "run", status: "unverified", manifestSha256: null, startRecordSha256: "sha256:" + sha256(await readFile(join(input, "run-start.json"))) });
    for (const secret of [root, "untrusted-secret", "user@example.invalid"]) expect(text).not.toContain(secret);
    const shared = await generateReport({ runDir: input }, { ...generation, profile: "share", output: join(root, "shared") });
    expect(shared.receipt.generationStatus).toBe("error"); expect(shared.exitCode).toBe(2); expect(await readdir(root)).not.toContain("shared");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("minimal diagnostics never rescue absent start records or existing malformed manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-incomplete-"));
  try {
    const collector = await started(root); const input = collector.paths.runDir;
    const manifest = join(input, "exports", "artifact-manifest.json");
    for (const kind of ["directory", "invalid-json"]) {
      if (kind === "directory") await mkdir(manifest); else await writeFile(manifest, "invalid manifest");
      const result = await generateReport({ runDir: input }, { ...generation, output: join(root, kind) });
      expect(result.receipt.generationStatus).toBe("error"); expect(result.exitCode).toBe(2);
      await rm(manifest, { recursive: true });
    }
    await rm(join(input, "run-start.json"));
    const missing = await generateReport({ runDir: input }, { ...generation, output: join(root, "missing") });
    expect(missing.receipt.generationStatus).toBe("error"); expect(missing.exitCode).toBe(2);
    const restricted = await started(root, "restricted");
    const result = await generateReport({ runDir: restricted.paths.runDir }, { ...generation, output: join(root, "restricted") });
    expect(result.receipt.generationStatus).toBe("degraded");
    const text = await readFile(join(root, "restricted", "report-data.json"), "utf8"); const view = JSON.parse(text);
    expect(view.sources).toHaveLength(1); expect(view.sources[0].status).toBe("restricted"); expect(view.rows).toEqual([]);
    expect(text).not.toContain(restricted.metadata.runId); expect(view.incompleteRuns).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid start contracts and conflicting incomplete copies are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-incomplete-"));
  try {
    const collector = await started(root); const path = join(collector.paths.runDir, "run-start.json");
    const bytes = await readFile(path); const record = JSON.parse(bytes.toString());
    for (const value of [
      { ...record, schemaVersion: "lakda/run-start/v99" }, { ...record, startedAt: "invalid" },
      { ...record, startedAt: "2000-01-01T01:00:00.000+01:00" }, { ...record, baseUrl: "http://fixture.invalid" },
      { ...record, runId: "C:\\private\\run" }, { ...record, workerIndex: 4 },
      { ...record, arbitraryData: "x".repeat(4096) },
    ]) {
      await writeFile(path, JSON.stringify(value)); await expect(loadRunDiagnosticIfAbsent(collector.paths.runDir)).rejects.toThrow();
    }
    await writeFile(path, bytes);
    const copy = join(root, "copy"); await mkdir(copy); await writeFile(join(copy, "run-start.json"), bytes);
    const sources = join(root, "sources.json");
    await writeFile(sources, JSON.stringify({ schemaVersion: "lakda/report-sources/v1", root: ".", entries: [{ kind: "run", path: "runs/" + basename(collector.paths.runDir) }, { kind: "run", path: "copy" }] }));
    const collection = await loadReportSourceCollection(await resolveReportSources({ sources }));
    expect(collection.explicitSourceCount).toBe(1); expect(collection.duplicateSources).toBe(1); expect(collection.diagnosticSnapshots).toHaveLength(2);
    await writeFile(join(copy, "run-start.json"), JSON.stringify({ ...record, seed: 99 }));
    await expect(verifyReportSourcesUnchanged(collection)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    await expect(loadReportSourceCollection(await resolveReportSources({ sources }))).rejects.toMatchObject({ issueCode: "conflicting-source" });
    await writeFile(join(copy, "run-start.json"), bytes);
    await collector.finalize({ schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: 7, baseUrl: "http://127.0.0.1:9", actions: [] }, "passed", 0, "not_requested", "completed");
    await exportHate(collector.paths.runDir, collector.paths.manifest);
    await expect(loadReportSourceCollection(await resolveReportSources({ sources }))).rejects.toMatchObject({ issueCode: "conflicting-source" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a start-record collision preserves existing evidence and stops before contacting the target", async () => {
  let requests = 0;
  const fixture = await startFixture(() => { requests++; return { body: "<main>Unused target</main>" }; });
  const root = await mkdtemp(join(tmpdir(), "lakda-report-incomplete-"));
  const random = Math.random;
  try {
    const runDir = join(root, "lakda-run-1970-01-01T00-00-00-000Z-8"); await mkdir(runDir);
    const path = join(runDir, "run-start.json"); await writeFile(path, "existing evidence");
    Math.random = () => 0.5;
    await expect(runLakda(loadConfig(undefined, { mode: "smoke", baseUrl: fixture.baseUrl, outputDir: root }), undefined, { clock: () => 0 })).rejects.toMatchObject({ code: "EEXIST" });
    expect(requests).toBe(0); expect(await readFile(path, "utf8")).toBe("existing evidence");
  } finally { Math.random = random; await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
