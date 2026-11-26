import { readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL, URL } from "node:url";
import { discover } from "./e2e-ci-results.mjs";
import { inspectPlatformRecording } from "./e2e-platform-recording-evidence.mjs";
import { readManifestSnapshot } from "../dist/runs/manifest-snapshot.js";
import { readArtifactSnapshot } from "../dist/runs/artifact-snapshot.js";
import { acceptanceExcerpt, bindDecision, readDecisionSnapshot } from "./case-review/decision-evidence.mjs";
import { caseFinding, caseValue } from "./case-review/finding.mjs";
import { bindPlayback } from "./case-review/playback.mjs";
import { readResultTemplate } from "./result-template.mjs";

const logFiles = new Set(["run-metadata.json", "action-execution.json", "console.jsonl", "platform-recording.json"]);
const template = new URL("./case-review/view.html", import.meta.url);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

// 既存の判定画面と同じレビュー名を、ケース詳細でも使う。
const actionName = name => name === "試験データの結果行を押す" ? "結果行を押す" : name;
const targetName = name => name === "検出試験専用の存在しないボタン" ? "試験用ボタン" : name;

async function checkedJson(root, name, hash) {
  const file = await readArtifactSnapshot(root, name, { retain: true });
  ensure(file.sha256 === "sha256:" + hash, "ケースの内容が変わりました");
  return JSON.parse(file.bytes);
}

function readObservations(bytes, checks) {
  const observations = [];
  for (const line of bytes.toString("utf8").split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.source !== "reviewed-oracle") continue;
    const obs = JSON.parse(event.message);
    const check = checks[obs.index - 1];
    ensure(Number.isSafeInteger(obs.index) && check && check.acceptanceRef === obs.acceptanceRef &&
      check.afterActionId === obs.actionId && ["passed", "failed", "partial"].includes(obs.result) &&
      [obs.before, obs.observed].every(n => n == null || Number.isSafeInteger(n)), "期待値と観測記録を照合できません");
    observations.push({ index: obs.index, result: obs.result, before: obs.before, observed: obs.observed });
  }
  return observations;
}

// V02 の試験サーバーは POST を受理した時点でイベントを記録する。
// ブラウザーのクリックだけでは、サーバーに注文が届いたかは確定しない。
async function readV02Receipt(path, root, plan, review) {
  if (!path) return;
  const receipt = JSON.parse(await readFile(path, "utf8"));
  const specHash = createHash("sha256").update(await readFile(join(root, "scenario.spec.ts"))).digest("hex");
  ensure(receipt.scope === "loopback-fixture" && receipt.caseId === "TC-V02" && plan.id === receipt.caseId &&
    typeof review.approvedBindingSha256 === "string" && receipt.bindingSha256 === review.approvedBindingSha256 &&
    receipt.generatedSpecSha256 === specHash && Array.isArray(receipt.comparisons), "V02 のケースと受入記録が一致しません");
  const byRun = new Map();
  for (const row of receipt.comparisons) {
    ensure(typeof row?.runId === "string" && !byRun.has(row.runId), "受入記録の実行 ID が不正または重複しています");
    byRun.set(row.runId, row);
  }
  return byRun;
}

function receivedOrders(row, meta, video, actions) {
  if (!row) return null;
  const events = row.replayRequests;
  ensure(meta.attempt === 1 && row.outcome === meta.outcome && "sha256:" + row.videoSha256 === video.sha256 &&
    Array.isArray(events) && events.every(event => ["confirm", "submit", "finish"].includes(event)) &&
    isDeepStrictEqual(events, row.generatedRequests) &&
    isDeepStrictEqual(["open", ...events], actions.executions.map(action => action.actionId)),
  "V02 の受信記録がこの実行回の証跡と一致しません");
  return events.filter(event => event === "submit").length;
}

function checkLogPolicy(item) {
  if (!logFiles.has(item.path)) return;
  ensure(["internal", "public"].includes(item.classification) && item.safe_for_summary &&
    ["redacted", "not_required"].includes(item.redaction_status) &&
    item.security_checks?.secrets_scan === "pass" && item.security_checks?.pii_scan === "pass",
  "閲覧できない操作記録です");
}

