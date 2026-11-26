import { expect, test } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { sha256 } from "../src/core/redaction.js";
import { assertReportViewSemantics } from "../src/reporting/view-validation.js";
import { scenarioDurations, sumScenarioDurations } from "../src/runs/measurements.js";

async function json(file: string) { return JSON.parse(await readFile(file, "utf8")); }

test("CLI imports delayed passed and failed results, verifies their trend and a portable report", async () => {
  const info = test.info();
  const root = info.outputDir, runs = join(root, "runs"), input = info.outputPath("result.json");
  const index = join(root, "index.json");
  const cases = [
    { generated_at: "2026-11-12T01:39:22Z", status: "passed", times: [63070, 100000] },
    { generated_at: "2026-11-19T01:08:39Z", status: "failed", times: [100000, 3305] },
  ] as const;
  for (const c of cases) {
    await writeFile(input, JSON.stringify({ layer: "device", generated_at: c.generated_at,
      scenario_results: c.times.map((duration_ms, n) => ({ status: n === 0 ? "passed" : c.status, duration_ms, browser: "chromium" })),
      executionMode: "real", browser: "chromium" }));
    expect(await runCli(["import", "e2e", "--result", input, "--output-dir", runs])).toBe(0);
  }
  const refs = (await readdir(runs)).filter(p => p.startsWith("lakda-run-"));
  const entries = refs.map(runRef => ({ runRef, scenarioId: "suite", caseRevision: "v1", environment: "local", browser: "external", evidenceKind: "unknown" }));
  async function trend(name: string, rows = entries) {
    await writeFile(index, JSON.stringify({ schemaVersion: "lakda/trend-index/v1", runs: rows }));
    return runCli(["runs", "trend", "--index", index, "--runs-dir", runs, "--out", join(root, name)]);
  }
  expect(await trend("trend")).toBe(0);
  const [series] = (await json(join(root, "trend", "trend.json"))).series;
  expect(series).toMatchObject({ browser: "external", passed: 1, failed: 1, duration: { count: 2, medianMs: 103305, p95Ms: null } });
  expect(series.runs.map((r: { durationMs: number }) => r.durationMs)).toEqual([163070, 103305]);
  expect(await readFile(join(root, "trend", "index.html"), "utf8")).toContain("<td>external</td>");
  expect(await trend("incorrect", entries.map(row => ({ ...row, browser: "chromium" })))).toBe(1);
  expect(await trend("promotion", entries.map(row => ({ ...row, evidenceKind: "real" })))).toBe(1);
  for (const [n, run] of series.runs.entries()) {
    const dir = join(runs, run.runRef), meta = await json(join(dir, "run-metadata.json"));
    const out = join(root, "report-" + n);
    expect(meta).toMatchObject({ mode: "external-playwright", integration: { layer: "device" }, browser: "external", outcome: cases[n].status });
    expect(meta.executionMode).toBeUndefined();
    expect(meta.startedAt).toBe(new Date(cases[n].generated_at).toISOString());
    expect(await runCli(["report", "generate", "--run-dir", dir, "--out", out])).toBe(2); // No native action history.
    const view = await json(join(out, "report-data.json"));
    expect(view.runs[0]).toMatchObject({ startedAt: meta.startedAt, endedAt: meta.endedAt, durationMs: run.durationMs, platform: null, importedResult: { browser: "external" } });
    expect(await runCli(["report", "verify", "--report-dir", out])).toBe(0);
    view.runs[0].durationMs = Date.parse(meta.endedAt) - Date.parse(meta.startedAt);
    expect(() => assertReportViewSemantics(view)).toThrow();
  }
});

