import { inspectPlatformRecording } from "./e2e-platform-recording-evidence.mjs";
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { findSensitive } from "../src/core/redaction.ts";
import { canonicalJson } from "../src/core/canonical-json.ts";
import { extendedCheck, toObligation, validCheck } from "./e2e-reviewed-checks.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const files = ["action-sequence.json", "lakda.config.json", "manifest.json", "scenario.json", "scenario.md", "scenario.spec.ts"];
const outcomes = ["passed", "failed", "partial", "error", "not_run", "unreported"];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function label(value) {
  check(typeof value === "string" && value.trim() && value.length <= 255 &&
    !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
    !findSensitive(value).length, "invalid or sensitive case identifier");
  return value;
}

function refs(values) {
  check(Array.isArray(values), "invalid case references");
  return values.map(label);
}

async function json(path) { return JSON.parse(await readFile(path, "utf8")); }

function checkExtendedReview(review, config, plan) {
  const checks = review.machineChecks;
  const extended = (Array.isArray(checks) && checks.some(extendedCheck)) || config.obligations.some(extendedCheck) ||
    config.reviewedOracleVersion !== undefined;
  if (!extended) return;
  check(config.reviewedOracleVersion === 2 && Array.isArray(checks) && checks.some(extendedCheck) &&
    config.obligations.some(extendedCheck) && Array.isArray(plan.actions), "invalid extended review version or actions");
  const actionIds = new Set(plan.actions.map(action => action.id));
  check(checks.every(item => validCheck(item, review, actionIds)), "invalid reviewed check");
  const obligations = checks.map(toObligation);
  check(canonicalJson(obligations) === canonicalJson(config.obligations), "reviewed checks and obligations mismatch");
}

async function output(key, value) {
  await appendFile(process.env.GITHUB_OUTPUT, key + "=" + value + "\n");
}

export async function discover(workspace, scenarioDir, baseUrl, environment) {
  const root = await realpath(workspace);
  const dir = resolve(root, scenarioDir);
  check(dir.startsWith(root + sep) && await realpath(dir) === dir, "invalid scenario directory");
  const dirs = (await readdir(dir, { withFileTypes: true })).filter(x => x.isDirectory()).sort((a,b) => a.name.localeCompare(b.name));
  check(dirs.length && dirs.length <= 100, "invalid scenario count");
  const cases = [];
  for (const item of dirs) {
    check(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(item.name), "invalid scenario id");
    const folder = join(dir, item.name);
    for (const name of files) check((await lstat(join(folder, name))).isFile(), "invalid scenario file");
    const manifest = await json(join(folder, "manifest.json"));
    const review = await json(join(folder, "scenario.json"));
    const plan = await json(join(folder, "action-sequence.json"));
    check(plan.schemaVersion === "lakda/action-plan/v1" && plan.baseUrl === new URL(baseUrl).toString(), "target mismatch");
    check(manifest.schemaVersion === "manual-bb/e2e-export/v1" && manifest.caseId === item.name &&
      review.schemaVersion === "manual-bb/e2e-scenario/v1" && review.caseId === item.name &&
      review.reviewRef && review.reviewedBy, "unreviewed case");
    const expected = files.filter(name => name !== "manifest.json");
    check(Object.keys(manifest.filesSha256).length === expected.length, "unexpected manifest contents");
    for (const name of expected) {
      check(digest(await readFile(join(folder, name))) === manifest.filesSha256[name], "scenario file hash mismatch");
    }
    const config = await json(join(folder, "lakda.config.json"));
    check(config.reviewedE2E === true, "reviewedE2E export required; regenerate with the current exporter");
    check(Array.isArray(config.obligations) && config.obligations.length > 0, "missing reviewed obligations");
    checkExtendedReview(review, config, plan);
    cases.push({ id: item.name, path: relative(root, folder).split(sep).join("/"),
      featureId: label(review.featureId), specRevision: label(review.specRevision), caseRevision: label(review.caseRevision),
      oracleRevision: label(review.oracleRevision), traceTo: refs(review.traceTo ?? []), oracleRefs: refs(review.oracleRefs),
      reviewSha256: manifest.filesSha256["scenario.json"], configSha256: manifest.filesSha256["lakda.config.json"],
      reviewedObligationsSha256: digest(canonicalJson(config.obligations)),
      actionSha256: manifest.filesSha256["action-sequence.json"] });
  }
  return { environment: label(environment), cases };
}