async function readRun(runDir, plan, checks, output, receipts, evidence) {
  const required = evidence ? ["run-metadata.json", "action-execution.json", "platform-recording.json"] : logFiles;
  const snapshot = evidence
    ? await readDecisionSnapshot(runDir, evidence, required, checkLogPolicy)
    : await readManifestSnapshot(runDir, { retain: ref => logFiles.has(ref), policy: checkLogPolicy });
  for (const name of required) ensure(snapshot.snapshots.get(name)?.bytes, "必要な記録がありません " + name);
  const meta = JSON.parse(snapshot.snapshots.get("run-metadata.json").bytes);
  const manifest = snapshot.manifest;
  ensure(meta.mode === "regression-replay" && meta.runId === manifest.run_id && meta.attempt === manifest.run_attempt &&
    meta.commitSha === manifest.commit_sha && meta.reviewedObligationsSha256 === plan.reviewedObligationsSha256 &&
    meta.replayInputSha256 === plan.actionSha256, "ケースと実行回が一致しません");
  const { recording, actions, video } = inspectPlatformRecording(snapshot, plan, meta.runId, meta.attempt);
  const permitted = ["internal", "public"].includes(video.classification) && video.redaction_status !== "failed" &&
    !Object.values(video.security_checks ?? {}).includes("fail");
  const decision = evidence && bindDecision(evidence, plan, recording, video, snapshot);
  let unavailable = permitted ? "" : "この動画の閲覧は制限されています。";
  if (decision && permitted) {
    try {
      await readArtifactSnapshot(snapshot.root, video.path, { expected: { size: video.size_bytes, sha256: video.sha256 } });
    } catch { unavailable = "この実行回の動画を読み取れないか、内容が記録と一致しません。"; }
  }
  const allowed = !unavailable;
  return {
    runId: meta.runId, attempt: meta.attempt, startedAt: meta.startedAt, outcome: meta.outcome,
    reason: meta.terminationReason, manifestSha256: snapshot.manifestSha256, revision: meta.commitSha,
    observations: decision ? [] : readObservations(snapshot.snapshots.get("console.jsonl").bytes, checks),
    decision,
    receivedOrders: receivedOrders(receipts?.get(meta.runId), meta, video, actions),
    actions: actions.executions.map(({ actionId, sequence, status }, i) => ({
      actionId, sequence, status, offsetMs: recording.actions[i].offsetMs,
    })),
    video: {
      allowed, unavailable, fps: recording.measured.fps, width: recording.measured.width, height: recording.measured.height,
      ...(allowed ? { hash: video.sha256, size: video.size_bytes, file: relative(dirname(output), join(snapshot.root, video.path)) } : {}),
    },
  };
}

