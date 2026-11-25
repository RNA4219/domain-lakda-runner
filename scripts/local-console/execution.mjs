import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { discover, recordRun, summarizeCaseOutcomes } from "../e2e-ci-results.mjs";
import { readPlan } from "../gate-review/overview.mjs";
import { gitHead, readRegistration } from "./setup.mjs";

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
const exec = promisify(execFile);
const json = async p => JSON.parse(await readFile(p, "utf8"));
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2), { flag:"wx" });
function check(ok, message) { if (!ok) throw Error(message); }
const evidenceKey = (suite,attempt,row) => JSON.stringify([suite,attempt,row.id,row.runId,row.manifestSha256]);
async function cli(name, args, cwd) {
  return (await exec(process.execPath, [join(scripts, name), ...args], { cwd, windowsHide:true, maxBuffer:4*1024*1024 })).stdout;
}

export async function openExecution(settings, base, { registration, fixture = false } = {}) {
  const seed = registration ?? await readRegistration(settings, base);
  const {revision, environment} = seed.overview;
  const root = resolve(base, settings.store);
  check(Array.isArray(settings.suites) && settings.suites.length > 0, "設定に1件以上の suites を登録してください");
  await mkdir(root, {recursive:true});
  const runtime = await gitHead(dirname(scripts)), suites = new Map();
  const seedIndexes = new Map(), seedLinks = new Map();
  for (const [i,record] of seed.records.entries()) {
    if (!record.manualCaseSet) continue;
    if (!seedIndexes.has(record.index)) seedIndexes.set(record.index,await json(record.index));
    const index = seedIndexes.get(record.index);
    if (!record.runDir) continue;
    const row = index.cases.find(c=>c.id===basename(record.caseDir) && c.runRef===basename(record.runDir));
    if (row?.runId) seedLinks.set(evidenceKey(index.localRunId,index.localRunAttempt,row),"local-case-"+(i+1)+".html");
  }
  let view = {id: null, links: new Map()}, busy;
  for (const registered of settings.suites) {
    const {id} = registered;
    check(typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) && !suites.has(id), "登録スイートの識別子が不正です");
    const cwd = resolve(base, registered.checkout), exportsDir = resolve(cwd, registered.scenarios);
    check(await gitHead(cwd) === revision, "登録チェックアウトの対象版が一致しません");
    const plan = await discover(cwd, exportsDir, settings.baseUrl, environment);
    let previous = 0, name, sources = new Map();
    const history = new Map();
    for (const record of seed.records.filter(r => r.manualCaseSet)) {
      const index = seedIndexes.get(record.index);
      if (index.localRunId !== id || index.executionOrigin !== "local") continue;
      const n = index.localRunAttempt;
      if (!history.has(n)) history.set(n,{index, roots:new Map()});
      const saved = history.get(n);
      check(isDeepStrictEqual(saved.index,index),"同じ回のケース索引が一致しません");
      if (record.runDir) saved.roots.set(basename(record.runDir),dirname(record.runDir));
      if (index.localRunAttempt < previous) continue;
      if (index.localRunAttempt > previous) { previous = index.localRunAttempt; sources = new Map(); }
      name = record.suiteName;
      const caseId = basename(record.caseDir), row = index.cases.find(c => c.id === caseId);
      check(row && !sources.has(caseId) && index.callerSha === revision && row.environment === environment, "登録索引が一致しません");
      sources.set(caseId, {record,row});
    }
    if (previous) {
      check(name && plan.cases.length === sources.size, "登録スイートの予定数が一致しません");
    } else {
      check(registered.name?.trim() && registered.featureSpec && registered.manualCaseSet,
        id + " の初回登録に name、featureSpec、manualCaseSet が必要です");
      name = registered.name;
    }
    const cases = [];
    for (const c of plan.cases) {
      const entry = sources.get(c.id);
      if (previous) check(entry && ["reviewSha256","actionSha256","configSha256","caseRevision","oracleRevision"].every(k=>c[k]===entry.row[k]), "登録ケースが保存時の版と異なります");
      const ref = entry?.record ?? registered;
      const original = {caseDir:join(exportsDir,c.id), featureSpec:resolve(base,ref.featureSpec),
        manualCaseSet:resolve(base,ref.manualCaseSet), suiteName:name};
      cases.push({id:c.id, ...await readPlan(base,original,c), original});
    }
    const dir = join(root,id);
    await mkdir(dir,{recursive:true});
    suites.set(id,{id,name,cwd,dir,exportsDir,plan,cases,previous,history,hasCoverageMap:Boolean(registered.coverageMap),jobs:new Map()});
  }

  async function refresh() {
    const records = [...seed.records], links = new Map(seedLinks);
    for (const s of suites.values()) for (const job of s.jobs.values()) {
      if (!job.index) continue;
      const indexPath = join(job.dir,"result","index.json");
      for (const c of s.cases) {
        const row = job.index.cases.find(x=>x.id===c.id);
        const runDir = row.runRef ? join(job.dir,"runs",row.runRef) : undefined;
        records.push({...c.original, index:indexPath, qegDir:join(job.dir,"qeg"),runDir});
        if (runDir) links.set(evidenceKey(s.id,job.n,row), "local-case-"+records.length+".html");
      }
    }
    if (!records.length) return;
    const dir = await mkdtemp(join(root,"view-"));
    const from = join(dir,"records.json");
    await save(from,{overview:seed.overview,records});
    await cli("e2e-gate-review.mjs",["--input",from,"--out",join(dir,"site")],dirname(scripts));
    const issued=new Set(await readdir(join(dir,"site")));
    for(const [id,page] of links) if(!issued.has(page)) links.delete(id);
    view = {id:basename(dir),links};
  }

  const argsFor = s=>["--scenario-dir",s.exportsDir,"--base-url",settings.baseUrl,"--environment",environment];
  async function publish(s,job,mappings) {
    await cli("e2e-local-results.mjs",["--plan",join(job.dir,"plan.json"),...argsFor(s),"--revision",revision,"--runtime-sha",runtime,
      "--local-run-id",s.id,"--local-run-attempt",String(job.n),"--out",join(job.dir,"result"),...mappings],s.cwd);
    job.index = await json(join(job.dir,"result","index.json"));
  }

  for (const s of suites.values()) {
    const saved = (await readdir(s.dir)).filter(f=>/^attempt-[1-9]\d*$/.test(f)).sort((a,b)=>Number(a.slice(8))-Number(b.slice(8)));
    for (const file of saved) {
      const n = Number(file.slice(8)), dir = join(s.dir,file);
      check(n>s.previous && Number.isSafeInteger(n),"保存先の実行系列が登録履歴と重複しています");
      const job = {n, dir, state:"interrupted",message:"前回のプロセスが完了前に終了しました。"};
      s.jobs.set(n,job);
      let end;
      try { end=await json(join(dir,"end.json")); } catch(e) { if(e.code!=="ENOENT") throw e; }
      try { job.index = await json(join(dir,"result","index.json")); }
      catch(error) {
        if(error.code!=="ENOENT") throw error;
        // A reserved attempt never inherits earlier results, even if the process stopped before replay.
        if(end) {
          job.state="error";job.message="保存済みの実行結果の索引がありません。";
        } else {
          try {
            await mkdir(join(dir,"qeg"),{recursive:true});
            await save(join(dir,"plan.json"),s.plan).catch(e=>{if(e.code!=="EEXIST")throw e;});
            const mappings=[];
            for(const [i,c] of s.plan.cases.entries()){
              let receipt;
              try { receipt=await json(join(dir,"receipt-"+i+".json")); } catch(e) { if(e.code==="ENOENT")continue;throw e; }
              check(receipt.id===c.id && /^lakda-run-[A-Za-z0-9-]+$/.test(receipt.runRef),"回収した実行記録が不正です");
              const path=join(dir,"runs",receipt.runRef);
              const verified=await recordRun(c,path,{revision,real:!fixture,platformMode:true});
              check(verified.manifestSha256===receipt.manifestSha256,"回収した証跡が一致しません");
              mappings.push("--run",c.id+"="+path);
            }
            await publish(s,job,mappings);
          } catch { job.message="実行が中断し、今回の索引を発行できませんでした。"; }
        }
      }
      if(end && job.index) {job.state=end.state;job.message=end.message;}
      if(job.index) check(job.index.localRunId===s.id && job.index.localRunAttempt===n && job.index.callerSha===revision,"保存先の実行回・対象版が一致しません");
    }
  }
  await refresh();
  const newest = s=>Math.max(s.previous,...s.jobs.keys());
  function jobInfo(s,job) {
    const index = job.index;
    return {number:job.n,state:job.state,message:job.message,
      cases:s.cases.map(c=>{
        const row=index?.cases.find(r=>r.id===c.id);
        const page=row && view.links.get(evidenceKey(s.id,job.n,row));
        return {id:c.id,title:c.title,outcome:row?.outcome,reason:row?.reason,href:page?"/v/"+view.id+"/"+page:undefined};
      }), totals:index?summarizeCaseOutcomes(index.cases):null};
  }
  function catalog() {
    return {product:seed.overview, hasResults: Boolean(view.id), suites:Array.from(suites.values(),s=>({id:s.id,name:s.name,next:newest(s)+1,hasCoverageMap:s.hasCoverageMap,
      cases:s.cases.map(c=>({title:c.title,criteria:c.criteria})), latest:s.jobs.size?jobInfo(s,s.jobs.get(newest(s))):null})), busy:busy?.id};
  }
  async function run(s,job) {
    const mappings=[], missing=[];
    try {
      await mkdir(join(job.dir,"qeg"));
      await save(join(job.dir,"plan.json"),s.plan);
      check(await gitHead(s.cwd)===revision && isDeepStrictEqual(s.plan,await discover(s.cwd,s.exportsDir,settings.baseUrl,environment)),
        "実行前の対象版または予定が変わりました。");
      const recordPlan = join(job.dir,"recording.json");
      await save(recordPlan,JSON.parse(await cli("e2e-recording-plan.mjs",["--scenario-dir",s.exportsDir,"--base-url",settings.baseUrl],s.cwd)));
      const output = join(job.dir,"runs");
      for (const [i,c] of s.plan.cases.entries()) {
        const args=["--scenario-dir",s.exportsDir,"--base-url",settings.baseUrl,"--case",c.id,"--plan",recordPlan,
          "--output-dir",output,"--ffmpeg",settings.ffmpeg,"--ffprobe",settings.ffprobe];
        const registration = settings.suites.find(item => item.id === s.id);
        if (registration.surfaceCatalog) args.push("--surface-catalog", resolve(base, registration.surfaceCatalog), "--surface-lane", registration.surfaceLane ?? "unknown");
        if (!fixture) args.push("--execution-mode","real");
        let stdout, diagnostic;
        try { stdout=await cli("e2e-platform-replay.mjs",args,s.cwd); }
        catch(e) { stdout=e.stdout; diagnostic=e.stderr||e.message; }
        try {
          const result=JSON.parse(stdout);
          check(/^lakda:run-[A-Za-z0-9-]+$/.test(result.runId),"実行 ID が不正です");
          const path=join(output,result.runId.replaceAll(":","-"));
          const verified=await recordRun(c,path,{revision,real:!fixture,platformMode:true});
          await save(join(job.dir,"receipt-"+i+".json"),{id:c.id,runRef:verified.runRef,manifestSha256:verified.manifestSha256});
          mappings.push("--run",c.id+"="+path);
        } catch(e) {
          missing.push(c.id);
          await save(join(job.dir,"diagnostic-"+i+".json"),{message:String(diagnostic||e.message)});
        }
      }
      await publish(s,job,mappings);
      await refresh();
      job.state="complete";job.message=missing.length?"今回の結果を照合できなかったケースは未報告です。":"";
    } catch(e) {
      job.state="error";job.message="今回の実行または結果の発行に失敗しました。";
      await save(join(job.dir,"error.json"),{message:e.message});
      if(!job.index) {try { await publish(s,job,[]); await refresh(); } catch { /* no verified index available */ }}
    } finally {
      try { await save(join(job.dir,"end.json"),{state:job.state,message:job.message}); }
      finally { busy=undefined; }
    }
  }
  async function start(id,n) {
    const s=suites.get(id);
    if(!s || !Number.isSafeInteger(n) || n<1) return 400;
    const existing=s.jobs.get(n);
    if(existing) {
      if(existing.reservation) await existing.reservation;
      return 200;
    }
    if(busy || n!==newest(s)+1) return 409;
    busy=s;
    const job={n,dir:join(s.dir,"attempt-"+n),state:"running",message:""};
    s.jobs.set(n,job);
    job.reservation=mkdir(job.dir);
    try {await job.reservation;}
    catch(e) {s.jobs.delete(n);busy=undefined;if(e.code==="EEXIST")return 409;throw e;}
    finally {delete job.reservation;}
    void run(s,job).catch(error=>console.error(error.message));
    return 202;
  }
  function coverageContext(id,number) {
    const suite = suites.get(id);
    if (!suite) return null;
    const n = number ?? newest(suite), job = suite.jobs.get(n), saved = suite.history.get(n);
    if (number !== null && !job && !saved) return null;
    const index = job ? job.index : saved?.index;
    const caseLinks = new Map();
    for (const row of index?.cases ?? []) {
      const page = view.links.get(evidenceKey(suite.id,n,row));
      if (page) caseLinks.set(row.id,"/v/"+view.id+"/"+page);
    }
    return { number:n, index, caseLinks, hasJob:Boolean(job), state:job?.state, fixture,
      directory:ref => {
        if (job) return join(job.dir,"runs");
        const root = saved?.roots.get(ref);
        check(root,"この回の実行証跡が見つかりません");
        return root;
      } };
  }
  return {root,start,catalog,coverageContext,view:()=>view.id,job:(id,n)=>{const s=suites.get(id),j=s?.jobs.get(n);return j?jobInfo(s,j):null;}};
}
