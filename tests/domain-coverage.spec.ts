import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../src/cli.js";
import { readMap } from "../src/domain-coverage/model.js";
import { readObservations } from "../src/domain-coverage/observations.js";
import { coverageReport } from "../src/domain-coverage/report.js";

const example = resolve(import.meta.dirname,"../examples/domain-coverage/misskey");
const template = JSON.parse(await readFile(join(example,"map.json"),"utf8"));
const graph = JSON.parse(await readFile(join(example,"architecture.json"),"utf8"));
const plan = readMap(template,graph);
const standard = { schema:"lakda/domain-run/v1", product:"Misskey", version:"2026.11.0", runId:"suite/2" };
const sample = { product:"Misskey", version:"2026.11.0", caseId:"favorite-persistence", caseRevision:1,
  startedAt:"2026-01-01T00:00:00Z", steps:[
    {action:"ノートメニューで登録",endpoint:"notes/favorites/create",httpStatus:204},
    {action:"再読み込み後の登録確認",reload:true,httpStatus:200,matchingIds:1,visibleMatches:1},
    {action:"ノートメニューで解除",endpoint:"notes/favorites/delete",httpStatus:204},
    {action:"再読み込み後の解除確認",reload:true,httpStatus:200,matchingIds:0,visibleMatches:0}
  ] };
const summary = (data: Record<string,unknown>) => coverageReport(plan,readObservations(plan,data),null);

test("接続を共有する三つの振る舞いを一度ずつ数え、証跡の位置を記録する", () => {
  const r = summary(sample);
  expect(r.totals).toEqual({total:3, designed:2, judged:2, passed:2, failed:0, designRate:2/3, judgedRate:2/3});
  expect(r.behaviors.map(b => b.state)).toEqual(["passed","passed","undesigned"]);
  expect(r.architecture.connections[0].behaviors).toEqual(["add","remove"]);
  expect(r.behaviors[0].cases[0].checks[1].source).toBe("#/steps/1");
  expect(r.behaviors[0].cases[0].checks[1].comparisons).toContainEqual({field:"matchingIds", expected:1, actual:1});
});
test("今回の記録しか使わず、不合格と未到達と旧ケース版を区別する", () => {
  const data = {...sample,steps:[sample.steps[0],{...sample.steps[1],matchingIds:0}]};
  expect(summary(data).behaviors.map(b => b.state)).toEqual(["failed","pending","undesigned"]);
  expect(summary({...sample,steps:[sample.steps[0],{action:sample.steps[1].action}]}).totals.judged).toBe(0);
  expect(summary({...standard,cases:[]}).totals).toMatchObject({designed:2,judged:0});
  expect(summary({...sample,caseRevision:2})).toMatchObject({totals:{judged:0},unmappedCases:[{id:sample.caseId,revision:"2"}]});
  expect(() => summary({...sample,version:"2027"})).toThrow(/対象版/);
  expect(() => summary({...sample,steps:[sample.steps[0],sample.steps[0]]})).toThrow(/複数/);
});
test("同じ受入条件の代替ケースが合格しても明示的な不合格を保持する", () => {
  const raw = structuredClone(template);
  raw.cases.push({id:"other",revision:"1",checks:[{id:"confirm",behaviors:["add"]}]},{id:"free",revision:"1",checks:[]});
  const m = readMap(raw,graph);
  const data = {...standard,cases:[{id:"other",revision:"1",checks:[{id:"confirm",result:"passed"}]},
    {id:sample.caseId,revision:"1",checks:[{id:"create-request",result:"failed"}]}]};
  const r = coverageReport(m,readObservations(m,data),null);
  expect(r.totals).toMatchObject({total:3,designed:2,judged:1,failed:1});
  expect(r.unmappedCases).toEqual([{id:"free",revision:"1"}]);
  expect(() => readObservations(m,{...data,cases:[...data.cases,data.cases[0]]})).toThrow(/重複/);
});
test("空の範囲と対象外を保持し、逆向き接続と壊れた参照を拒む", () => {
  const raw = structuredClone(template);
  raw.behaviors = [{...raw.behaviors[0],excluded:"今回の対象版では提供しない"}];
  raw.cases = [];
  const r = coverageReport(readMap(raw,graph),null,null);
  expect(r.totals).toMatchObject({total:0,designRate:null,judgedRate:null});
  expect(r.behaviors[0].state).toBe("excluded");
  const edge = raw.behaviors[0].targets[0];
  raw.behaviors[0].targets = [{...edge,from:edge.to,to:edge.from}];
  expect(() => readMap(raw,graph)).toThrow(/構成図にない/);
  expect(() => readMap({...template,behaviors:[]},graph)).toThrow(/対応先/);
  expect(() => readMap(template,{...graph,nodes:[...graph.nodes,graph.nodes[0]]})).toThrow(/重複/);
});
test("CLI は指定した新規出力だけに書き込み、参照不良・重複引数に失敗する", async () => {
  const info = test.info();
  const out = info.outputPath("map.json");
  await mkdir(info.outputDir,{recursive:true});
  const cmd = ["coverage","map","--config",join(example,"map.json"),"--out",out];
  expect(await runCli(cmd)).toBe(0);
  const before = await readFile(out,"utf8");
  expect(JSON.parse(before).totals.judged).toBe(0);
  expect(await runCli(cmd)).toBe(2);
  expect(await readFile(out,"utf8")).toBe(before);
  expect(await runCli([...cmd,"--out",info.outputPath("other")])).toBe(1);
  expect(await runCli([...cmd,"--input",info.outputPath("missing")])).toBe(1);
});
for (const width of [390,1280]) {
  test("画面幅 "+width+" で接続から振る舞いと観測値を確認できる", async ({page},info) => {
    await mkdir(info.outputDir,{recursive:true});
    const input = info.outputPath("今回 #1.json"), out = info.outputPath("map.html");
    await writeFile(input,JSON.stringify(sample));
    expect(await runCli(["coverage","map","--config",join(example,"map.json"),"--input",input,"--format","html","--out",out])).toBe(0);
    await page.setViewportSize({width,height:820});
    await page.goto(pathToFileURL(out).href);
    await expect(page.getByRole("heading",{level:1})).toHaveText("Misskeyの検証範囲");
    await expect(page.getByText(/今回判定済み 2 \/ 3/)).toBeVisible();
    await page.getByRole("link",{name:template.behaviors[0].title}).first().click();
    const target = page.locator("article:target");
    await target.locator("summary").click();
    await expect(target.getByText(/matchingIds.*期待 1.*観測 1/)).toBeVisible();
    await page.getByText("参照した実行記録",{exact:true}).click();
    expect(await page.getByRole("link",{name:"今回 #1.json"}).evaluate(a => (a as HTMLAnchorElement).href)).toBe(pathToFileURL(input).href);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
