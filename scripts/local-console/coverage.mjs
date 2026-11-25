import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import { readMap } from "../../dist/domain-coverage/model.js";
import { readCaseIndex } from "../../dist/domain-coverage/lakda-index.js";
import { coverageReport } from "../../dist/domain-coverage/report.js";
import { renderCoverage } from "../../dist/domain-coverage/html.js";
import { readJson } from "./setup.mjs";

const chrome = await readFile(new URL("../result-layout.css",import.meta.url),"utf8");
const esc = value => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const suiteUrl = id => "/coverage?suite="+encodeURIComponent(id);

export async function coveragePage(cfg,base,app,params) {
  const {product,suites} = app.catalog();
  const id = params.get("suite") ?? cfg.suites.find(s=>s.coverageMap)?.id ?? suites[0]?.id;
  const suite = suites.find(s=>s.id===id), raw = params.get("attempt");
  const links = suites.map(s=>({name:s.name,href:suiteUrl(s.id),current:id===s.id}));
  const statePage = (status,title,description) => ({status,html:'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+' | Lakda</title><style>'+chrome+'</style><body><header class="app-header"><div class="app-bar"><strong class="brand">Lakda</strong><a class="home-link" href="/">テスト概要</a></div></header><main class="app-main"><p>'+esc(product.name)+(suite?' ／ '+esc(suite.name):'')+'</p><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p><nav aria-label="スイート">'+links.map(s=>'<p><a href="'+esc(s.href)+'">'+esc(s.name)+'</a></p>').join('')+'</nav></main></body></html>'});
  if (!suite || (raw !== null && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))))) return statePage(404,"この実行回は見つかりません","登録されているスイートから選び直してください。");
  const ctx = app.coverageContext(id,raw === null ? null : Number(raw));
  if (!ctx) return statePage(404,"この実行回は見つかりません","登録されているスイートから選び直してください。");
  const file = cfg.suites.find(s=>s.id===id).coverageMap;
  if (!file) return statePage(200,"検証範囲は未登録です","このスイートの coverageMap に、製品の構成と受入条件を結ぶマップを指定してください。");
  let map,graph;
  try {
    const path = resolve(base,file), definition = await readJson(path);
    if (ctx.fixture && definition.version === "bundled-demo") definition.version = product.revision;
    graph = await readJson(resolve(dirname(path),definition.architecture));
    map = readMap(definition,graph);
    if (![product.productId,product.name].includes(map.product) || map.version!==product.revision || map.environment!==product.environment) throw Error("対象製品・対象版・環境の不一致");
  } catch(error) {
    console.error("検証範囲の登録:",error.message);
    return statePage(422,"検証範囲の登録を確認してください","構成ファイル、対象製品、版、環境を照合できませんでした。");
  }
  let run=null;
  if (ctx.index && !ctx.fixture) {
    try {
      if(ctx.index.schemaVersion!=="lakda/e2e-case-index/v1" || ctx.index.localRunId!==id || ctx.index.localRunAttempt!==ctx.number ||
        ctx.index.executionOrigin!=="local" || !ctx.index.cases.every(c=>c.environment===product.environment)) throw Error("実行回の不一致");
      run = await readCaseIndex(map,ctx.index,ctx.directory);
    } catch(error) {
      console.error("検証範囲の証跡:",error.message);
      return statePage(422,"証跡を照合できません","第"+ctx.number+"回の索引と確認項目を照合できないため、この回の判定は表示できません。");
    }
  }
  const attemptLabel = (ctx.number ? "第"+ctx.number+"回" : "初回実行前")+
    (ctx.fixture ? " · サンプルの設計範囲" : ctx.state==="running" ? " · 実行中" : ctx.number && !ctx.index ? " · 結果未発行" : "");
  return {status:200,html:renderCoverage(coverageReport(map,run,null),undefined,graph,{
    name:product.name,suiteName:suite.name,attemptLabel,suiteLinks:links,caseLinks:ctx.caseLinks,
    returnHref:ctx.hasJob ? "/run?suite="+encodeURIComponent(id)+"&attempt="+ctx.number : "/"
  })};
}
