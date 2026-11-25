import { createServer } from "node:http";
import { access, open, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL, URL } from "node:url";
import { checkReplayTools, exampleDir, initialize, loadDemo, readJson, readRegistration, recordingTools, sha } from "./local-console/setup.mjs";
import { readResultTemplate } from "./result-template.mjs";

const help = `Lakda ローカル E2E プラットフォーム

  npm run platform                         配送案内のサンプルを起動する
  npm run platform -- --init <設定.json>   製品用の設定ひな形を作る
  npm run platform -- --config <設定.json> 製品のテスト画面を起動する

初回は npm ci と npm run platform:setup を実行してください。
録画には PATH 上の ffmpeg と ffprobe を使用します。
画面のポートは --port <番号> で変更できます（既定 18872）。停止は Ctrl+C。`;
function check(v,message){if(!v)throw Error(message);}
async function listen(server,port,usage) {
  try {
    await new Promise((yes,no)=>{server.once("error",no);server.listen(port,"127.0.0.1",()=>{server.off("error",no);yes();});});
  } catch (error) {
    if (error.code === "EADDRINUSE") throw new Error("ポート " + port + " は使用中です。" + usage, { cause: error });
    throw error;
  }
}

async function filesForTarget(cfg,base,product) {
  check(cfg.target?.directory && cfg.target.observation && cfg.target.binding, "target に directory、observation、binding を指定してください");
  const observed=await readJson(resolve(base,cfg.target.observation)), binding=(await readJson(resolve(base,cfg.target.binding))).target;
  check(observed.revision===product.revision && observed.productId===product.productId && observed.environment===product.environment &&
    binding.revision===product.revision && binding.projectId===product.productId && binding.environmentId===product.environment,"製品の版・環境が一致しません");
  const files=new Map(),lines=[];
  for(const name of Object.keys(observed.files).sort()) {
    check(/^[\w.-]+\.(html|css|js)$/.test(name),"製品配信のファイル名が不正です");
    const bytes=await readFile(resolve(base,cfg.target.directory,name)), digest=sha(bytes);
    check(observed.files[name].servedSha256===digest && observed.files[name].diskSha256===digest,"配信する製品ファイルが登録版と異なります");
    files.set("/"+name,bytes);lines.push(name+" "+digest+"\n");
  }
  check(files.has("/index.html") && "sha256:"+sha(lines.join(""))===binding.buildId,"配信対象のビルドが一致しません");
  return files;
}

async function architecturePage(cfg,base,showLakda) {
  const { renderArchitecturePage } = await import("../dist/domain-coverage/architecture-view.js");
  if (showLakda || cfg.architecture === undefined) return renderArchitecturePage({startWithProduct:showLakda});
  const { MAX_BYTES, parseFile } = await import("#lakda-map-model");
  try {
    check(typeof cfg.architecture === "string" && /\.(json|ya?ml)$/i.test(cfg.architecture), "architecture に構成図の JSON または YAML ファイルを指定してください。");
    const file = await open(resolve(base,cfg.architecture),"r");
    try {
      const stat = await file.stat();
      check(stat.isFile() && stat.size <= MAX_BYTES, "構成図には1 MiB以下のファイルを指定してください。");
      const name = basename(cfg.architecture);
      return renderArchitecturePage({product:parseFile(await file.readFile("utf8"),name),productSource:name,startWithProduct:true});
    } finally { await file.close(); }
  } catch (error) {
    return renderArchitecturePage({startWithProduct:true,productError:error.code ? "設定で指定した構成ファイルを開けません。" : error.message});
  }
}

