import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { renderArchitecturePage } from "../src/domain-coverage/architecture-view.js";
import { validateMap } from "../vendor/architecture/model.js";
import { startSurfaceCoverage, surfaceRunIndex } from "../src/index.js";
import { startFixture } from "./fixtures/server.js";

const exec = promisify(execFile);
const sample = JSON.parse(await readFile(resolve("vendor/architecture/sample.json"), "utf8"));
const rawFile = (object: unknown) => ({ name:"architecture.json", mimeType:"application/json", buffer:Buffer.from(JSON.stringify(object)) });

test("操作の役割・担当・接続を検証し、工程未定義の旧形式も読める", () => {
  expect(validateMap({ ...sample, flows:undefined }).flows).toEqual([]);
  const withSteps = (steps: unknown[]) => ({ ...sample, flows:[{ id:"f", name:"操作", steps }] });
  expect(validateMap(withSteps([{node:"entry"},{node:"entry"},{node:"worker"}])).flows[0].steps).toHaveLength(3);
  for (const graph of [
    withSteps([]), withSteps([{node:"missing"}]), withSteps([{node:"entry",via:"注文を送信"}]),
    withSteps([{node:"gateway"},{node:"entry",via:"注文を送信"}]),
    {...sample,nodes:sample.nodes.map((n: {id:string}) => n.id==="entry" ? {...n,repository:"worker"} : n)},
    {...sample,connections:[...sample.connections,{...sample.connections[2],label:"別の観測"}]},
    {...sample,flows:[...sample.flows,...sample.flows]}
  ]) expect(()=>validateMap(graph)).toThrow();
});

test("任意の操作と役割を画面で追加し、保存後に同じ工程と担当を開ける", async({page},info)=>{
  await mkdir(info.outputDir,{recursive:true});
  const html=info.outputPath("architecture.html");
  await writeFile(html,renderArchitecturePage());await page.goto(pathToFileURL(html).href);
  await expect(page.locator("#flow-track button")).toHaveCount(4);
  await expect(page.locator("#flow-info")).toContainText("orders-web");
  await page.locator("#flow-editor summary").click();
  await page.locator("#edit-flow").selectOption("");
  await page.locator("#new-flow").fill("仕分け");
  await page.locator("#edit-node").selectOption("");
  await page.locator("#new-node").fill("配送待ち");
  await page.locator("#new-kind").selectOption("external");
  await page.locator("#edit-role").fill("再配信用キュー");
  await page.locator("#edit-owner").selectOption("api");
  await page.locator("#flow-form button[type=submit]").click();
  await expect(page.locator("#flow-info")).toContainText("再配信用キュー");
  await page.locator("#edit-node").selectOption("worker");
  await page.locator("#edit-via").fill("再配信");
  await page.locator("#flow-form button[type=submit]").click();
  await expect(page.locator("#flow-info")).toContainText("再配信");
  const downloading=page.waitForEvent("download");await page.locator("#save-flow").click();
  const payload=JSON.parse(await readFile((await (await downloading).path())!,"utf8"));
  expect(payload.flows.at(-1).steps).toHaveLength(2);
  await page.locator("#reset").click();await page.locator("#file").setInputFiles(rawFile(payload));
  await page.locator("#flow-choice").selectOption({label:"仕分け"});
  await expect(page.locator("#flow-info")).toContainText("orders-api");
  await expect(page.locator("#flow-info")).toContainText("再配信用キュー");
  await page.locator("#flow-next").click();
  await expect(page.locator("#flow-info")).toContainText("配送待ち → 注文処理");
  await expect(page.locator("#flow-info")).toContainText("未計測");
});

