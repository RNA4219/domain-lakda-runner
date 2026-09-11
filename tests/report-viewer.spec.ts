import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeReportBundle } from "../src/reporting/bundle-writer.js";
import { getReportRenderer } from "../src/reporting/renderer.js";
import { selectReportMedia } from "../src/reporting/media-policy.js";
import { readArtifactSnapshot } from "../src/runs/artifact-snapshot.js";
import { sha256 } from "../src/core/redaction.js";
import type { ReportMediaCandidate } from "../src/reporting/run-source.js";
import type { ReportView } from "../src/reporting/types.js";

function viewFixture(): ReportView {
  const sources = ["failed", "passed"].map(outcome => ({ id: "run:" + outcome, kind: "run" as const, status: "verified" as const, manifestSha256: "sha256:" + "a".repeat(64), eventHeadDigest: null, producerRevision: "a".repeat(40), targetRevision: "fixture-v1", classification: "internal" as const }));
  const runs = sources.map((source, index) => ({ key: source.id, sourceId: source.id, runId: index ? "通過した実行" : "入力境界", attempt: 1, mode: index ? "adaptive-explore" : "smoke", platform: index ? "android" : "pc-web", executionMode: "fixture", outcome: index ? "passed" as const : "failed" as const, terminationReason: "completed", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", durationMs: 1000, seed: index + 7, producerVersion: "fixture", producerRevision: source.producerRevision, targetRevision: source.targetRevision, acceptanceStatus: "fixture_only", actionCount: 0, plannedActionCount: 0, coverage: [{ name: "states", definition: "このrunの発見範囲", scope: source.id, status: "recorded" as const, numerator: 0, denominator: 0, ratio: null }] }));
  const rows: ReportView["rows"] = runs.map(run => ({ id: run.key, sourceId: run.sourceId, runKey: run.key, kind: "run", status: run.outcome, severity: null, title: run.runId, message: run.terminationReason, at: run.endedAt, ruleId: null, relatedIds: [], evidenceIds: [] }));
  rows.splice(1, 0, { id: "failure:fixture", sourceId: runs[0].sourceId, runKey: runs[0].key, kind: "failure", status: "failure", severity: "high", title: "保存済みメッセージ", message: '<b data-fixture="plain">文字として表示</b>', at: runs[0].endedAt, ruleId: "fixture-rule", relatedIds: ["oracle:fixture"], evidenceIds: [] });
  return { schemaVersion: "lakda/report-view/v1", reportId: "report-ui-fixture", generatedAt: "2026-09-10T00:00:02.000Z", producerVersion: "fixture", profile: "local", generationStatus: "ready", classification: "internal", timeZone: "UTC", inputSourceIds: sources.map(source => source.id), sources, runs, sessions: [], rows,
    timeline: [2, 1].map(sequence => ({ id: "event:" + sequence, sourceId: runs[0].sourceId, runKey: runs[0].key, sequence, at: runs[0].startedAt, kind: "observation", label: "観測 " + sequence, relatedIds: [], evidenceIds: [] })), media: [], issues: [],
    counts: { sources: 2, duplicateSources: 0, runs: 2, workerIncomplete: 0, failures: 1, warnings: 0, findings: 0, actions: 0, events: 2, excludedMedia: 0, plannedActions: 0, unknownActionRuns: 0, outcomes: { passed: 1, failed: 1, partial: 0, error: 0 } } };
}

test.use({ viewport: { width: 1366, height: 768 }, timezoneId: "Asia/Tokyo" });

for (const language of ["ja", "en"] as const) test("result status labels distinguish failed runs from failure items (" + language + ")", async ({ page }, testInfo) => {
  const label = (ja: string, en: string) => language === "en" ? en : ja;
  const view = { ...viewFixture(), language }; const output = testInfo.outputPath("report");
  await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: [], sourceRoots: [], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
  await page.goto(pathToFileURL(join(output, "index.html")).href);
  const status = page.getByRole("combobox", { name: label("状態", "Status"), exact: true });
  await expect(status.locator('option[value="failed"]')).toHaveText(label("実行失敗", "Execution failed"));
  await expect(status.locator('option[value="failure"]')).toHaveText(label("失敗項目", "Failure item"));
  await expect(page.locator(".summary-card").filter({ hasText: label("実行失敗", "Execution failed") })).toHaveCount(1);
  await status.selectOption({ label: label("実行失敗", "Execution failed") });
  await expect(status).toHaveValue("failed"); await expect(page.locator(".result-row")).toHaveCount(1);
  await expect(page.locator(".result-row")).toContainText("入力境界");
  await status.selectOption({ label: label("失敗項目", "Failure item") });
  await expect(status).toHaveValue("failure"); await expect(page.locator(".result-row")).toHaveCount(1);
  await expect(page.locator(".result-row")).toContainText("保存済みメッセージ");
  await page.locator(".result-row").click();
  await expect(page.getByRole("dialog").locator(".detail-heading .badge")).toHaveText([label("失敗項目", "Failure item")]);
  await page.keyboard.press("Escape"); await page.getByRole("button", { name: label("絞り込みを全解除", "Clear all filters"), exact: true }).click();
  const keyword = page.getByRole("searchbox", { name: label("キーワード", "Keyword"), exact: true });
  await keyword.fill(label("実行失敗", "Execution failed")); await expect(page.locator(".result-row")).toHaveCount(1);
  await expect(page.locator(".result-row")).toContainText("入力境界");
  await keyword.fill("failed"); await expect(page.locator(".result-row")).toHaveCount(1);
});

for (const language of ["ja", "en"] as const) test("step workspace follows a failure across pages and keeps its screenshot prominent (" + language + ")", async ({ page }, testInfo) => {
  const label = (ja: string, en: string) => language === "en" ? en : ja;
  const root = await mkdtemp(join(tmpdir(), "lakda-report-steps-ui-"));
  try {
    await page.setViewportSize({ width: 800, height: 460 });
    await page.setContent('<main style="font:20px sans-serif;background:#eef3f6;padding:35px;height:390px"><small>ARTIFICIAL UI FIXTURE</small><h1>注文内容の確認</h1><div style="background:white;padding:22px;border-radius:12px">数量: <strong>0</strong><p style="color:#ab3525">数量は1以上を入力してください</p><button style="padding:10px 35px">次へ</button></div></main>');
    const bytes = await page.screenshot(); const inputRoot = join(root, "input"); const path = "artifacts/step.png";
    await mkdir(dirname(join(inputRoot, path)), { recursive: true }); await writeFile(join(inputRoot, path), bytes);
    const view = { ...viewFixture(), language }; const snapshot = await readArtifactSnapshot(inputRoot, path);
    const media = await selectReportMedia([{ id: "media:" + sha256(path), sourceId: view.sources[0].id, runKey: view.runs[0].key, root: inputRoot, snapshot, artifact: { path, kind: "screenshot", sha256: snapshot.sha256, size_bytes: snapshot.size, classification: "internal", redaction_status: "pending", public_exposure: "none", security_checks: { secrets_scan: "not_applicable", pii_scan: "not_applicable" } } }], { profile: "local" });
    view.media = media.media; view.rows[0].message = label("数量の入力後、次の画面が表示されませんでした。", "The next screen did not appear after entering a quantity.");
    view.timeline = Array.from({ length: 102 }, (_, index) => ({ ...view.timeline[0], id: "event:" + (index + 1), sequence: index + 1, kind: "observation", label: "観測 " + (index + 1), evidenceIds: [] }));
    view.timeline[99] = { ...view.timeline[99], kind: "execution", label: "execution", step: { operation: "click", target: "次へ", status: "executed", durationMs: 120, message: null } };
    view.timeline[100] = { ...view.timeline[100], kind: "oracle", label: "oracle", step: { operation: "assert", target: "次の画面", status: "fail", durationMs: null, message: "次の画面が表示されませんでした。<b>保存された原文</b>" }, evidenceIds: [view.media[0].id] };
    view.timeline[101].label = "oracle fail (legacy text only)";
    view.runs[0].actionCount = 1; view.runs[0].plannedActionCount = 1; view.counts.actions = 1; view.counts.plannedActions = 1;
    view.media[0].scope = "record"; view.media[0].recordIds = [view.timeline[100].id]; view.counts.events = view.timeline.length - 1;
    const output = testInfo.outputPath("report"); await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: media.copies, sourceRoots: [inputRoot], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
    await page.setViewportSize({ width: 1366, height: 900 }); await page.goto(pathToFileURL(join(output, "index.html")).href);
    const opener = page.getByRole("button", { name: label("表示する: 入力境界", "Show: 入力境界"), exact: true }); await opener.click();
    const detail = page.getByRole("dialog"); const technical = detail.locator("details.technical-details"); await expect(technical).not.toHaveAttribute("open", "");
    const chosen = detail.locator('.step-list [aria-pressed="true"]');
    await detail.getByRole("button", { name: label("失敗した手順へ", "Jump to failed step"), exact: true }).click();
    const selected = detail.locator(".step-summary"); await expect(selected).toContainText("#101"); await expect(selected).toContainText(label("失敗", "Failed"));
    await expect(chosen).toBeInViewport({ ratio: 0.99 });
    await expect(selected).toContainText("<b>保存された原文</b>"); await expect(selected.locator("b")).toHaveCount(0);
    const shot = detail.getByRole("img", { name: "screenshot", exact: true }); await expect(shot).toBeInViewport({ ratio: 0.9 });
    expect((await shot.boundingBox())!.width).toBeGreaterThan(350);
    const historyBounds = (await detail.locator(".step-list").boundingBox())!; const evidenceBounds = (await detail.locator(".step-evidence").boundingBox())!;
    expect(evidenceBounds.x).toBeGreaterThan(historyBounds.x + historyBounds.width - 1);
    await page.screenshot({ path: testInfo.outputPath("step-desktop.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.getByRole("button", { name: label("失敗した手順へ", "Jump to failed step"), exact: true }).click();
    await expect(shot).toBeInViewport({ ratio: 0.9 }); expect((await shot.boundingBox())!.width).toBeGreaterThan(350);
    await page.screenshot({ path: testInfo.outputPath("step-desktop-768.png") });
    await detail.getByRole("button", { name: label("次の手順", "Next step"), exact: true }).click(); await expect(selected).toContainText("#102");
    await expect(detail.locator(".step-evidence img")).toHaveCount(0); await expect(selected).toContainText(label("未取得", "Unavailable"));
    await expect(detail.getByRole("button", { name: label("次の手順", "Next step"), exact: true })).toBeDisabled();
    await detail.getByRole("button", { name: label("前の手順", "Previous step"), exact: true }).click();
    await detail.getByRole("button", { name: label("前の手順", "Previous step"), exact: true }).click(); await expect(selected).toContainText("#100"); await expect(selected).toContainText(label("実行済み", "Executed"));
    await expect(chosen).toBeInViewport({ ratio: 0.99 });
    await detail.getByRole("button", { name: label("前の手順", "Previous step"), exact: true }).click(); await expect(selected).toContainText("#99");
    await expect(chosen).toBeInViewport({ ratio: 0.99 });
    await detail.getByRole("button", { name: label("次の手順", "Next step"), exact: true }).click(); await expect(selected).toContainText("#100");
    await expect(chosen).toBeInViewport({ ratio: 0.99 });
    await detail.getByRole("button", { name: label("失敗した手順へ", "Jump to failed step"), exact: true }).click();
    for (const width of [390, 195]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 422 });
      await detail.getByRole("button", { name: label("画像・動画へ", "Jump to media"), exact: true }).click(); await shot.scrollIntoViewIfNeeded();
      expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("step-" + width + ".png") });
    }
    await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const language of ["ja", "en"] as const) test("narrow video controls support playback and pointer seeking (" + language + ")", async ({ page }, testInfo) => {
  const label = (ja: string, en: string) => language === "en" ? en : ja;
  const root = await mkdtemp(join(tmpdir(), "lakda-report-narrow-video-"));
  try {
    const bytes = Buffer.from(await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext("2d")!; const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" }); const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("fixture recording failed")); });
      let frame = 0; const paint = setInterval(() => { context.fillStyle = ++frame % 2 ? "#20344b" : "#325570"; context.fillRect(0, 0, 320, 180); context.fillStyle = "white"; context.font = "24px sans-serif"; context.fillText("FRAME " + frame, 24, 95); }, 100);
      recorder.start(); await new Promise(resolve => setTimeout(resolve, 2200)); recorder.stop(); await stopped;
      clearInterval(paint); stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }));
    const view = { ...viewFixture(), language }; const inputRoot = join(root, "input"); const path = "artifacts/recording.webm";
    await mkdir(dirname(join(inputRoot, path)), { recursive: true }); await writeFile(join(inputRoot, path), bytes);
    const snapshot = await readArtifactSnapshot(inputRoot, path);
    const media = await selectReportMedia([{ id: "media:" + sha256(path), sourceId: view.sources[0].id, runKey: view.runs[0].key, root: inputRoot, snapshot, artifact: { path, kind: "video", sha256: snapshot.sha256, size_bytes: snapshot.size, classification: "internal", redaction_status: "pending", public_exposure: "none", security_checks: { secrets_scan: "not_applicable", pii_scan: "not_applicable" } } }], { profile: "local" });
    view.media = media.media; const output = join(root, "bundle");
    await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: media.copies, sourceRoots: [inputRoot], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
    await page.setViewportSize({ width: 195, height: 422 }); await page.goto(pathToFileURL(join(output, "index.html")).href);
    const opener = page.getByRole("button", { name: label("表示する: 入力境界", "Show: 入力境界"), exact: true }); await opener.click();
    await page.getByRole("button", { name: label("画像・動画へ", "Jump to media"), exact: true }).click();
    const video = page.locator(".media-card video"); const play = page.getByRole("button", { name: label("動画を再生", "Play video"), exact: true });
    const seek = page.getByRole("slider", { name: label("再生位置", "Playback position"), exact: true });
    await expect(video).toHaveJSProperty("paused", true); await expect(video).toHaveAttribute("preload", "none"); await expect(seek).toBeDisabled();
    await play.click(); await expect(video).toHaveJSProperty("paused", false);
    await page.getByRole("button", { name: label("一時停止", "Pause video"), exact: true }).click(); await expect(video).toHaveJSProperty("paused", true);
    await expect(seek).toBeEnabled();
    const bounds = (await seek.boundingBox())!; await seek.click({ position: { x: bounds.width * 0.6, y: bounds.height / 2 } });
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.5);
    const position = await video.evaluate(element => (element as HTMLVideoElement).currentTime); await seek.press("ArrowLeft");
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeLessThan(position);
    await expect(video).toHaveJSProperty("paused", true);
    expect(await page.locator("dialog").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.locator(".video-controls").scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("narrow-video.png") });
    await play.click(); await expect(video).toHaveJSProperty("paused", false); await page.keyboard.press("Escape");
    await expect(video).toHaveJSProperty("paused", true); await expect(opener).toBeFocused();
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const language of ["ja", "en"] as const) test("report explains generation limitations and provides direct media navigation (" + language + ")", async ({ page }, testInfo) => {
  const label = (ja: string, en: string) => language === "en" ? en : ja;
  const root = await mkdtemp(join(tmpdir(), "lakda-report-review-"));
  try {
    const view = { ...viewFixture(), language, generationStatus: "degraded" as const };
    view.issues = [{ code: "coverage-unavailable", severity: "warning", sourceId: view.sources[0].id, message: "元のcoverage未取得メッセージ" }];
    view.rows[0].message = "長い説明 ".repeat(120);
    view.timeline = Array.from({ length: 101 }, (_, index) => ({ ...view.timeline[0], id: "event:" + index, sequence: index + 1 }));
    view.counts.events = view.timeline.length;
    const output = join(root, "bundle");
    await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: [], sourceRoots: [], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    const notice = page.getByRole("note", { name: label("レポートの資料不足", "Report limitations"), exact: true });
    await expect(notice).toBeInViewport();
    await expect(notice.getByText(label("探索coverageは未取得です", "Exploration coverage is unavailable"), { exact: true })).toBeVisible();
    const warnings = page.locator(".summary-facts .field").filter({ has: page.locator("dt", { hasText: label("実行の警告", "Run warnings") }) });
    await expect(warnings.locator("dd")).toHaveText("0");
    await page.screenshot({ path: testInfo.outputPath("limitations.png") });
    await page.setViewportSize({ width: 195, height: 422 });
    const opener = page.getByRole("button", { name: label("表示する: 入力境界", "Show: 入力境界"), exact: true });
    await opener.click();
    const detail = page.getByRole("dialog", { name: label("結果の詳細", "Result details"), exact: true });
    await detail.getByRole("button", { name: label("画像・動画へ", "Jump to media"), exact: true }).click();
    const mediaHeading = detail.getByRole("heading", { name: label("媒体・参照証跡", "Media and referenced evidence"), exact: true });
    await expect(mediaHeading).toBeFocused(); await expect(mediaHeading).toBeInViewport();
    expect(await detail.locator("section > h2").allTextContents()).toEqual([label("操作・event履歴", "Action and event history"), label("媒体・参照証跡", "Media and referenced evidence"), label("探索coverage", "Exploration coverage")]);
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("direct-media.png") });
    await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
    await notice.getByRole("button", { name: label("不足の詳細を見る", "View limitation details"), exact: true }).click();
    await expect(page.getByRole("heading", { name: label("根拠・未確認事項", "Evidence and limitations"), exact: true })).toBeFocused();
    await expect(page.getByText("warning · coverage-unavailable · 元のcoverage未取得メッセージ", { exact: true })).toBeVisible();
    expect(await page.locator("#lakda-report-data").textContent()).toContain("元のcoverage未取得メッセージ");
  } finally { await page.close(); await rm(root, { recursive: true, force: true }); }
});

