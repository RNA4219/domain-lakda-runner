/* global setTimeout, clearTimeout */
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function checkVideoLinks(page, capture) {
  await page.getByRole("button", { name: "表示する: video-run", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
  const video = detail.locator("video");
  await expect(video).toHaveCount(1); await expect(video).toHaveJSProperty("controls", true);
  await expect(video).toHaveJSProperty("autoplay", false); await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveAttribute("preload", "none");
  const play = detail.getByRole("button", { name: "動画を再生", exact: true });
  const narrow = await play.isVisible(); let position;
  if (narrow) {
    const seek = detail.getByRole("slider", { name: "再生位置", exact: true }); await expect(seek).toBeDisabled();
    await play.click(); await expect(video).toHaveJSProperty("paused", false);
    await detail.getByRole("button", { name: "一時停止", exact: true }).click(); await expect(video).toHaveJSProperty("paused", true);
    await expect(seek).toBeEnabled(); const bounds = await seek.boundingBox();
    await seek.click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
    await expect.poll(() => video.evaluate(media => media.currentTime)).toBeGreaterThan(0.2);
    position = await video.evaluate(media => media.currentTime);
    await detail.locator(".video-controls").scrollIntoViewIfNeeded(); await capture("video-narrow-controls");
  } else position = await video.evaluate(async media => {
    const until = (event, action) => new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); media.removeEventListener(event, done); media.removeEventListener("error", failed); resolve(); };
      const failed = () => { clearTimeout(timer); media.removeEventListener(event, done); media.removeEventListener("error", failed); reject(new Error("Artificial video decode/seek failed")); };
      const timer = setTimeout(failed, 5000); media.addEventListener(event, done, { once: true }); media.addEventListener("error", failed, { once: true }); action();
    });
    await until("loadeddata", () => media.load());
    await until("seeked", () => { media.currentTime = 0.2; });
    return media.currentTime;
  });
  assert.ok(position > 0);
  const retained = await video.elementHandle();
  const selectVideo = detail.getByRole("button", { name: "#2 の証跡を見る (1件)", exact: true });
  const selectImage = detail.getByRole("button", { name: "#3 の証跡を見る (1件)", exact: true });
  const reset = detail.getByRole("button", { name: "履歴の選択を解除", exact: true });
  const next = detail.getByRole("button", { name: "次の手順", exact: true });
  const previous = detail.getByRole("button", { name: "前の手順", exact: true });
  try {
    await detail.getByRole("button", { name: "失敗した手順へ", exact: true }).click();
    await expect(detail.locator(".step-summary")).toContainText("#2");
    await expect(detail.locator(".step-summary")).toContainText("人工動画: 次の画面が表示されませんでした");
    await expect(selectVideo).toHaveAttribute("aria-pressed", "true");
    await expect(detail.locator(".media-card")).toHaveCount(1);
    await capture("step-failure");
    assert.ok(Math.abs(await video.evaluate(media => media.currentTime) - position) < 0.02);
    await expect(video).toHaveJSProperty("paused", true);
    if (narrow) await expect(play).toBeVisible();
    await video.evaluate(media => { media.muted = true; }); await video.focus(); await page.keyboard.press("Space");
    await expect(video).toHaveJSProperty("paused", false);
    await next.click(); await expect(detail.locator(".step-summary")).toContainText("#3");
    assert.equal(await retained.evaluate(media => media.paused), true);
    const pausedAt = await retained.evaluate(media => media.currentTime);
    await expect(detail.locator("video")).toHaveCount(0);
    await previous.click(); await expect(detail.locator(".step-summary")).toContainText("#2");
    await expect(video).toHaveJSProperty("paused", true);
    assert.ok(Math.abs(await video.evaluate(media => media.currentTime) - pausedAt) < 0.02);
    await next.click(); await expect(next).toBeDisabled();
    await detail.getByRole("img", { name: "screenshot", exact: true }).scrollIntoViewIfNeeded(); await capture("step-next");
    await reset.click(); await expect(selectImage).toBeFocused();
    assert.equal(await video.evaluate((media, old) => media === old, retained), true);
    assert.ok(Math.abs(await video.evaluate(media => media.currentTime) - pausedAt) < 0.02);
    await expect(video).toHaveJSProperty("paused", true);
    await selectVideo.click(); await reset.scrollIntoViewIfNeeded(); await capture("video-selection");
    await video.scrollIntoViewIfNeeded(); await capture("video-player");
    await video.focus(); await page.keyboard.press("Space"); await expect(video).toHaveJSProperty("paused", false);
    await page.keyboard.press("Escape");
    await expect(detail).not.toBeVisible();
    await expect.poll(() => retained.evaluate(media => ({ paused: media.paused, ended: media.ended })), { timeout: 500 }).toEqual({ paused: true, ended: false });
    await expect(page.getByRole("button", { name: "表示する: video-run", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "表示する: video-run", exact: true }).click();
    await expect(reset).toHaveCount(0); await expect(detail.locator(".media-card")).toHaveCount(2);
    await expect(video).toHaveJSProperty("paused", true); await expect(video).toHaveJSProperty("currentTime", 0);
    await page.keyboard.press("Escape");
  } finally { await retained.dispose(); }
}

export async function checkMediaFormats(page, capture) {
  await page.getByRole("button", { name: "表示する: formats-run", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
  await expect(detail.locator(".media-card")).toHaveCount(5);
  assert.deepEqual((await detail.locator(".media-card h3").allTextContents()).filter(text => text.startsWith("sampled-frame")), ["sampled-frame #2", "sampled-frame #7"]);
  const frame = detail.getByRole("img", { name: "sampled-frame #2", exact: true });
  await frame.scrollIntoViewIfNeeded(); await expect.poll(() => frame.evaluate(image => image.naturalWidth)).toBe(320);
  await detail.getByRole("img", { name: "screenshot", exact: true }).scrollIntoViewIfNeeded();
  await expect(detail.getByText("このブラウザでは画像を表示できません。媒体fileで確認してください。", { exact: true })).toBeVisible();
  const play = detail.getByRole("button", { name: "動画を再生", exact: true });
  if (await play.isVisible()) await play.click(); else await detail.locator("video").evaluate(video => video.load());
  await expect(detail.getByText("このブラウザでは動画を表示できません。媒体fileで確認してください。", { exact: true })).toBeVisible();
  if (await play.isVisible()) { await expect(play).toBeDisabled(); await expect(detail.getByRole("slider", { name: "再生位置", exact: true })).toBeDisabled(); }
  await expect(detail.getByText("trace ZIPは既存のPlaywright trace viewerで開いてください。ここでは実行しません。", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "媒体fileを保存", exact: true })).toHaveCount(5);
  await detail.getByRole("heading", { name: "trace", exact: true }).scrollIntoViewIfNeeded(); await capture("format-fallbacks");
  assert.equal(await detail.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.keyboard.press("Escape");
}