for (const width of [320,1280]) test(`100要素・100工程を幅 ${width} で等倍のまま探して読む`,async({page},info)=>{
  await page.setViewportSize({width,height:850});
  const nodes=Array.from({length:100},(_,i)=>({id:"n"+i,name:"処理 "+i,kind:"service",role:"独自の役割 "+i}));
  const graph={schema:sample.schema,name:"大規模見本",nodes,connections:[],flows:[{id:"f",name:"全工程",steps:nodes.map(n=>({node:n.id}))}]};
  await mkdir(info.outputDir,{recursive:true});
  const html=info.outputPath("large.html");
  await writeFile(html,renderArchitecturePage({product:graph,startWithProduct:true}));
  await page.goto(pathToFileURL(html).href);
  await expect(page.locator("#zoom-value")).toHaveText("100%");
  await expect(page.locator("#flow-track button")).toHaveCount(5);
  const labelHeight=await page.locator(".node-title").first().evaluate(n=>n.getBoundingClientRect().height);
  expect(labelHeight).toBeGreaterThanOrEqual(14);
  await page.locator("#fit-map").click();expect(parseInt(await page.locator("#zoom-value").innerText())).toBeLessThan(65);
  await page.locator("#flow-step").selectOption("99");await expect(page.locator("#zoom-value")).toHaveText("100%");
  await expect(page.locator("#detail-name")).toHaveText("処理 99");
  await expect(page.locator("#flow-next")).toBeDisabled();await expect(page.locator("#flow-track button")).toHaveCount(5);
  const centered=await page.locator(".node[aria-pressed=true]").evaluate(n=>{
    const box=n.getBoundingClientRect(),view=document.getElementById("diagram")!.getBoundingClientRect();
    return box.top>=view.top && box.bottom<=view.bottom && box.left>=view.left && box.right<=view.right;
  });
  expect(centered).toBe(true);
  await page.locator("#node-query").fill("独自の役割 42");await page.locator("#node-query").press("Enter");
  await expect(page.locator("#flow-step")).toHaveValue("42");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("SDKと配布CLIで実測した接続・未計測・確認項目の判定を区別する",async({browser,page},info)=>{
  await mkdir(info.outputDir,{recursive:true});
  const save=async(name:string,value:unknown)=>{const path=join(info.outputDir,name);await writeFile(path,JSON.stringify(value));return path;};
  const fixture=await startFixture(()=>({body:"<main>synthetic order</main>"}));
  try {
    await save("architecture.json",sample);
    const map={schema:"lakda/domain-map/v1",product:"synthetic",version:"v1",environment:"local",architecture:"architecture.json",
      behaviors:[{id:"B",domain:"受付",title:"受付内容を検証",criterion:"合成の期待値に一致",source:"仕様",targets:["gateway"]}],
      cases:[{id:"TC-1",revision:"v1",checks:[{id:"check",behaviors:["B"]}]}]};
    const config=await save("map.json",map), runs=join(info.outputDir,"runs");
    const catalog={schema:"lakda/surface-catalog/v1",product:map.product,version:"v1",environment:"local",revision:"r1",
      screens:[{id:"entry",name:"入力",origin:fixture.baseUrl,path:"/order",channel:"web",frequency:1}],
      apis:[{id:"gateway",name:"受付",origin:fixture.baseUrl,path:"/api/order",method:"GET",frequency:1}],
      relations:[{screen:"entry",api:"gateway"}],publication:{screens:["entry"],apis:["gateway"]}};
    const catalogFile=await save("catalog.json",catalog);
    const ctx=await browser.newContext();
    const record=await (async()=>{
      try {
        const sdk=await startSurfaceCoverage(ctx,{catalogPath:catalogFile,outputDir:runs,testId:"TC-1",testRevision:"v1",lane:"mock"});
        const order=await ctx.newPage();await order.goto(fixture.baseUrl+"/order");
        await order.evaluate(()=>fetch("/api/order").then(r=>r.text()));await sdk.checkpoint();return await sdk.finish("failed");
      } finally {await ctx.close();}
    })();
    const input=await save("index.json",surfaceRunIndex([record]));
    const cli=[resolve("dist/cli.js"),"coverage","map","--config",config];
    const flags=["--surface-catalog",catalogFile,"--runs-dir",runs,"--input",input];
    const report=JSON.parse((await exec(process.execPath,[...cli,...flags])).stdout);
    expect(report.architecture.connections[2].observation).toMatchObject({state:"observed",evidence:[{testId:"TC-1",lane:"mock",outcome:"failed"}]});
    expect(report.architecture.connections[4].observation).toBeUndefined();expect(report.behaviors[0].state).toBe("pending");
    const html=info.outputPath("coverage.html");await exec(process.execPath,[...cli,...flags,"--format","html","--out",html]);
    await page.goto(pathToFileURL(html).href+"#architecture");await page.locator("#flow-next").click();
    await expect(page.locator("#flow-info")).toContainText("観測あり");await expect(page.locator("#flow-info")).toContainText("今回未判定");
    await page.locator("#flow-info details summary").first().click();await expect(page.locator("#flow-info")).toContainText("差し替え");
    await page.locator("#flow-info a").first().click();await expect(page.locator("#behavior-0")).toBeVisible();
    await page.getByRole("link",{name:"システム構成図",exact:true}).click();
    await page.locator("#file").setInputFiles(rawFile({...sample,observations:report.architecture.connections}));
    await page.locator("#flow-next").click();await expect(page.locator("#flow-info")).toContainText("未計測");
    await expect(page.locator("#flow-info")).not.toContainText("TC-1");
    await save("map.json",{...map,cases:[{...map.cases[0],revision:"v2"}]});
    expect(JSON.parse((await exec(process.execPath,[...cli,...flags])).stdout).architecture.connections[2].observation).toEqual({state:"unmeasured",evidence:[]});
    await save("catalog.json",{...catalog,environment:"other"});
    await expect(exec(process.execPath,[...cli,...flags])).rejects.toThrow(/対象製品・版・環境/);
  } finally {await fixture.close();}
});