for (const language of ["ja", "en"] as const) test("report layout prioritizes results and keeps supporting details accessible (" + language + ")", async ({ page }, testInfo) => {
  const label = (ja: string, en: string) => language === "en" ? en : ja;
  const root = await mkdtemp(join(tmpdir(), "lakda-report-layout-"));
  try {
    const view = { ...viewFixture(), language };
    view.rows[1].message += "\n" + "保存された説明と長い識別子 abcdef0123456789 ".repeat(24);
    const output = join(root, "bundle");
    await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: [], sourceRoots: [], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    const first = page.locator(".result-row").first();
    await expect(first).toBeVisible();
    const firstBox = (await first.boundingBox())!;
    expect(firstBox.y + firstBox.height).toBeLessThanOrEqual(900);
    const opener = page.getByRole("button", { name: label("表示する: ", "Show: ") + view.rows[1].title, exact: true });
    await expect(opener.getByText(view.rows[1].message, { exact: true })).toBeVisible();
    await expect(page.locator("b[data-fixture]")).toHaveCount(0);
    const supplementary = page.locator("details").filter({ has: page.locator("summary", { hasText: label("操作件数・実行時間など", "Action counts, timing and more") }) });
    await expect(supplementary).not.toHaveAttribute("open", "");
    await supplementary.locator("summary").focus(); await page.keyboard.press("Enter");
    await expect(supplementary.getByText(label("計画した操作数", "Planned actions"), { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: label("表示タイムゾーン", "Display time zone"), exact: true }).selectOption("local");
    await expect(supplementary).toHaveAttribute("open", "");
    await supplementary.locator("summary").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("overview-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("overview-mobile.png"), fullPage: true });
    await opener.click();
    const detail = page.getByRole("dialog", { name: label("結果の詳細", "Result details"), exact: true });
    await expect(detail.getByText(view.rows[1].message, { exact: true })).toBeVisible();
    await expect(detail.locator("b[data-fixture]")).toHaveCount(0);
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("detail-mobile.png") });
    await detail.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const close = detail.getByRole("button", { name: label("詳細を閉じる", "Close details"), exact: true });
    await expect(close).toBeInViewport();
    await close.click(); await expect(opener).toBeFocused();
  } finally { await page.close(); await rm(root, { recursive: true, force: true }); }
});

