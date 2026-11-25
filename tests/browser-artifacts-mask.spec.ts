import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { captureFailureScreenshot } from "../src/core/browser-artifacts.js";

test("failure screenshot masks sensitive fields in a CSP page and its iframe", async ({ browser }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html", "content-security-policy": "default-src 'self'; style-src 'self'; frame-src 'self'" });
    response.end(request.url === "/child" ? '<input type="password" value="secret">' :
      '<div data-lakda-sensitive>secret</div><iframe src="/child"></iframe>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address missing");
  const context = await browser.newContext({ viewport: { width: 500, height: 300 } });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const child = page.frames().find(frame => frame !== page.mainFrame());
    if (!child) throw new Error("iframe missing");
    const mainBox = await page.locator("[data-lakda-sensitive]").boundingBox();
    const childBox = await child.locator('input[type="password"]').boundingBox();
    if (!mainBox || !childBox) throw new Error("sensitive area missing");
    const path = test.info().outputPath("masked.png");
    await captureFailureScreenshot(context, page, path);
    const image = (await readFile(path)).toString("base64");
    const inspector = await context.newPage();
    const samples = await inspector.evaluate(async ({ image, boxes }) => {
      const img = new Image(); img.src = `data:image/png;base64,${image}`;
      await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
      return boxes.map(box => [...ctx.getImageData(Math.floor(box.x + box.width / 2), Math.floor(box.y + box.height / 2), 1, 1).data]);
    }, { image, boxes: [mainBox, childBox] });
    expect(samples).toEqual([[0, 0, 0, 255], [0, 0, 0, 255]]);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