export async function readCaseReview(values, selected) {
  ensure(values["case-dir"] && values.run?.length && values.out, "使い方: --case-dir <ケース> --run <実行ディレクトリ> [--run ...] --out <新規HTML>");
  const root = await realpath(values["case-dir"]);
  const exportsRoot = dirname(root);
  const actionFile = JSON.parse(await readFile(join(root, "action-sequence.json"), "utf8"));
  const { cases } = await discover(dirname(exportsRoot), exportsRoot, actionFile.baseUrl, "local-review");
  const plan = cases.find(item => item.id === basename(root));
  ensure(plan, "ケースを確認できません");
  const review = await checkedJson(root, "scenario.json", plan.reviewSha256);
  const actions = await checkedJson(root, "action-sequence.json", plan.actionSha256);
  const config = await checkedJson(root, "lakda.config.json", plan.configSha256);
  const checks = config.obligations;
  const output = resolve(values.out);
  const receipts = await readV02Receipt(values["v02-acceptance"], root, plan, review);
  let evidence;
  if (values["decision-evidence"]) {
    ensure(values.run.length === 1 && !receipts, "判断依頼には、対応する一つの実行回を指定してください");
    evidence = JSON.parse(await readFile(values["decision-evidence"], "utf8"));
    ensure(evidence?.decisionRequest, "判断依頼がありません");
  }
  ensure(!values["feature-spec"] || evidence, "--feature-spec には判断依頼が必要です");
  const runs = [];
  for (const dir of values.run) {
    const run = await readRun(dir, plan, checks, output, receipts, evidence);
    ensure(!runs.some(r => r.runId === run.runId && r.attempt === run.attempt), "同一実行回が重複しています");
    runs.push(run);
  }
  if (evidence) {
    const decision = runs[0].decision;
    decision.excerpt = await acceptanceExcerpt(values["feature-spec"], review, decision.acceptanceRef);
    const locator = checks.length === 1 && checks[0].visible;
    if (runs[0].outcome === "passed" && locator?.role === "button" && locator.name && !locator.testId) {
      decision.checkScope = "画面全体で「" + locator.name + "」ボタンの表示を照合。表示場所の指定はありません。";
    }
  }
  if (selected) {
    const [run] = runs;
    ensure(runs.length === 1 && plan.id === selected.caseId && run.runId === selected.runId &&
      run.attempt === selected.attempt && run.manifestSha256 === selected.manifestSha256,
    "ケース画面の証跡が QEG の選んだ実行と一致しません");
  }
  const sourceSteps = Object.fromEntries(actions.actions.map((action, i) => [action.id,
    review.steps?.length === actions.actions.length ? review.steps[i] : action.id]));
  const actionLabels = Object.fromEntries(Object.entries(sourceSteps).map(([id, step]) => [id, actionName(step)]));
  const model = {
    caseId: plan.id, featureId: plan.featureId, caseRevision: plan.caseRevision, oracleRevision: plan.oracleRevision,
    specRevision: plan.specRevision, reviewRef: review.reviewRef, ac: plan.oracleRefs,
    fixtureReceipt: !!receipts,
    ...(selected ? { gateRecord: selected.recordNumber, expectedResults: review.expectedResults } : {}),
    actionLabels, actions: actions.actions.map(item => item.id),
    checks: checks.map(c => ({
      ref: c.acceptanceRef, action: c.afterActionId,
      kind: c.countDelta ? "増減件数" : c.countEquals ? "一覧の件数" : c.amountEquals ? "表示金額" :
        c.hidden ? "非表示" : c.visible ? "表示状態" : c.textEquals ? "表示文言" : "表示先",
      target: targetName((c.visible ?? c.hidden ?? c.textEquals?.locator ?? c.amountEquals?.locator ?? c.countEquals?.locator ?? c.countDelta?.locator)?.name),
      currency: c.amountEquals?.currency,
      expected: c.countDelta?.value ?? c.countEquals?.value ?? c.amountEquals?.minorUnits ??
        c.textEquals?.text ?? c.expectedUrl ?? (c.hidden ? "非表示になる" : "表示される"),
    })), runs,
  };
  return { output, model, review, sourceSteps, checks, run: runs[0] };
}

export async function writeCasePage({ output, model }, suite) {
  if (suite) {
    model.suite = suite;
    const [run] = model.runs;
    if (model.runs.length === 1 && run.outcome === "failed" && !run.decision) model.finding = caseFinding(model, run, suite.criteria);
  }
  const safeJson = JSON.stringify(model).replaceAll("<", "\\u003c");
  const html = (await readResultTemplate(template)).replace("/*PLAYBACK*/", () => bindPlayback.toString())
    .replace("/*CASE_VALUE*/", () => caseValue.toString())
    .replace("<!--OVERVIEW_LINK-->", suite ? '<a class="home-link" href="index.html">← テスト概要</a>' : "")
    .replace("/*CASE_DATA*/", () => safeJson);
  await writeFile(output, html, { flag:"wx" });
  return output;
}

export async function writeCaseReview(values, selected, suite) {
  return writeCasePage(await readCaseReview(values, selected), suite);
}

// 判定画面の文言も、ケース画面と同じ照合済みのスナップショットから作る。
export async function readGateCaseReview(values, selected) {
  const { model, review, sourceSteps, checks, run } = await readCaseReview(values, selected);
  const single = checks.length === 1 && review.expectedResults?.length === 1;
  const summary = {
    actions: run.actions.map(({ actionId, status, sequence, offsetMs }) => ({
      name: model.actionLabels[actionId] ?? actionId, source: sourceSteps[actionId] ?? actionId, status, sequence, offsetMs,
    })),
    expected: review.expectedResults ?? [],
    button: single && checks[0].visible?.role === "button" ? targetName(checks[0].visible.name) : undefined,
    soleConditionFailed: single && run.outcome === "failed" && run.reason === "obligations_unmet",
    casePassed: run.outcome === "passed",
  };
  return { summary, model };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      "case-dir": { type: "string" }, run: { type: "string", multiple: true }, out: { type: "string" },
      "v02-acceptance": { type: "string" },
      "decision-evidence": { type: "string" }, "feature-spec": { type: "string" },
    } });
    console.log(await writeCaseReview(values));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