test("persisted legacy defaults cannot label devices or unknown runs as Chromium", async () => {
  const info = test.info();
  const input = info.outputPath("result.json"), runs = join(info.outputDir, "runs");
  await writeFile(input, JSON.stringify({ generated_at: "2026-11-10T00:00:00Z", layer: "browser",
    scenario_results: [{ status: "failed", browser: "chromium", duration_ms: 0 }] }));
  expect(await runCli(["import", "e2e", "--result", input, "--output-dir", runs])).toBe(0);
  const ref = (await readdir(runs)).find(p => p.startsWith("lakda-run-"))!;
  const dir = join(runs, ref), metaFile = join(dir, "run-metadata.json"), manifestFile = join(dir, "exports/artifact-manifest.json");
  const original = await json(metaFile), manifest = await json(manifestFile);
  expect(original.browser).toBe("chromium");
  for (const [i, spec] of [
    { layer: "browser", rows: original.scenario_results, label: "chromium", want: 0 },
    { layer: "device", rows: original.scenario_results, label: "external", want: 0 },
    { layer: "browser", rows: [{ duration_ms: 3 }, {}], label: "external", want: null },
    { layer: "unknown", rows: undefined, label: "external", want: null },
  ].entries()) {
    const bytes = Buffer.from(JSON.stringify({ ...original, seed: 0, browser: "chromium", integration: { layer: spec.layer }, scenario_results: spec.rows }));
    await writeFile(metaFile, bytes);
    Object.assign(manifest.artifacts[0], { sha256: "sha256:" + sha256(bytes), size_bytes: bytes.length });
    await writeFile(manifestFile, JSON.stringify(manifest));
    const index = join(info.outputDir, "index.json"), out = join(info.outputDir, "trend-" + i);
    const row = { runRef: ref, scenarioId: "case", caseRevision: "r1", environment: "local", browser: spec.label, evidenceKind: "unknown" };
    await writeFile(index, JSON.stringify({ schemaVersion: "lakda/trend-index/v1", runs: [row] }));
    expect(await runCli(["runs", "trend", "--index", index, "--runs-dir", runs, "--out", out])).toBe(0);
    const [series] = (await json(join(out, "trend.json"))).series;
    expect(series.duration).toEqual({ count: spec.want === null ? 0 : 1, medianMs: spec.want, p95Ms: null });
    const report = join(info.outputDir, "report-" + i);
    expect(await runCli(["report", "generate", "--run-dir", dir, "--out", report])).toBe(2);
    expect((await json(join(report, "report-data.json"))).runs[0]).toMatchObject({ durationMs: spec.want, importedResult: { browser: spec.label } });
    await writeFile(index, JSON.stringify({ schemaVersion: "lakda/trend-index/v1", runs: [{ ...row, browser: spec.label === "external" ? "chromium" : "external" }] }));
    expect(await runCli(["runs", "trend", "--index", index, "--runs-dir", runs, "--out", out + "-wrong"])).toBe(1);
    expect(await readFile(metaFile)).toEqual(bytes);
    expect(await readFile(manifestFile, "utf8")).toBe(JSON.stringify(manifest));
  }
});

test("invalid results and unrelated authorization flags cannot create an import", async () => {
  const input = test.info().outputPath("result.json"), runs = test.info().outputPath("runs");
  const args = ["import", "e2e", "--result", input, "--output-dir", runs], scenario = { status: "passed" };
  for (const [generated_at, rows, status] of [
    [undefined, [scenario], "passed"], ["2026-11-10T00:00:00Z", [], "passed"],
    ["2026-11-10T00:00:00Z", [{ status: "skipped" }], "passed"], ["2026-11-10T00:00:00Z", [scenario], "failed"],
  ]) {
    await writeFile(input, JSON.stringify({ generated_at, scenario_results: rows, status }));
    expect(await runCli(args)).not.toBe(0);
  }
  await writeFile(input, "invalid result");
  expect(await runCli(args)).toBe(1);
  expect(await runCli([...args, "--execution-mode", "real"])).not.toBe(0);
  await expect(readdir(runs)).rejects.toMatchObject({ code: "ENOENT" });
});

test("sum requires a complete set of finite nonnegative timings, including zero", () => {
  for (const value of [null, "7", -1, Infinity, NaN, undefined, Number.MAX_SAFE_INTEGER]) {
    expect(sumScenarioDurations(scenarioDurations([{ duration_ms: 1 }, { duration_ms: value }]))).toBeNull();
  }
  expect(sumScenarioDurations(scenarioDurations([]))).toBeNull();
  expect(sumScenarioDurations(scenarioDurations([{ duration_ms: 0 }, { duration_ms: 1.5 }]))).toBe(1.5);
});