async function directories(dir) {
  try { return (await readdir(dir, {withFileTypes:true})).filter(x => x.isDirectory()).map(x => x.name); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }
}

// The workflow receives one profile map for the suite. Each job receives only
// the entries its reviewed actions reference, even when other cases use different inputs.
export async function prepareCaseInputs(plan, caseId, supplied, platformMode) {
  check(supplied && typeof supplied === "object" && !Array.isArray(supplied), "invalid input profiles");
  const selected = plan.cases.find(item => item.id === caseId);
  check(selected, "missing planned case");
  const allowed = new Set();
  const needed = new Set();
  for (const item of plan.cases) {
    const bytes = await readFile(join(item.path, "action-sequence.json"));
    check(digest(bytes) === item.actionSha256, "scenario file hash mismatch");
    for (const action of JSON.parse(bytes.toString("utf8")).actions) {
      if (action.inputProfileId === undefined) continue;
      const id = action.inputProfileId;
      check(typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id), "invalid input profile reference");
      allowed.add(id);
      if (item === selected) needed.add(id);
    }
  }
  check(Object.keys(supplied).every(key => allowed.has(key) && typeof supplied[key] === "string") &&
    [...needed].every(key => Object.hasOwn(supplied, key)), "invalid or missing input profiles");
  const inputProfiles = Object.fromEntries([...needed].map(key => [key, supplied[key]]));
  if (platformMode) return inputProfiles;
  const bytes = await readFile(join(selected.path, "lakda.config.json"));
  check(digest(bytes) === selected.configSha256, "scenario file hash mismatch");
  return { ...JSON.parse(bytes.toString("utf8")), inputProfiles };
}

export async function record(planned, runRoot, stepOutcome, real, rawDir, verification = {}) {
  if (stepOutcome === "skipped") return { outcome: "not_run", reason: "replay_not_started" };
  const candidates = await directories(runRoot);
  if (!candidates.length) return { outcome: "error", reason: "no_run_record" };
  check(candidates.length === 1, "ambiguous run records");
  return recordRun(planned, join(runRoot, candidates[0]), { stepOutcome, real, rawDir, ...verification });
}

export async function recordRun(planned, runDir, { stepOutcome, real, rawDir, revision, platformMode }) {
  const runRef = basename(runDir);
  const { readManifestSnapshot, MANIFEST_REF } = await import("../dist/runs/manifest-snapshot.js");
  const { hateArtifact, parseRunSummary } = await import("../dist/runs/catalog-values.js");
  const metadata = "run-metadata.json";
  const recordingPath = "platform-recording.json";
  const snapshot = await readManifestSnapshot(runDir, { retain: name => name === metadata || name === recordingPath || name === "action-execution.json",
    policy: (entry, i) => {
      if (entry.path === metadata) {
        hateArtifact(entry, i);
        check(entry.safe_for_summary === true, "metadata is not eligible for summary");
      }
    } });
  const meta = JSON.parse(snapshot.snapshots.get(metadata).bytes.toString("utf8"));
  parseRunSummary(meta, runRef);
  check(meta.mode === "regression-replay" && meta.browser === "chromium" &&
    /^[a-f0-9]{64}$/.test(planned.reviewedObligationsSha256) && meta.reviewedObligationsSha256 === planned.reviewedObligationsSha256 &&
    meta.replayInputSha256 === planned.actionSha256 && meta.runId === snapshot.manifest.run_id &&
    meta.attempt === snapshot.manifest.run_attempt && Number.isSafeInteger(meta.attempt) && meta.attempt > 0 &&
    meta.commitSha === snapshot.manifest.commit_sha && meta.runId.replaceAll(":", "-") === runRef &&
    /^lakda:run-[A-Za-z0-9-]+$/.test(meta.runId) && outcomes.slice(0,4).includes(meta.outcome) &&
    (real === undefined || (meta.executionMode === "real") === real) &&
    (stepOutcome === undefined || (meta.outcome === "passed") === (stepOutcome === "success")),
    "unbound run result");
  if (revision !== undefined || meta.executionMode === "real") {
    check(/^(?!0{40}$)[0-9a-f]{40}$/.test(meta.commitSha) &&
      (revision === undefined || meta.commitSha === revision), "unbound product revision");
  }
  const recordingFile = snapshot.snapshots.get(recordingPath);
  if (recordingFile) {
    const { video } = inspectPlatformRecording(snapshot, planned, meta.runId, meta.attempt);
    check(video.path === "artifacts/video/0001.mp4", "unbound recorded video");
  } else {
    check(!platformMode || !["passed", "failed"].includes(meta.outcome), "missing platform recording");
  }
  let rawEligible = false;
  if (rawDir) {
    // Only manifest-listed, checked bytes may enter an approved raw evidence bundle.
    try { snapshot.artifacts.forEach(hateArtifact); rawEligible = true; } catch { /* unready media remains private */ }
    if (rawEligible) {
      for (const ref of [MANIFEST_REF, ...snapshot.artifacts.map(a => a.path)]) {
        const destination = join(rawDir, runRef, ref);
        await mkdir(dirname(destination), {recursive:true});
        await copyFile(join(runDir, ref), destination);
      }
      const copy = await readManifestSnapshot(join(rawDir, runRef), {policy: hateArtifact});
      check(copy.manifestSha256 === snapshot.manifestSha256, "evidence changed before upload");
    }
  }
  return { outcome: meta.outcome, reason: label(meta.terminationReason), runId: meta.runId, runRef, attempt: meta.attempt,
    manifestSha256: snapshot.manifestSha256, evidenceKind: meta.executionMode === "real" ? "real" : "unknown", rawEligible };
}

