/* global document, innerWidth, innerHeight, devicePixelRatio, visualViewport, requestAnimationFrame, Event, performance */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { matchesZoom, summarize } from "./metrics.mjs";

async function checkFlows(page, result, root) {
  const keyword = page.getByRole("searchbox", { name: "キーワード", exact: true });
  const clear = page.getByRole("button", { name: "絞り込みを全解除", exact: true });
  const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
  await clear.click();
  await keyword.focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "表示順", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await expect(clear).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".result-row").first()).toBeFocused();
  await page.keyboard.press("Enter"); await expect(detail).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator(".result-row").first()).toBeFocused();
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(page.getByText("2 / 44 ページ", { exact: true })).toBeVisible();
  const opener = page.locator(".result-row").first();
  await opener.focus(); await page.keyboard.press("Enter");
  await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
  await expect(page.getByText("2 / 44 ページ", { exact: true })).toBeVisible();
  await keyword.fill("group-even");
  await expect(page.getByText("500 / 1100 件", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "状態", exact: true }).selectOption("failed");
  await expect(page.getByText("該当する結果はありません", { exact: true })).toBeVisible();
  await clear.click(); await keyword.fill("group-even");
  await page.locator(".result-row").first().click();
  const message = detail.locator(".field").filter({ has: page.locator("dt", { hasText: /^message$/ }) }).locator("dd");
  assert.equal((await message.textContent()).length, 2048);
  assert.equal(await detail.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: join(root, "detail.png"), fullPage: true });
  await page.keyboard.press("Escape"); await expect(keyword).toHaveValue("group-even");
  await keyword.fill("benchmark-000");
  await page.getByRole("button", { name: "表示する: benchmark-000", exact: true }).click();
  const history = detail.locator("section").filter({ has: page.getByRole("heading", { name: "操作・event履歴", exact: true }) });
  await expect(history).toBeVisible();
  const next = history.getByRole("button", { name: "次のページ", exact: true });
  const expectedHistory = await page.evaluate(() => JSON.parse(document.getElementById("lakda-report-data").textContent).runs.find(run => run.runId === "benchmark-000").actionCount);
  await expect(history.getByText(expectedHistory + " 件 · 元sequence順 · 計画は実行済みを意味しません", { exact: true })).toBeVisible();
  await expect(next).toHaveCount(expectedHistory > 100 ? 1 : 0);
  if (expectedHistory > 100) { await next.click(); await expect(history.getByText("2 / 100 ページ", { exact: true })).toBeVisible(); }
  await page.keyboard.press("Escape");
  await clear.click();
  await page.getByRole("combobox", { name: "表示タイムゾーン", exact: true }).selectOption("local");
  await expect(page.getByText("Asia/Tokyo", { exact: true })).toBeVisible();
  await keyword.fill("no-matching-benchmark-record");
  await expect(page.getByText("該当する結果はありません", { exact: true })).toBeVisible();
  await clear.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(root, "overview.png"), fullPage: true });
  result.flows = "passed";
}

export async function measureBrowser(bundle, root, channel, viewport, zoom) {
  await mkdir(root);
  const profile = join(root, "profile"); await mkdir(join(profile, "Default"), { recursive: true });
  // Chromium's default partition key is x + hex(empty path). Browser page zoom, not CSS/pinch zoom.
  await writeFile(join(profile, "Default/Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } } }), { flag: "wx" });
  const result = { channel, viewport, zoom, navigationMs: [], filterMs: [], externalRequests: [], pageErrors: [], passed: false };
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel, headless: true, viewport, deviceScaleFactor: 1, timezoneId: "Asia/Tokyo" });
    result.version = context.browser().version();
    await context.setOffline(true);
    const page = context.pages()[0]; page.setDefaultTimeout(10_000);
    page.on("request", request => { if (/^https?:/.test(request.url())) result.externalRequests.push(request.url()); });
    page.on("pageerror", error => result.pageErrors.push(error.message));
    for (let index = 0; index < 5; index += 1) {
      await page.goto(pathToFileURL(join(bundle, "index.html")).href, { waitUntil: "load" });
      await expect(page.getByText("1100 / 1100 件", { exact: true })).toBeVisible();
      result.navigationMs.push(await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Overview must reflow without horizontal overflow");
    }
    result.metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, scale: visualViewport.scale }));
    assert.equal(matchesZoom(result.metrics, viewport.width, zoom), true, "Browser page zoom was not applied");
    for (let index = 0; index < 100; index += 1) {
      const [value, count] = [["", 1100], ["group-even", 500], ["no-matching-benchmark-record", 0], ["group-odd", 500]][index % 4];
      const sample = await page.evaluate(async ({ value, count }) => {
        const input = document.querySelector('input[type="search"]');
        const start = performance.now(); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
        const observed = [...document.querySelectorAll('p[aria-live="polite"]')].some(item => item.textContent === count + " / 1100 件");
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { elapsedMs: performance.now() - start, observed, value, count };
      }, { value, count });
      result.filterMs.push(sample);
    }
    result.navigation = summarize(result.navigationMs); result.filter = summarize(result.filterMs.map(sample => sample.elapsedMs));
    await checkFlows(page, result, root);
    result.passed = result.navigation.max <= 3000 && result.filter.p95 <= 300 && result.filterMs.every(sample => sample.observed) && !result.externalRequests.length && !result.pageErrors.length;
  } catch (error) { result.error = error.stack ?? String(error); }
  finally {
    if (context) await context.close().catch(error => { result.closeError = error.message; result.passed = false; });
    await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  }
  return result;
}
