/* global document, innerWidth, innerHeight, devicePixelRatio, visualViewport */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { matchesZoom } from "./metrics.mjs";
import { checkImageLinks, checkSharedLinks, checkUnavailableLinks } from "./media-images.mjs";
import { checkMediaFormats, checkVideoLinks } from "./media-video.mjs";

export async function checkMediaBrowser(corpus, root, channel, viewport, zoom) {
  await mkdir(root);
  const profile = join(root, "profile"); await mkdir(join(profile, "Default"), { recursive: true });
  await writeFile(join(profile, "Default/Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } } }), { flag: "wx" });
  const result = { channel, viewport, zoom, checks: [], captures: [], externalRequests: [], pageErrors: [], passed: false };
  const save = () => writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel, headless: true, viewport, deviceScaleFactor: 1, timezoneId: "Asia/Tokyo" });
    result.version = context.browser().version(); await context.setOffline(true);
    const page = context.pages()[0]; page.setDefaultTimeout(10_000);
    page.on("request", request => { if (/^https?:/.test(request.url())) result.externalRequests.push(request.url()); });
    page.on("pageerror", error => result.pageErrors.push(error.message));
    const cdp = await context.newCDPSession(page);
    const capture = async name => {
      const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, scale: visualViewport.scale, focus: (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").slice(0, 256), dialog: document.querySelector("dialog[open]")?.getBoundingClientRect().toJSON() ?? null }));
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const bytes = Buffer.from(shot.data, "base64"), file = name + ".png";
      await writeFile(join(root, file), bytes, { flag: "wx" });
      result.captures.push({ file, geometry, sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex") });
    };
    for (const [id, bundle, check] of [["image-links", corpus.images, checkImageLinks], ["unavailable-links", corpus.images, checkUnavailableLinks], ["shared-exclusion", corpus.shared, checkSharedLinks], ["video-controls", corpus.video, checkVideoLinks], ["media-formats", corpus.formats, checkMediaFormats]]) {
      const item = { id, passed: false }; result.checks.push(item);
      try {
        await page.goto(pathToFileURL(join(bundle.output, "index.html")).href, { waitUntil: "load" });
        item.metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, scale: visualViewport.scale }));
        assert.equal(matchesZoom(item.metrics, viewport.width, zoom), true, "Browser page zoom was not applied");
        await check(page, capture);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        item.passed = true;
      } catch (error) {
        item.error = error.stack ?? String(error);
        await capture(id + "-failed").catch(error => { item.captureError = error.message; });
      }
      await save();
    }
    result.passed = result.checks.length === 5 && result.checks.every(item => item.passed) && !result.externalRequests.length && !result.pageErrors.length;
  } catch (error) { result.error = error.stack ?? String(error); }
  finally {
    if (context) await context.close().catch(error => { result.closeError = error.message; });
    if (result.closeError) result.passed = false;
    await save();
  }
  return result;
}
