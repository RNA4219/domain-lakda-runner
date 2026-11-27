import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { renderArchitecturePage } from "../src/domain-coverage/architecture-view.js";

async function openPage(page: Page, info: TestInfo, options?: Parameters<typeof renderArchitecturePage>[0]) {
  await mkdir(info.outputDir,{recursive:true});
  const path = info.outputPath("構成図 #1.html");
  await writeFile(path,renderArchitecturePage(options));
  await page.goto(pathToFileURL(path).href);
}
const file = (name: string, text: string) => ({ name, mimeType:"text/plain", buffer:Buffer.from(text) });

test("見本を絞り込み、構成 YAML・CloudFormation・npm の別名依存をオフラインで読み込む", async ({page},info) => {
  const requests: string[] = [], errors: string[] = [];
  page.on("request", r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  page.on("pageerror", error => errors.push(error.message));
  await openPage(page,info);
  const input = page.locator("#file"), nodes = page.locator(".node");
  await expect(nodes).toHaveCount(7);
  await page.locator("#choose").selectOption("archive");
  await expect(page.locator("#findings")).toContainText("REC-04");
  await page.locator("#nearby").check();
  await expect(nodes).toHaveCount(2);
  await page.locator("#nearby").uncheck();
  await page.locator("#repos").click();
  await expect(nodes).toHaveCount(3);
  await page.locator("#choose").selectOption("web");
  await expect(page.locator("#links")).toContainText("型定義に依存");
  await page.locator(".guide summary").click();
  const downloaded = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("architecture-sample.json");
  expect(JSON.parse(await readFile((await download.path())!, "utf8")).nodes).toHaveLength(7);
  await page.locator("#product-map").click();
  await expect(page.locator("#name")).toHaveText("Lakda のローカル E2E プラットフォーム");

  await input.setInputFiles(file("構成.yaml", "schema: aym.architecture/v1\nname: 請求書管理\nnodes:\n  - {id: billing, name: 請求, kind: service}\nconnections: []"));
  await expect(page.locator("#name")).toHaveText("請求書管理");
  await expect(page.locator("#repos")).toBeDisabled();
  await input.setInputFiles(file("template.yaml", [
    "Resources:", "  Receipts:", "    Type: AWS::S3::Bucket", "    Properties:",
    "      VersioningConfiguration: {Status: Suspended}", "  Worker:", "    Type: AWS::Lambda::Function",
    "    Properties:", "      Bucket: !Ref Receipts"
  ].join("\n")));
  await expect(page.locator("#findings")).toContainText("Resources.Receipts.Properties.VersioningConfiguration");
  await expect(page.locator(".edge")).toHaveCount(1);
  await input.setInputFiles(file("壊れた.json", "{"));
  await expect(page.getByRole("alert")).toContainText("JSONとして読み取れません");
  await input.setInputFiles(file("大きい.json"," ".repeat(1024 * 1024 + 1)));
  await expect(page.getByRole("alert")).toContainText("1 MiB");
  await expect(page.locator("#name")).toHaveText("template.yaml");
  await expect(nodes).toHaveCount(2);

  await input.setInputFiles(file("package.json",JSON.stringify({name:"web",repository:"team/web",dependencies:{alias:"npm:@team/api@1"}})));
  await expect(page.locator("#source")).toContainText("package.json 1 件");
  await input.setInputFiles(file("package.json",JSON.stringify({name:"@team/api",repository:"team/api"})));
  await expect(page.locator("#source")).toContainText("package.json 2 件");
  await expect(nodes).toHaveCount(2);
  await page.locator(".wire").press("Enter");
  await expect(page.locator("#findings")).toContainText("dependencies → alias");
  await page.locator("#reset").click();
  await expect(page.locator("#name")).toHaveText("注文管理サービス");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

for (const touch of [false,true]) {
  test.describe(touch ? "タッチ画面" : "デスクトップ", () => {
    test.use({viewport:{width:touch?390:1280,height:900},hasTouch:touch,contextOptions:{reducedMotion:"reduce"}});
    test("箱を移すと線が追従し、ズーム・パン・初期配置を操作できる", async ({page},info) => {
      await openPage(page,info);
      const frame = page.locator("#frame"), diagram = page.locator("#diagram");
      const node = diagram.locator('[data-id="web"]'), edge = diagram.locator('.edge[data-from="web"]').first();
      await expect(node).toBeVisible();
      await page.locator("#choose").selectOption("web");
      const overflowing = await diagram.locator(".node").evaluateAll(items=>items.filter(item=>{
        const box=item.querySelector<SVGRectElement>(".box")!.getBBox();
        return Array.from(item.querySelectorAll<SVGTextElement>(".node-title,.node-type,.node-issue")).some(text=>{
          const label=text.getBBox();
          return label.x+label.width>box.width-2;
        });
      }).map(item=>item.getAttribute("data-id")));
      expect(overflowing).toEqual([]);
      await frame.scrollIntoViewIfNeeded();
      const initial = await node.getAttribute("transform"), initialPath = await edge.getAttribute("d");
      const client = touch ? await page.context().newCDPSession(page) : null;
      async function drag(x: number,y: number,dx: number,dy: number) {
        if (client) {
          await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
          await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+dx,y:y+dy}]});
          await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
        } else {
          await page.mouse.move(x,y);
          await page.mouse.down();
          await page.mouse.move(x+dx,y+dy,{steps:4});
          await page.mouse.up();
        }
      }
      const box = (await node.boundingBox())!;
      await drag(box.x+box.width/2,box.y+box.height/2,22,28);
      await expect(node).not.toHaveAttribute("transform",initial!);
      await expect(edge).not.toHaveAttribute("d",initialPath!);
      const moved = await node.getAttribute("transform");
      const empty = await frame.evaluate(el => {
        const r = el.getBoundingClientRect();
        for (let y=r.top+12;y<r.bottom-32;y+=12) for (let x=r.left+12;x<r.right-40;x+=18) {
          const target = document.elementFromPoint(x,y);
          if (target?.closest("#diagram") && !target.closest(".wire,.node")) return {x,y};
        }
        throw Error("図の余白が見つかりません");
      });
      const view = await diagram.getAttribute("viewBox");
      await drag(empty.x,empty.y,25,18);
      await expect(diagram).not.toHaveAttribute("viewBox",view!);
      await expect(node).toHaveAttribute("transform",moved!);
      const zoom = await page.locator("#zoom-value").innerText();
      if (client) {
        const f = (await frame.boundingBox())!, x=f.x+f.width/2, y=f.y+f.height/2;
        const pins = (gap: number) => [{id:1,x:x-gap,y},{id:2,x:x+gap,y}];
        await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:pins(20)});
        await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:pins(40)});
        await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      } else {
        await page.mouse.move(empty.x,empty.y);
        await page.mouse.wheel(0,-100);
      }
      await expect.poll(async () => parseInt(await page.locator("#zoom-value").innerText())).toBeGreaterThan(parseInt(zoom));
      await page.locator("#fit-map").click();
      await expect(node).toHaveAttribute("transform",moved!);
      await page.locator("#reset-layout").click();
      await expect(node).toHaveAttribute("transform",initial!);
      await expect(edge).toHaveAttribute("d",initialPath!);
      await node.press("ArrowRight");
      await expect(node).not.toHaveAttribute("transform",initial!);
      await node.press("Enter");
      await expect(page.locator("#detail-name")).toHaveText("orders-web");
      expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    });
  });
}