async function main(){
  const {values}=parseArgs({options:{config:{type:"string"},port:{type:"string"},init:{type:"string"},help:{type:"boolean",short:"h"}}});
  if (values.help) { console.log(help); return; }
  if (values.init !== undefined) {
    check(values.init && !values.config && !values.port, "--init には作成する設定ファイルだけを指定してください");
    const path = await initialize(values.init);
    console.log("ひな形を作成しました " + path + '\n製品のファイルを指定して起動してください。\nnpm run platform -- --config "' + path + '"');
    return;
  }
  check(values.config !== "", "--config に設定ファイルを指定してください");
  const sample = join(exampleDir,"demo.json");
  const input = values.config ? resolve(values.config) : sample;
  const demo = input === sample;
  const base=dirname(input),cfg=await readJson(input);
  try { await access(new URL("../dist/core/runner.js",import.meta.url)); }
  catch { throw new Error("初回の準備が必要です。リポジトリで npm ci と npm run platform:setup を実行してください。"); }
  const { openExecution } = await import("./local-console/execution.mjs");
  check(typeof cfg.baseUrl === "string" && typeof cfg.store === "string" && cfg.store.trim(), "設定に baseUrl と store を指定してください");
  const address=new URL(cfg.baseUrl),port=Number(values.port ?? "18872");
  check(address.origin+"/"===cfg.baseUrl && address.protocol==="http:" && address.hostname==="127.0.0.1" && address.port &&
    Number.isInteger(port) && port>0 && port<65536 && port!==Number(address.port),"ローカルの製品 URL または画面ポートが不正です");
  const origin="http://127.0.0.1:"+port;
  let seed, files;
  if (demo) {
    ({seed,files} = await loadDemo(cfg,base));
    cfg.store = join(cfg.store,seed.overview.revision);
  } else {
    seed = await readRegistration(cfg,base);
    files = await filesForTarget(cfg,base,seed.overview);
  }
  if (!seed.records.length || !cfg.ffmpeg || !cfg.ffprobe) {
    Object.assign(cfg,await recordingTools(cfg));
    await checkReplayTools(cfg);
  }
  const target=createServer((req,res)=>{
    const path=req.url==="/"?"/index.html":req.url,bytes=files.get(path);
    if(req.headers.host!==address.host||req.method!=="GET"||!bytes){res.writeHead(404).end();return;}
    res.writeHead(200,{"Content-Type":path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"text/html; charset=utf-8",
      "Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"}).end(bytes);
  });
  await listen(target,Number(address.port),"対象製品用のポートです。使用中のコンソールや配信元を確認してください。");
  try {
    const page=await readResultTemplate(new URL("./local-console/run.html",import.meta.url));
    const app=await openExecution(cfg,base,{registration:seed,fixture:demo});
    const { coveragePage } = await import("./local-console/coverage.mjs");
    const mapPages=new Map();
    const ui=createServer(async(req,res)=>{
      const send=(code,type,data)=>res.writeHead(code,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"frame-ancestors 'none'; form-action 'self'; base-uri 'self'"}).end(data);
      const json=(code,data)=>send(code,"application/json; charset=utf-8",JSON.stringify(data));
      try{
        if(req.headers.host!==new URL(origin).host)return json(403,{error:"接続元を確認できません"});
        const url=new URL(req.url,origin),path=url.pathname;
        const run=/^\/api\/runs\/([a-zA-Z0-9_-]+)\/([1-9]\d*)$/.exec(path);
        if(req.method==="POST"){
          if(!run || req.headers.origin!==origin || req.headers["x-lakda-action"]!=="start")return json(403,{error:"この画面の開始操作を使ってください"});
          const status=await app.start(run[1],Number(run[2]));return json(status,{status});
        }
        if(req.method!=="GET")return json(405,{error:"対応していない操作です"});
        if(path==="/")return res.writeHead(303,{Location:app.view()?"/v/"+app.view()+"/index.html":"/run","Cache-Control":"no-store"}).end();
        if(path==="/run")return send(200,"text/html; charset=utf-8",page);
        if(path==="/coverage"){
          const result=await coveragePage(cfg,base,app,url.searchParams);
          return send(result.status,"text/html; charset=utf-8",result.html);
        }
        if(path==="/architecture"){
          const showLakda=url.searchParams.get("system")==="lakda";
          if(!mapPages.has(showLakda)) mapPages.set(showLakda,await architecturePage(cfg,base,showLakda));
          return send(200,"text/html; charset=utf-8",mapPages.get(showLakda));
        }
        if(path==="/api/suites")return json(200,app.catalog());
        if(run){const job=app.job(run[1],Number(run[2]));return json(job?200:404,job);}
        const match=/^\/v\/(view-[a-zA-Z0-9]+)\/(index|review|steps|conclusion|case-\d+|local-case-\d+|decision-\d+)\.html$/.exec(path);
        if(!match)return json(404,{error:"記録がありません"});
        if(match[2]==="index" && match[1]!==app.view())return res.writeHead(303,{Location:"/","Cache-Control":"no-store"}).end();
        const localPage=join(app.root,match[1],"site",match[2]+".html");
        let html=await readFile(localPage,"utf8");
        const localUrl=pathToFileURL(localPage).href.replaceAll("&","&amp;").replaceAll('"',"&quot;");
        html=html.replace('<html lang="ja">',()=>'<html lang="ja" data-console-origin="'+origin+'" data-local-page="'+localUrl+'">');
        if(match[2]==="index"){
          const catalog=app.catalog();
          const pending=catalog.suites.find(s=>s.latest && (s.latest.state==="running" || !s.latest.totals || s.latest.state==="error"));
          const job=pending?.latest;
          const href=job?"/run?suite="+pending.id+"&amp;attempt="+job.number:"/run";
          const label=!job?"テストを実行":job.state==="running"?"実行中のテストを見る":"実行状況を確認";
          if(job) html=html.replace('data-snapshot="latest"','data-snapshot="indexed"');
          const mapHref=catalog.suites.some(s=>s.hasCoverageMap)?"/coverage#architecture":"/architecture";
          html=html.replace("<!--LOCAL_RUN_LINK-->",'<a class="map-link" href="'+mapHref+'">システム構成図</a><a class="execute" href="'+href+'">'+label+' →</a>');
          html=html.replace("<!--DOMAIN_COVERAGE_LINK-->",'<a class="scope-link" href="/coverage">検証範囲を見る →</a>');
        }
        return send(200,"text/html; charset=utf-8",html);
      }catch(e){if(e.code==="ENOENT")return json(404,{error:"記録がありません"});console.error(e.message);return json(500,{error:"ローカル記録を処理できませんでした"});}
    });
    await listen(ui,port,"--port に別の画面ポートを指定してください。");
    console.error("ブラウザーで次の URL を開いてください。コンソールを終了するには Ctrl+C を押します。");
    console.log(origin+"/");
  }catch(e){target.close();throw e;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