test("English report localizes controls and details while preserving recorded text", async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-english-"));
  const requests: string[] = []; page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  try {
    const view = { ...viewFixture(), language: "en" as const };
    view.timeline = Array.from({ length: 101 }, (_, index) => ({ ...view.timeline[0], id: "event:" + (index + 1), sequence: index + 1, label: "観測 " + (index + 1) }));
    view.counts.events = view.timeline.length;
    const output = join(root, "bundle");
    await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: [], sourceRoots: [], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle("Lakda Execution Report");
    await expect(page.getByRole("heading", { name: "Run summary", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Platform", exact: true }).selectOption("pc-web");
    await page.getByLabel("Keyword", { exact: true }).fill("文字として表示");
    await expect(page.getByText("1 / 3 items", { exact: true })).toBeVisible();
    const selected = page.getByRole("button", { name: "Show: 保存済みメッセージ", exact: true });
    await selected.click();
    const detail = page.getByRole("dialog", { name: "Result details", exact: true });
    await expect(detail.getByText('<b data-fixture="plain">文字として表示</b>', { exact: true })).toBeVisible();
    await expect(detail.getByRole("heading", { name: "Action and event history", exact: true })).toBeVisible();
    await detail.getByText("Technical details and run records", { exact: true }).click();
    await expect(detail.getByText("0 / 0 — Nothing to evaluate", { exact: true })).toBeVisible();
    await expect(detail.getByText("観測 1", { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(detail.getByText("Page 2 / 2", { exact: true })).toBeVisible();
    await expect(detail.getByText("観測 101", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Show evidence for the entire run (0 items)", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(selected).toBeFocused();
    await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
    await page.getByRole("combobox", { name: "Display time zone", exact: true }).selectOption("local");
    await expect(page.getByText("Asia/Tokyo", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("english-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("english-mobile.png"), fullPage: true });
    expect(requests).toEqual([]);
  } finally { await page.close(); await rm(root, { recursive: true, force: true }); }
});

test("report reflows long identifiers, filters and pagers at 195 CSS pixels", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-reflow-"));
  try {
    const view = viewFixture();
    view.rows[0].title = "long-unbroken-identifier-".repeat(4);
    view.rows[1].message = "長いメッセージ".repeat(256);
    view.timeline = Array.from({ length: 101 }, (_, index) => ({ ...view.timeline[0], id: "event:" + index, sequence: index + 1 }));
    view.counts.events = 101;
    const output = join(root, "bundle");
    await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: [], sourceRoots: [], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
    await page.setViewportSize({ width: 195, height: 422 });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "表示する: " + view.rows[0].title, exact: true }).click();
    const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const next = detail.getByRole("button", { name: "次のページ", exact: true });
    await next.click();
    await expect(detail.getByText("2 / 2 ページ", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "表示する: " + view.rows[0].title, exact: true })).toBeFocused();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("portable offline report filters with AND, opens details as text and restores keyboard focus", async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-viewer-"));
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  try {
    const output = join(root, "initial");
    await writeReportBundle({ output, view: viewFixture(), renderer: getReportRenderer(), copies: [], sourceRoots: [], inputVerifiedAt: viewFixture().generatedAt, verifyInputs: async () => {} });
    const moved = join(root, "moved"); await rename(output, moved);
    await page.goto(pathToFileURL(join(moved, "index.html")).href);
    await expect(page.getByRole("heading", { name: "結果一覧", exact: true })).toBeVisible();
    await expect(page.getByText("実行数", { exact: true })).toBeVisible();
    await expect(page.getByRole("term").filter({ hasText: /^失敗項目$/ })).toBeVisible();
    await expect(page.getByText("生成状態: ready", { exact: true })).toBeVisible();
    await expect(page.getByText("3 / 3 件", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "対象環境", exact: true }).selectOption("android");
    await expect(page.getByText("1 / 3 件", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "状態", exact: true }).selectOption("failed");
    await expect(page.getByText("該当する結果はありません", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "絞り込みを全解除" }).click();
    await page.getByLabel("キーワード", { exact: true }).fill("文字として表示");
    const selected = page.getByRole("button", { name: "表示する: 保存済みメッセージ", exact: true });
    await selected.focus(); await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
    await expect(detail).toBeVisible();
    await expect(detail.getByText('<b data-fixture="plain">文字として表示</b>', { exact: true })).toBeVisible();
    await expect(detail.locator("b[data-fixture]")).toHaveCount(0);
    await detail.getByText("技術情報・実行記録", { exact: true }).click();
    await expect(detail.getByText("fixture-rule", { exact: true })).toBeVisible();
    await expect(detail.getByText("0 / 0 — 評価対象なし", { exact: true })).toBeVisible();
    expect(await detail.locator("[data-timeline-label]").allTextContents()).toEqual(["観測 1", "観測 2"]);
    await page.keyboard.press("Escape");
    await expect(selected).toBeFocused();
    await page.getByRole("button", { name: "絞り込みを全解除" }).click();
    await page.getByRole("combobox", { name: "表示タイムゾーン", exact: true }).selectOption("local");
    await expect(page.getByText("Asia/Tokyo", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mobile.png"), fullPage: true });
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); await rm(root, { recursive: true, force: true }); }
});

for (const language of ["ja", "en"] as const) test("offline media stays explicitly unverified, orders frames and reports decode failures (" + language + ")", async ({ page }, testInfo) => {
  const label = (ja: string, en: string) => language === "en" ? en : ja;
  const root = await mkdtemp(join(tmpdir(), "lakda-report-viewer-media-"));
  try {
    await page.setContent('<main style="background:#edf5f1;padding:24px"><h1>保存画面 fixture</h1><p>ローカルの表示テスト</p></main>');
    const png = await page.locator("main").screenshot();
    const view = { ...viewFixture(), language };
    const inputRoot = join(root, "source");
    const candidates: ReportMediaCandidate[] = [];
    const inputs: Array<[string, Buffer]> = [["artifacts/frames/frame-0007.png", png], ["artifacts/frames/frame-0002.png", png], ["artifacts/undecodable.png", png.subarray(0, 8)], ["artifacts/video.mp4", Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypisom"), 0, 0, 0, 0])]];
    for (const [path, bytes] of inputs) {
      await mkdir(dirname(join(inputRoot, path)), { recursive: true }); await writeFile(join(inputRoot, path), bytes);
      const snapshot = await readArtifactSnapshot(inputRoot, path);
      candidates.push({ id: "media:" + sha256(path), sourceId: view.sources[0].id, runKey: view.runs[0].key, root: inputRoot, snapshot,
        artifact: { path, kind: "screenshot", sha256: snapshot.sha256, size_bytes: snapshot.size, classification: "internal", redaction_status: "pending", public_exposure: "none", security_checks: { secrets_scan: "not_applicable", pii_scan: "not_applicable" } } });
    }
    const media = await selectReportMedia(candidates, { profile: "local" }); view.media = media.media;
    view.media[0].scope = "record"; view.media[0].recordIds = [view.timeline[0].id];
    view.timeline[0].evidenceIds = [view.media[0].id];
    const output = join(root, "report");
    await writeReportBundle({ output, view, renderer: getReportRenderer(), copies: media.copies, sourceRoots: [inputRoot], inputVerifiedAt: view.generatedAt, verifyInputs: async () => {} });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    await page.getByRole("button", { name: label("表示する: 入力境界", "Show: 入力境界"), exact: true }).click();
    const detail = page.getByRole("dialog", { name: label("結果の詳細", "Result details"), exact: true });
    await expect(detail.getByText(label("未検査・共有対象外", "Unverified; excluded from sharing"), { exact: true })).toHaveCount(4);
    await detail.getByRole("button", { name: label("#2 の証跡を見る (1件)", "View evidence for #2 (1)"), exact: true }).click();
    await expect(detail.locator(".media-card")).toHaveCount(1);
    await expect(detail.getByText(label("選択した履歴: #2 · 観測 2", "Selected history: #2 · 観測 2"), { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: label("履歴の選択を解除", "Clear history selection"), exact: true }).click();
    expect((await detail.locator(".media-card h3").allTextContents()).filter(text => text.startsWith("sampled-frame"))).toEqual(["sampled-frame #2", "sampled-frame #7"]);
    const frame = detail.getByRole("img", { name: "sampled-frame #2", exact: true });
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => frame.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const zoom = detail.locator(".media-card").filter({ has: page.getByRole("img", { name: "sampled-frame #2", exact: true }) }).getByRole("button", { name: label("画像を拡大", "Enlarge image"), exact: true });
    await page.setViewportSize({ width: 195, height: 422 });
    await frame.scrollIntoViewIfNeeded();
    expect((await frame.boundingBox())?.width).toBeGreaterThanOrEqual(100);
    // English may use two readable lines at 195 CSS px; Japanese remains one line.
    expect((await zoom.boundingBox())?.height).toBeLessThanOrEqual(language === "en" ? 72 : 64);
    await page.screenshot({ path: testInfo.outputPath("media-narrow.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
    await zoom.click();
    await expect(detail.getByRole("button", { name: label("画像を縮小", "Fit image"), exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(detail.getByRole("region", { name: label("拡大画像", "Enlarged image"), exact: true })).toBeFocused();
    await detail.getByRole("img", { name: "screenshot", exact: true }).scrollIntoViewIfNeeded();
    await expect(detail.getByText(label("このブラウザでは画像を表示できません。媒体fileで確認してください。", "This browser cannot display the image. Check the media file."), { exact: true })).toBeVisible();
    const video = detail.locator("video");
    await expect(video).toHaveAttribute("preload", "none"); await expect(video).toHaveAttribute("controls", "");
    expect(await video.evaluate(element => (element as HTMLVideoElement).autoplay)).toBe(false);
    await page.setViewportSize({ width: 195, height: 422 });
    const play = detail.getByRole("button", { name: label("動画を再生", "Play video"), exact: true }); await play.click();
    await expect(detail.getByText(label("このブラウザでは動画を表示できません。媒体fileで確認してください。", "This browser cannot display the video. Check the media file."), { exact: true })).toBeVisible();
    await expect(play).toBeDisabled(); await expect(detail.getByRole("slider", { name: label("再生位置", "Playback position"), exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("media.png") });
  } finally { await page.close(); await rm(root, { recursive: true, force: true }); }
});
