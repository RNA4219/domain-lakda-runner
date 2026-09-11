import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const byName = (page, title) => page.getByRole("button", { name: "表示する: " + title, exact: true });

export async function checkImageLinks(page, capture) {
  const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
  const keyword = page.getByRole("searchbox", { name: "キーワード", exact: true });
  await keyword.fill("finding-A"); await byName(page, "finding-A").focus(); await page.keyboard.press("Space");
  await expect(detail.locator(".media-card")).toHaveCount(1);
  const image = detail.getByRole("img", { name: "screenshot", exact: true });
  await image.scrollIntoViewIfNeeded(); await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBe(320);
  const fittedWidth = await image.evaluate(element => element.getBoundingClientRect().width);
  const zoom = detail.getByRole("button", { name: /画像を(?:拡大|縮小)/ });
  await zoom.click(); await expect(zoom).toHaveAttribute("aria-expanded", "true");
  const expandedWidth = await image.evaluate(element => element.getBoundingClientRect().width);
  assert.ok(expandedWidth > fittedWidth && expandedWidth >= 320);
  const region = detail.getByRole("region", { name: "拡大画像", exact: true }); await expect(region).toBeFocused();
  if (await region.evaluate(element => element.scrollWidth > element.clientWidth)) {
    await page.keyboard.press("ArrowRight"); await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
  await page.keyboard.press("ArrowDown"); await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  assert.equal(await detail.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await capture("expanded-picture");
  await detail.getByRole("button", { name: "画像を縮小", exact: true }).click(); await expect(zoom).toHaveAttribute("aria-expanded", "false");
  await expect(zoom).toBeFocused();
  assert.ok(Math.abs(await image.evaluate(element => element.getBoundingClientRect().width) - fittedWidth) < 0.1);
  assert.deepEqual(await image.locator("..").evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })), { left: 0, top: 0 });
  await detail.getByRole("button", { name: "実行全体の証跡を見る (2件)", exact: true }).click();
  await expect(detail.locator(".media-card")).toHaveCount(2);
  await detail.getByRole("button", { name: "この項目の証跡へ戻る", exact: true }).click(); await expect(detail.locator(".media-card")).toHaveCount(1);
  await image.scrollIntoViewIfNeeded(); await capture("finding-picture");
  await page.keyboard.press("Escape"); await expect(byName(page, "finding-A")).toBeFocused(); await expect(keyword).toHaveValue("finding-A");
  await byName(page, "finding-A").click(); await expect(detail.locator(".media-card")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await keyword.fill("images-primary"); await byName(page, "images-primary").click();
  await expect(detail.locator(".media-card")).toHaveCount(2);
  const select = detail.getByRole("button", { name: "#2 の証跡を見る (1件)", exact: true });
  await select.focus(); await page.keyboard.press("Enter");
  await expect(detail.getByRole("heading", { name: /^選択した履歴: #2/ })).toBeFocused();
  await expect(detail.locator(".media-card")).toHaveCount(1);
  const reset = detail.getByRole("button", { name: "履歴の選択を解除", exact: true });
  await reset.scrollIntoViewIfNeeded(); await capture("selected-history");
  await reset.click(); await expect(select).toBeFocused(); await expect(detail.locator(".media-card")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await keyword.fill("finding-linked");
  await page.getByRole("combobox", { name: "表示順", exact: true }).selectOption("newest");
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(page.getByText("2 / 2 ページ", { exact: true })).toBeVisible();
  const opener = page.locator(".result-row").first(); await opener.focus(); await page.keyboard.press("Enter");
  await expect(detail.locator(".media-card")).toHaveCount(1); await page.keyboard.press("Escape");
  await expect(opener).toBeFocused(); await expect(keyword).toHaveValue("finding-linked");
  await expect(page.getByRole("combobox", { name: "表示順", exact: true })).toHaveValue("newest");
  await expect(page.getByText("2 / 2 ページ", { exact: true })).toBeVisible();
  await opener.click(); await expect(detail.locator(".media-card")).toHaveCount(1);
  await expect(detail.getByRole("button", { name: "履歴の選択を解除", exact: true })).toHaveCount(0);
  assert.equal(await detail.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.keyboard.press("Escape");
}

export async function checkUnavailableLinks(page, capture) {
  const keyword = page.getByRole("searchbox", { name: "キーワード", exact: true });
  const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
  for (const title of ["finding-foreign", "finding-ambiguous"]) {
    await keyword.fill(title); await byName(page, title).click();
    await expect(detail.locator(".media-card")).toHaveCount(0);
    const evidence = detail.locator("section").filter({ has: page.getByRole("heading", { name: "媒体・参照証跡", exact: true }) });
    const unavailable = evidence.getByText("対応する証跡を確認できません", { exact: true });
    await expect(unavailable).toBeVisible(); await unavailable.scrollIntoViewIfNeeded();
    await capture(title); await page.keyboard.press("Escape");
  }
}

export async function checkSharedLinks(page, capture) {
  const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
  await page.getByRole("searchbox", { name: "キーワード", exact: true }).fill("finding-A");
  await byName(page, "finding-A").click();
  await expect(detail.locator(".media-card")).toHaveCount(1);
  await expect(detail.getByText("表示可能 0件 · 除外 1件", { exact: true })).toBeVisible();
  await expect(detail.getByText("理由: unverified-media", { exact: true })).toBeVisible();
  await expect(detail.locator(".media-card img, .media-card video, .media-card a")).toHaveCount(0);
  const related = detail.getByRole("button", { name: /の証跡を見る \(1件\)/ }).first();
  await related.click(); await expect(detail.getByText("理由: unverified-media", { exact: true })).toBeVisible();
  const reset = detail.getByRole("button", { name: "履歴の選択を解除", exact: true });
  await reset.click(); await expect(related).toBeFocused();
  await detail.getByText("理由: unverified-media", { exact: true }).scrollIntoViewIfNeeded(); await capture("shared-exclusion");
  await page.keyboard.press("Escape");
}
