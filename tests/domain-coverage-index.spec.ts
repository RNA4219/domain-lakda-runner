import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { readMap } from "../src/domain-coverage/model.js";
import { readCaseIndex } from "../src/domain-coverage/lakda-index.js";
import { coverageReport } from "../src/domain-coverage/report.js";

const version = "1".repeat(40), id = "lakda:run-contract", ref = "lakda-run-contract";
const obligations = [{visible:{testId:"a"},acceptanceRef:"AC-A"},{visible:{testId:"b"},acceptanceRef:"AC-B"}];
const graph = {schema:"aym.architecture/v1",name:"構成",nodes:[{id:"web",name:"画面",kind:"service"}],connections:[]};
function plan(single: boolean) {
  const scope = single ? obligations.slice(0,1) : obligations;
  return readMap({schema:"lakda/domain-map/v1",product:"見本",version,environment:"loopback",
    behaviors:scope.map((o,i) => ({id:"b"+i,domain:"表示",title:"表示"+i,source:"要件書",criterion:o.acceptanceRef,targets:["web"]})),
    cases:[{id:"case",revision:"r1",obligations:scope,checks:scope.map((_,i) => ({id:"h"+i,obligation:i+1,behaviors:["b"+i]}))}]},graph);
}
async function fixture(root: string, single: boolean, logs: object[]) {
  const m = plan(single);
  const digest = sha256(canonicalJson(m.cases[0].obligations));
  const meta = {schemaVersion:"lakda/run-metadata/v1",mode:"regression-replay",executionMode:"real",commitSha:version,
    runId:id,attempt:1,outcome:"failed",terminationReason:"obligations_unmet",reviewedObligationsSha256:digest,replayInputSha256:"a".repeat(64)};
  const dir = join(root,ref);
  await mkdir(join(dir,"exports"),{recursive:true});
  const files = new Map([["run-metadata.json",JSON.stringify(meta)],["console.jsonl",logs.map(l => JSON.stringify(l)).join("\n")]]);
  const artifacts = [];
  for (const [path,body] of files) {
    await writeFile(join(dir,path),body);
    artifacts.push({artifact_id:"lakda:artifact-"+artifacts.length,kind:"report",path,sha256:"sha256:"+sha256(body),
      size_bytes:Buffer.byteLength(body),classification:"internal",redaction_status:"redacted",redaction_rule_version:"v1",
      safe_for_summary:true,public_exposure:"none",retention:{},security_checks:{secrets_scan:"pass",pii_scan:"pass"}});
  }
  const manifest = JSON.stringify({schema_version:"HATE/v1",run_id:id,run_attempt:1,commit_sha:version,artifacts});
  await writeFile(join(dir,"exports/artifact-manifest.json"),manifest);
  const row = {id:"case",environment:"loopback",caseRevision:"r1",traceTo:["AC-A","AC-B"],oracleRefs:[],
    runRef:ref,runId:id,attempt:1,actionSha256:meta.replayInputSha256,manifestSha256:"sha256:"+sha256(manifest),
    reviewedObligationsSha256:digest,outcome:meta.outcome,reason:meta.terminationReason,evidenceKind:"real"};
  return { m, row, index:{schemaVersion:"lakda/e2e-case-index/v1",callerSha:version,localRunId:"suite",localRunAttempt:2,cases:[row]} };
}
test("複数条件を持つ Lakda 実行は個別の判定ログで被覆し、未到達に結果を付けない",async () => {
  const info = test.info();
  const event = {source:"reviewed-oracle", message:JSON.stringify({index:1,acceptanceRef:"AC-A",result:"failed"})};
  const {m,index} = await fixture(info.outputDir,false,[{...event,source:"browser"},event]);
  const r = coverageReport(m,await readCaseIndex(m,index,info.outputDir),null);
  expect(r.runId).toBe("suite/2");
  expect(r.behaviors.map(b => b.state)).toEqual(["failed","pending"]);
  expect(r.behaviors[0].cases[0].checks[0].source).toBe(ref+"/console.jsonl#L2");
  const missing = {...index,localRunAttempt:3,cases:[{id:"case",environment:"loopback",caseRevision:"r1",outcome:"unreported"}]};
  expect(coverageReport(m,await readCaseIndex(m,missing,info.outputDir),null).totals.judged).toBe(0);
});
test("古い単一条件の失敗を照合し、別の manifest・判定条件・変更済みファイルを拒む",async () => {
  const info = test.info();
  const {m,row,index} = await fixture(info.outputDir,true,[]);
  expect(coverageReport(m,await readCaseIndex(m,index,info.outputDir),null).totals.failed).toBe(1);
  for (const changed of [{manifestSha256:"sha256:"+"0".repeat(64)},{reviewedObligationsSha256:"0".repeat(64)},
    {runId:"lakda:run-other"},{actionSha256:"b".repeat(64)}]) {
    await expect(readCaseIndex(m,{...index,cases:[{...row,...changed}]},info.outputDir)).rejects.toThrow(/一致/);
  }
  await writeFile(join(info.outputDir,ref,"console.jsonl"),"changed");
  await expect(readCaseIndex(m,index,info.outputDir)).rejects.toThrow();
});
test("個別記録のない複数条件のケースの不合格を各条件に転記しない",async () => {
  const info = test.info();
  const {m,index} = await fixture(info.outputDir,false,[]);
  expect(coverageReport(m,await readCaseIndex(m,index,info.outputDir),null).totals).toMatchObject({designed:2,judged:0});
});
