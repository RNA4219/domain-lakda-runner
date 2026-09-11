import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { readdirSync, writeFileSync } from "node:fs";
import { runCli } from "../src/cli.js";
import { startFixture } from "./fixtures/server.js";

async function invoke(args: string[]) {
  const stdout: string[] = []; const stderr: string[] = [];
  const original = { log: console.log, error: console.error };
  console.log = (...values: unknown[]) => { stdout.push(values.map(String).join(" ")); };
  console.error = (...values: unknown[]) => { stderr.push(values.map(String).join(" ")); };
  try { return { code: await runCli(args), stdout, stderr }; }
  finally { console.log = original.log; console.error = original.error; }
}
const notices = (lines: string[]) => lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(value => value?.report?.schemaVersion === "lakda/report-receipt/v1");
async function config(root: string, workers = 1) {
  const path = join(root, "config.json");
  await writeFile(path, JSON.stringify({ outputDir: join(root, "runs"), workers, artifacts: { video: false }, candidates: [{ id: "root", kind: "navigate", path: "/" }] }));
  return path;
}

for (const status of [200, 500]) test(`run and replay preserve HTTP ${status} outcomes while generating independent reports`, async () => {
  const fixture = await startFixture(() => ({ status, body: "<main>Runtime fixture</main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-report-runtime-"));
  try {
    const path = await config(root); const reports = join(root, "reports");
    const language = status === 200 ? "en" : "ja";
    const flags = ["--config", path, "--base-url", fixture.baseUrl, "--report-dir", reports, "--report-language", language];
    const first = await invoke(["run", "--mode", "smoke", ...flags]);
    expect(first.stdout).toHaveLength(1); expect(first.code).toBe(status === 200 ? 0 : 2);
    expect(notices(first.stderr), first.stderr.join("\n")).toHaveLength(1);
    const original = JSON.parse(first.stdout[0]); const notice = notices(first.stderr)[0];
    expect(notice.report.generationStatus).toBe("ready");
    expect(original).not.toHaveProperty("report");
    const data = JSON.parse(await readFile(join(notice.directory, "report-data.json"), "utf8"));
    expect(data.runs[0].outcome).toBe(original.outcome); expect(data.counts.runs).toBe(1);
    expect(data.language).toBe(language);
    const replay = await invoke(["replay", "--input", original.actionSequencePath, ...flags]);
    expect(replay.code).toBe(first.code); expect(replay.stdout).toHaveLength(1); expect(notices(replay.stderr)).toHaveLength(1);
    expect(notices(replay.stderr)[0].report.reportId).not.toBe(notice.report.reportId);
    expect(JSON.parse(await readFile(join(notices(replay.stderr)[0].directory, "report-data.json"), "utf8")).language).toBe(language);
    expect((await invoke(["report", "verify", "--report-dir", notice.directory])).code).toBe(0);
    expect((await readdir(reports)).filter(name => name.endsWith(".receipt.json"))).toHaveLength(2);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("batch completion generates once and its private source index supports regeneration", async ({ page }, testInfo) => {
  const fixture = await startFixture(() => ({ body: "<main>Batch fixture</main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-report-runtime-"));
  try {
    const path = await config(root, 2); const reports = join(root, "reports");
    const result = await invoke(["run", "--mode", "smoke", "--config", path, "--base-url", fixture.baseUrl, "--report-dir", reports]);
    expect(result.code, result.stderr.join("\n")).toBe(0); expect(result.stdout).toHaveLength(1);
    const batch = JSON.parse(result.stdout[0]); expect(batch).toMatchObject({ schemaVersion: "lakda/run-batch/v1", requestedWorkers: 2, completedWorkers: 2 });
    expect(notices(result.stderr)).toHaveLength(1); const notice = notices(result.stderr)[0];
    const view = JSON.parse(await readFile(join(notice.directory, "report-data.json"), "utf8"));
    expect(view.counts).toMatchObject({ sources: 1, runs: 2, workerIncomplete: 0 });
    expect(view.batches[0]).toMatchObject({ batchId: batch.batchId, requestedWorkers: 2, completedWorkers: 2 });
    const requests: string[] = []; page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(pathToFileURL(join(notice.directory, "index.html")).href);
    await expect(page.getByRole("heading", { name: "worker batch", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "表示する: worker 0", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "結果の詳細" });
    await expect(detail.locator("[data-timeline-label]")).toHaveCount(view.runs.find((run: { runId: string }) => run.runId === batch.workerResults[0].result.runId).actionCount);
    await expect(detail.locator(".field").filter({ has: page.locator("dt", { hasText: /^batch ID$/ }) }).locator("dd")).toHaveText(batch.batchId);
    await page.keyboard.press("Escape");
    await page.locator("summary").filter({ hasText: view.batches[0].sourceId }).click();
    await expect(page.getByText("batch index SHA-256", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: testInfo.outputPath("batch-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("batch-mobile.png"), fullPage: true }); await page.close();
    const regenerated = await invoke(["report", "generate", "--sources", notice.sourcesPath, "--out", join(root, "regenerated")]);
    expect(regenerated.code, regenerated.stderr.join("\n")).toBe(0);
    expect(JSON.parse(await readFile(join(root, "regenerated", "report-data.json"), "utf8")).counts).toEqual(view.counts);
    expect((await readdir(reports)).filter(name => name.endsWith(".receipt.json"))).toHaveLength(1);
    const replay = await invoke(["replay", "--input", batch.workerResults[0].result.actionSequencePath, "--config", path, "--base-url", fixture.baseUrl, "--report-dir", reports]);
    expect(replay.code).toBe(0); expect(notices(replay.stderr)).toHaveLength(1);
    expect(notices(replay.stderr)[0].report.generationStatus, replay.stderr.join("\n")).toBe("ready");
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("all workers failing before run creation still produce a diagnostic batch report", async ({ page }) => {
  let requests = 0;
  const fixture = await startFixture(() => { requests++; return { body: "<main>Unused target</main>" }; });
  const root = await mkdtemp(join(tmpdir(), "lakda-report-runtime-"));
  try {
    const path = await config(root, 2); await writeFile(join(root, "runs"), "cannot create a run here");
    const result = await invoke(["run", "--mode", "smoke", "--config", path, "--base-url", fixture.baseUrl, "--report-dir", join(root, "reports")]);
    expect(result.code).toBe(1); expect(result.stdout).toHaveLength(1); expect(requests).toBe(0);
    expect(JSON.parse(result.stdout[0])).toMatchObject({ outcome: "error", requestedWorkers: 2, completedWorkers: 0 });
    expect(notices(result.stderr)).toHaveLength(1); const notice = notices(result.stderr)[0];
    expect(notice.report.generationStatus, result.stderr.join("\n")).toBe("degraded");
    const view = JSON.parse(await readFile(join(notice.directory, "report-data.json"), "utf8"));
    expect(view.counts).toMatchObject({ runs: 0, workerIncomplete: 2 });
    await page.goto(pathToFileURL(join(notice.directory, "index.html")).href);
    await page.getByRole("button", { name: "表示する: worker 1", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "結果の詳細" });
    await expect(detail.locator(".technical-details")).not.toHaveAttribute("open", "");
    await expect(detail.getByText("確定済みrunなし", { exact: true })).toBeVisible();
    await expect(detail.locator(".field").filter({ has: page.locator("dt", { hasText: /^seed$/ }) }).locator("dd")).toHaveText(String(view.batches[0].workers[1].seed));
    await expect(detail.getByText("worker実行未完了", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("worker-status.png") }); await page.close();
    expect(await readFile(join(root, "runs"), "utf8")).toBe("cannot create a run here");
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("runtime report preflight, off and output failures preserve the execution boundary", async () => {
  let requests = 0;
  const fixture = await startFixture(() => { requests++; return { body: "<main>Fixture</main>" }; });
  const root = await mkdtemp(join(tmpdir(), "lakda-report-runtime-"));
  try {
    const path = await config(root); const reports = join(root, "reports");
    const args = ["run", "--mode", "smoke", "--config", path, "--base-url", fixture.baseUrl, "--report-dir", reports];
    const invalid = await invoke([...args, "--report-config", join(root, "missing.json")]);
    expect(invalid.code).toBe(2); expect(requests).toBe(0); expect(invalid.stdout).toEqual([]);
    const disabled = await invoke([...args, "--report", "off"]);
    expect(disabled.code).toBe(0); expect(disabled.stderr).toEqual([]); expect(await readdir(root)).not.toContain("reports");
    await writeFile(reports, "occupied");
    const failed = await invoke(args); expect(failed.code).toBe(0); expect(failed.stdout).toHaveLength(1);
    expect(notices(failed.stderr)[0].report.generationStatus).toBe("error"); expect(await readFile(reports, "utf8")).toBe("occupied");
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("an absent manifest produces an automatic diagnostic without inventing a run outcome", async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-runtime-"));
  const fixture = await startFixture(() => {
    const runs = readdirSync(join(root, "runs"));
    if (runs.length !== 1) throw new Error("Expected one test-owned run");
    writeFileSync(join(root, "runs", runs[0], "artifacts", "unsupported.bin"), "fixture unsupported artifact");
    return { body: "<main>Artifact finalization fixture</main>" };
  });
  try {
    const path = await config(root);
    const result = await invoke(["run", "--mode", "smoke", "--config", path, "--base-url", fixture.baseUrl, "--report-dir", join(root, "reports")]);
    expect(result.code).toBe(1); expect(result.stdout).toHaveLength(1);
    const execution = JSON.parse(result.stdout[0]); expect(execution).toMatchObject({ outcome: "error", terminationReason: "artifact_failure" });
    expect(execution.artifactManifestPath).toBeUndefined();
    const notice = notices(result.stderr)[0]; expect(notice.report.generationStatus, result.stderr.join("\n")).toBe("degraded");
    const view = JSON.parse(await readFile(join(notice.directory, "report-data.json"), "utf8"));
    expect(view.counts).toMatchObject({ runs: 0, incompleteRuns: 1, outcomes: { passed: 0, failed: 0, partial: 0, error: 0 } });
    expect(view.incompleteRuns[0].runId).toBe(execution.runId);
    expect((await invoke(["report", "verify", "--report-dir", notice.directory])).code).toBe(0);
    const network: string[] = []; page.on("request", request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.goto(pathToFileURL(join(notice.directory, "index.html")).href);
    await expect(page.getByText("結果未確定run", { exact: true })).toBeVisible();
    await expect(page.getByText("確定した実行結果なし", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "表示する: " + execution.runId, exact: true }).click();
    const detail = page.getByRole("dialog", { name: "結果の詳細" });
    await expect(detail.locator(".field").filter({ has: page.locator("dt", { hasText: /^seed$/ }) }).locator("dd")).toHaveText(String(view.incompleteRuns[0].seed));
    await expect(detail.locator(".field").filter({ has: page.locator("dt", { hasText: /^観測済みattempt数$/ }) }).locator("dd")).toHaveText("未取得");
    await expect(detail.getByText("未確定runの媒体は検証できないため表示しません。", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await page.locator("summary").filter({ hasText: view.sources[0].id }).click();
    await expect(page.getByText("開始記録 SHA-256", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("incomplete-run.png"), fullPage: true });
    expect(network).toEqual([]); await page.close();
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
