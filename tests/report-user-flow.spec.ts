import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { ReportView } from "../src/reporting/types.js";

async function cli(args: string[]) {
  const child = spawn(process.execPath, [resolve("dist/cli.js"), ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
  const code = await new Promise<number | null>((accept, reject) => { child.on("error", reject); child.on("close", accept); });
  return { code, stdout, stderr };
}

for (const outcome of ["passed", "failed"] as const) test("CLI to report workflow on the reference application: " + outcome, async ({ page }, testInfo) => {
  const root = testInfo.outputPath("workflow"); await mkdir(root, { recursive: true });
  // Use an ordinary short output root: Windows file viewers cannot open deeply nested media paths.
  const reportRoot = await mkdtemp(join(resolve(".lakda"), "flow-"));
  await writeFile(join(root, "report-root.txt"), reportRoot);
  const html = await readFile("docs/index.html");
  const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html); });
  await new Promise<void>(accept => server.listen(0, "127.0.0.1", accept));
  try {
    const baseUrl = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const actions = [{ id: "open-reference", kind: "navigate", path: "/" }, ...Array.from({ length: outcome === "failed" ? 3 : 2 }, (_, index) => ({ id: "advance-" + (index + 1), kind: "click", locator: { testId: "advance" }, accessibleName: "次へ" }))];
    const configPath = join(root, "lakda.config.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "lakda/v1", baseUrl, outputDir: join(root, "runs"), durationMs: 5000, maxActions: 5, workers: 1, seed: 4219, actionCatalog: actions, profiles: { smoke: { actionIds: actions.map(action => action.id) } }, safety: { allowHosts: ["127.0.0.1"], maxActionsPerMinute: 30 }, llm: { enabled: false }, artifacts: { video: "retain-on-non-pass" } }, null, 2));
    const execution = await cli(["run", "--config", configPath, "--mode", "smoke", "--base-url", baseUrl, "--report-dir", reportRoot]);
    await writeFile(join(root, "run.stdout.json"), execution.stdout); await writeFile(join(root, "run.stderr.log"), execution.stderr);
    const run = JSON.parse(execution.stdout); expect(run.outcome, execution.stderr).toBe(outcome);
    expect(execution.code).toBe(outcome === "passed" ? 0 : 2);
    const notice = execution.stderr.split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(entry => entry?.report);
    expect(notice, execution.stderr).toBeTruthy(); expect(notice.report.generationStatus).toBe("ready");
    const view: ReportView = JSON.parse(await readFile(join(notice.directory, "report-data.json"), "utf8"));
    expect(view.counts.actions).toBe(actions.length); expect(view.runs[0].outcome).toBe(outcome);
    const verification = await cli(["report", "verify", "--report-dir", notice.directory]);
    expect(verification.code, verification.stdout).toBe(0); await writeFile(join(root, "verify.json"), verification.stdout);
    await page.context().setOffline(true); await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(pathToFileURL(join(notice.directory, "index.html")).href);
    await page.getByRole("button", { name: "表示する: " + view.rows.find(row => row.kind === "run")!.title, exact: true }).click();
    const detail = page.getByRole("dialog"); await page.screenshot({ path: testInfo.outputPath("run-details.png") });
    if (outcome === "failed") {
      expect(view.media.filter(item => item.path).map(item => item.kind)).toEqual(expect.arrayContaining(["screenshot", "video", "trace"]));
      await detail.getByRole("button", { name: "失敗した手順へ", exact: true }).click();
      await expect(detail.locator(".step-summary")).toContainText("advance-3");
      await page.screenshot({ path: testInfo.outputPath("failed-step.png") });
      await expect(detail.locator(".step-evidence img")).toHaveCount(0);
      await detail.getByRole("button", { name: /^実行全体の証跡を見る/ }).click();
      await expect(detail.locator(".step-summary")).toContainText("advance-3");
      await expect(detail.getByText("実行全体の証跡です。この手順との対応は未確認です。", { exact: true })).toBeVisible();
      const picture = detail.getByRole("img", { name: "screenshot", exact: true }); await picture.scrollIntoViewIfNeeded();
      await expect(picture).toBeVisible(); await expect.poll(() => picture.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(detail.locator("video")).toHaveJSProperty("paused", true);
      await page.screenshot({ path: testInfo.outputPath("failed-step-run-evidence.png") });
      await detail.getByRole("button", { name: "画像を拡大", exact: true }).click();
      await picture.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("screenshot-original-pixels.png") });
      await detail.getByRole("button", { name: "画像を縮小", exact: true }).click();
      const video = detail.locator("video"); const retained = await video.elementHandle();
      await video.evaluate(media => { (media as HTMLVideoElement).muted = true; }); await video.focus(); await page.keyboard.press("Space");
      await expect(video).toHaveJSProperty("paused", false);
      await expect.poll(() => video.evaluate(media => (media as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath("recorded-video-playing.png") });
      await detail.getByRole("button", { name: "前の手順", exact: true }).click();
      await expect(detail.locator(".step-summary")).toContainText("advance-2"); await expect(detail.locator("video")).toHaveCount(0);
      expect(await retained!.evaluate(media => (media as HTMLVideoElement).paused)).toBe(true);
      const position = await retained!.evaluate(media => (media as HTMLVideoElement).currentTime);
      await detail.getByRole("button", { name: "次の手順", exact: true }).click();
      await detail.getByRole("button", { name: /^実行全体の証跡を見る/ }).click();
      await expect(video).toHaveJSProperty("paused", true);
      expect(Math.abs(await video.evaluate(media => (media as HTMLVideoElement).currentTime) - position)).toBeLessThan(0.02); await retained!.dispose();
    } else await expect(detail.locator("video, img")).toHaveCount(0);
    const english = join(reportRoot, "english");
    const regenerated = await cli(["report", "generate", "--run-dir", dirname(run.actionSequencePath), "--out", english, "--report-language", "en"]);
    expect(regenerated.code, regenerated.stdout).toBe(0);
    const translated: ReportView = JSON.parse(await readFile(join(english, "report-data.json"), "utf8"));
    expect(translated.counts).toEqual(view.counts); expect(translated.language).toBe("en");
    await page.goto(pathToFileURL(join(english, "index.html")).href); await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.screenshot({ path: testInfo.outputPath("english-overview.png") });
    if (outcome === "failed") {
      await page.getByRole("button", { name: "Show: " + translated.rows.find(row => row.kind === "run")!.title, exact: true }).click();
      await detail.getByRole("button", { name: "Jump to failed step", exact: true }).click();
      await detail.getByRole("button", { name: /^Show evidence for the entire run/ }).click();
      await expect(detail.getByText("Evidence for the entire run. Its relationship to this step is unconfirmed.", { exact: true })).toBeVisible();
      await detail.getByRole("img", { name: "screenshot", exact: true }).scrollIntoViewIfNeeded();
      await expect.poll(() => detail.getByRole("img", { name: "screenshot", exact: true }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath("english-step-evidence.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await detail.getByRole("img", { name: "screenshot", exact: true }).scrollIntoViewIfNeeded();
      expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("english-mobile-evidence.png") });
    }
  } finally { server.closeAllConnections(); await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); }
});
