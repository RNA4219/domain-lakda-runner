import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { URLSearchParams } from "node:url";
import { coveragePage } from "../scripts/local-console/coverage.mjs";

test("コンソールの実行回・対象製品・証跡の混同を防ぎ、未登録と照合失敗を区別する",async()=>{
  const dir=test.info().outputDir, revision="a".repeat(40);
  await mkdir(dir,{recursive:true});
  const graph={schema:"aym.architecture/v1",name:"登録",nodes:[{id:"form",kind:"service",name:"申込画面"}],connections:[],findings:[]};
  const raw={schema:"lakda/domain-map/v1",product:"example",version:revision,environment:"local",architecture:"architecture.json",
    behaviors:[{id:"apply",domain:"申込",title:"申込みが受理される",criterion:"AC-1",source:"受付仕様",targets:["form"]}],cases:[]};
  const write=(name,value)=>writeFile(join(dir,name),JSON.stringify(value));
  await write("architecture.json",graph);
  await write("map.json",raw);
  const suites=[{id:"apply",name:"申込",coverageMap:"map.json"},{id:"cancel",name:"取消"}];
  const product={productId:"example",name:"受付",revision,environment:"local"};
  const ctx={number:2,state:"running",hasJob:true,caseLinks:new Map()};
  const app={catalog:()=>({product,suites}),coverageContext:(_id,n)=>n===99?null:ctx};
  const page=q=>coveragePage({suites},dir,app,new URLSearchParams(q));
  const running=await page("suite=apply");
  expect(running.status).toBe(200);
  expect(running.html).toContain("第2回 · 実行中");
  expect(running.html).toContain("0 / 1");
  expect(running.html).toContain("ケース未設計");
  expect((await page("suite=cancel")).html).toContain("検証範囲は未登録です");
  for(const q of ["suite=absent","suite=apply&attempt=99","suite=apply&attempt=abc"])expect((await page(q)).status).toBe(404);
  const index={schemaVersion:"lakda/e2e-case-index/v1",callerSha:revision,executionOrigin:"local",localRunId:"apply",localRunAttempt:1,cases:[]};
  ctx.index=index;
  const mismatch=await page("suite=apply");
  expect(mismatch.status).toBe(422);
  expect(mismatch.html).toContain("証跡を照合できません");
  Object.assign(index,{localRunAttempt:2});
  expect((await page("suite=apply")).status).toBe(200);
  await write("map.json",{...raw,version:"another"});
  expect((await page("suite=apply")).html).toContain("検証範囲の登録を確認してください");
});