export function aggregate(plan, receipts) {
  const expected = new Map(plan.cases.map(c => [c.id,c]));
  const rows = new Map();
  const usedRuns = new Set();
  for (const entry of receipts) {
    check(!rows.has(entry.id) && expected.has(entry.id) &&
      entry.planSha256 === digest(JSON.stringify(expected.get(entry.id))) && outcomes.includes(entry.outcome), "unbound or duplicate case receipt");
    if (entry.runId !== undefined) {
      check(outcomes.slice(0, 4).includes(entry.outcome) &&
        /^lakda:run-[A-Za-z0-9-]+$/.test(entry.runId) && entry.runId.replaceAll(":", "-") === entry.runRef &&
        Number.isSafeInteger(entry.attempt) && entry.attempt > 0 && /^(sha256:)?[0-9a-f]{64}$/.test(entry.manifestSha256) &&
        ["real","unknown"].includes(entry.evidenceKind), "invalid receipt evidence reference");
      const run = JSON.stringify([entry.runId, entry.attempt]);
      check(!usedRuns.has(run), "duplicate case execution");
      usedRuns.add(run);
    } else {
      check(["error","not_run"].includes(entry.outcome) && [entry.runRef, entry.attempt, entry.manifestSha256, entry.evidenceKind, entry.artifactId]
        .every(value => value === undefined), "missing evidence reference");
    }
    if (entry.reason !== undefined) label(entry.reason);
    if (entry.artifactId !== undefined) check(/^[0-9]+$/.test(entry.artifactId), "invalid artifact id");
    rows.set(entry.id, entry);
  }
  const cases = plan.cases.map(c => {
    const receipt = rows.get(c.id);
    return { ...c, environment: plan.environment, outcome: receipt?.outcome ?? "unreported",
      ...(receipt && Object.fromEntries(["reason","runId","runRef","attempt","manifestSha256","evidenceKind","artifactId"]
        .filter(key => receipt[key] !== undefined).map(key => [key,receipt[key]]))) };
  });
  return { schemaVersion:"lakda/e2e-case-index/v1", ...summarizeCaseOutcomes(cases), cases };
}

export function summarizeCaseOutcomes(cases) {
  const counts = Object.fromEntries(outcomes.map(outcome => [outcome, 0]));
  for (const row of cases) {
    check(Object.hasOwn(counts, row.outcome), "unknown case outcome");
    counts[row.outcome]++;
  }
  const evaluated = counts.passed + counts.failed;
  return { planned: cases.length, evaluated, ...counts, successRate: evaluated ? counts.passed / evaluated : null,
    evaluationRate: cases.length ? evaluated / cases.length : null };
}

const html = value => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");

export function summary(index) {
  const {planned,evaluated,passed,failed,partial,error,not_run,unreported} = index;
  const body = index.cases.map(c => {
    const cells = [c.id, c.caseRevision, c.environment, c.traceTo.join(", "), c.oracleRefs.join(", "), c.outcome, c.runId ?? "—"];
    const link = c.artifactUrl ? '<a href="' + html(c.artifactUrl) + '">保存した証跡</a>' : "—";
    return cells.map(v => "<td>" + html(v) + "</td>").join("") + "<td>" + link + "</td>";
  });
  return "## E2E ケース結果\n\n合格 / 判定済み " + passed + "/" + evaluated + "、判定済み / 予定 " + evaluated + "/" + planned +
    "\n\n不合格 " + failed + "、部分実行 " + partial + "、エラー " + error + "、未実行 " + not_run + "、報告なし " + unreported +
    "\n\n<table><tr><th>ケース</th><th>版</th><th>環境</th><th>要求・AC</th><th>判定根拠</th><th>結果</th><th>実行 ID</th><th>証跡</th></tr>" +
    body.map(s => "<tr>"+s+"</tr>").join("")+"</table>\n";
}

async function main() {
  const env = process.env;
  switch (process.argv[2]) {
    case "prepare-inputs": {
      let supplied;
      try { supplied = JSON.parse(env.INPUT_PROFILES_JSON || "{}"); }
      catch { throw new Error("invalid input profiles"); }
      const value = await prepareCaseInputs(await json(env.PLAN_PATH), env.CASE_ID, supplied, env.PLATFORM_MODE === "true");
      await writeFile(env.INPUT_FILE, JSON.stringify(value), { flag: "wx", mode: 0o600 });
      break;
    }
    case "discover": {
      const plan = await discover(process.cwd(), env.SCENARIO_DIR, env.TARGET_BASE_URL, env.ENVIRONMENT_NAME);
      const group = digest(JSON.stringify([env.SCENARIO_DIR,env.TARGET_BASE_URL,env.RUNTIME_SHA,plan])).slice(0,24);
      const jsonPlan = JSON.stringify(plan);
      check(!findSensitive(jsonPlan).length, "unsafe case plan");
      await writeFile(env.PLAN_PATH,jsonPlan+"\n",{flag:"wx"});
      await output("group", group);
      await output("matrix", JSON.stringify({include:plan.cases.map(c=>({id:c.id,path:c.path}))}));
      break;
    }
    case "record": {
      const planned = (await json(env.PLAN_PATH)).cases.find(c => c.id === env.CASE_ID);
      check(planned, "missing planned case");
      let result;
      try { result = await record(planned, env.RUNS_DIR, env.REPLAY_OUTCOME, env.REAL_TARGET === "true", env.RAW_DIR || undefined,
        { revision: env.GITHUB_SHA, platformMode: env.PLATFORM_MODE === "true" }); }
      catch { result = { outcome:"error",reason:"invalid_evidence" }; }
      const row = { id:planned.id, planSha256:digest(JSON.stringify(planned)), ...result };
      const text = JSON.stringify(row);
      check(!findSensitive(text).length, "unsafe receipt");
      await writeFile(env.RECEIPT_PATH, text+"\n", {flag:"wx"});
      await output("raw-eligible", result.rawEligible === true ? "true" : "false");
      if (result.reason === "invalid_evidence" || result.reason === "no_run_record") process.exitCode = 1;
      break;
    }
    case "summary": {
      const plan = await json(env.PLAN_PATH);
      const rows = [];
      for (const folder of await directories(env.RECEIPTS_DIR)) {
        const path = join(env.RECEIPTS_DIR, folder);
        const row = await json(join(path, "receipt.json"));
        try {
          row.artifactId = (await readFile(join(path,"artifact-id.txt"),"utf8")).trim();
          check(/^[0-9]+$/.test(row.artifactId), "invalid artifact id");
        } catch (e) { if (e.code !== "ENOENT") throw e; }
        rows.push(row);
      }
      const result = { ...aggregate(plan, rows), runtimeSha:env.RUNTIME_SHA, callerSha:env.GITHUB_SHA,
        workflowRunId:env.GITHUB_RUN_ID, workflowRunAttempt:env.GITHUB_RUN_ATTEMPT };
      result.workflowRunUrl = new URL(env.GITHUB_REPOSITORY + "/actions/runs/" + env.GITHUB_RUN_ID, env.GITHUB_SERVER_URL).href;
      for (const entry of result.cases) {
        if (entry.artifactId) entry.artifactUrl = result.workflowRunUrl + "/artifacts/" + entry.artifactId;
      }
      const text = JSON.stringify(result,null,2);
      check(!findSensitive(text).length, "unsafe case index");
      await writeFile(env.INDEX_PATH,text+"\n",{flag:"wx"});
      await appendFile(env.GITHUB_STEP_SUMMARY,summary(result));
      if (result.unreported || result.not_run || result.error) process.exitCode = 1;
      break;
    }
    default: throw new Error("unknown command");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
