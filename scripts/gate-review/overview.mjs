import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { URL } from "node:url";
import { canonicalJson } from "../../src/core/canonical-json.ts";
import { summarizeCaseOutcomes } from "../e2e-ci-results.mjs";
import { caseFinding } from "../case-review/finding.mjs";
import { readCaseReview, writeCasePage } from "../e2e-case-review.mjs";
import { acceptanceExcerpt } from "../case-review/decision-evidence.mjs";
import { readResultTemplate } from "../result-template.mjs";

const readJson = async file => JSON.parse(await readFile(file, "utf8"));
const sha = value => createHash("sha256").update(value).digest("hex");
function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}

export async function readPlan(base, input, row) {
  const bytes = await readFile(resolve(base, input.caseDir, "scenario.json"));
  requireValue(sha(bytes) === row.reviewSha256, "ケースのレビュー記録が一致しません");
  const review = JSON.parse(bytes);
  const source = await readJson(resolve(base, input.manualCaseSet));
  requireValue(sha(canonicalJson(source)) === review.sourceCaseSetSha256, "登録ケースがレビュー時の版と一致しません");
  const cases = source.manual_cases.filter(c => c.tc_id === row.id && c.revision === row.caseRevision &&
    c.oracle_revision === row.oracleRevision);
  requireValue(cases.length === 1 && cases[0].title?.trim(), "対応する登録ケース名が見つかりません");
  const criteria = [];
  for (const ref of review.oracleRefs) criteria.push(await acceptanceExcerpt(resolve(base, input.featureSpec), review, ref));
  return { title: cases[0].title, criteria };
}

export async function writeOverview(config, base, entries, stage) {
  const { productId, name, revision, environment } = config.overview;
  requireValue([productId, name, revision, environment].every(v => typeof v === "string" && v.trim()), "対象製品・版・環境が必要です");
  const groups = new Map(), pendingDecisions = [], decisions = [], gates = [];
  for (const [i, { record, caseModel }] of entries.entries()) {
    const input = config.records[i], number = i + 1;
    requireValue(record.revision === revision && record.environment === environment &&
      (!record.target.projectId || record.target.projectId === productId), "概要の対象と判定記録が一致しません");
    if (record.state === "disqualified") {
      const anchor = sha(JSON.stringify([revision, environment, record.profile, input.qegManifestSha256, record.caseId, number]));
      gates.push({ number, anchor, state: record.state, profile: record.profile });
      continue;
    }
    const index = await readJson(resolve(base, input.index));
    const batchId = index.localRunId ?? index.workflowRunId, attempt = Number(index.localRunAttempt ?? index.workflowRunAttempt);
    requireValue(index.callerSha === revision && batchId && Number.isSafeInteger(attempt) && attempt > 0 &&
      input.suiteName?.trim(), "スイートと実行回を特定できません");
    const rows = index.cases.filter(c => c.id === record.caseId && c.environment === environment);
    requireValue(rows.length === 1, "実行回に対象ケースが一意に存在しません");
    const [row] = rows;
    const key = JSON.stringify([record.origin, batchId]);
    if (!groups.has(key)) groups.set(key, { name: input.suiteName, attempts: new Map() });
    const group = groups.get(key);
    requireValue(group.name === input.suiteName, "同じスイートの表示名が異なります");
    const signature = sha(canonicalJson(index));
    if (!group.attempts.has(attempt)) group.attempts.set(attempt, { attempt, cases: [], signature, planned: index.cases.length });
    const run = group.attempts.get(attempt);
    requireValue(run.signature === signature && !run.cases.some(c => c.id === row.id), "同一回のスイート記録が競合しています");
    const plan = await readPlan(base, input, row);
    const anchor = sha(JSON.stringify([revision, environment, key, attempt, row.id, signature]));
    const localVerdict = record.origin === "ローカル" && Boolean(record.trace);
    const item = { ...plan, id: row.id, anchor, outcome: row.outcome, number, state: record.state, localVerdict };
    const suiteContext = {name:group.name, attempt, title:plan.title, criteria:plan.criteria, localRunId:index.localRunId};
    item.showSteps = Boolean(record.trace);
    let proof = caseModel;
    if (record.canOpenLocalCase && input.runDir && row.runId) {
      item.casePage = "local-case-" + number + ".html";
      const local = await readCaseReview({ "case-dir": resolve(base, input.caseDir), run: [resolve(base, input.runDir)], out: join(stage, item.casePage) });
      const [observed] = local.model.runs;
      requireValue(observed.runId === row.runId && observed.attempt === row.attempt && observed.manifestSha256 === row.manifestSha256 && observed.outcome === row.outcome, "概要とケース証跡の実行が一致しません");
      await writeCasePage(local, suiteContext);
      proof = local.model;
    }
    if (row.outcome === "failed" && proof) item.finding = proof.finding ?? caseFinding(proof, proof.runs[0], plan.criteria, record.trace?.review.soleConditionFailed);
    if (record.trace?.review.soleConditionFailed && plan.criteria.length === 1) item.unmet = plan.criteria[0];
    run.cases.push(item);
    record.overview = { ...plan, attempt, outcome: row.outcome, name,
      caseRevision:row.caseRevision, oracleRevision:row.oracleRevision };
    if (input.decisionEvidence) {
      const path = resolve(base, input.decisionEvidence), evidence = await readJson(path);
      requireValue(caseModel && evidence.qegOutputManifestSha256 === input.qegManifestSha256 && row.runId === evidence.runId &&
        evidence.attempt === row.attempt && evidence.manifestSha256 === row.manifestSha256, "判断依頼が同じ実行回に結び付きません");
      const page = "decision-" + number + ".html";
      const files = { "case-dir": resolve(base, input.caseDir), run: [resolve(base, input.runDir)], out: join(stage, page),
        "feature-spec": resolve(base, input.featureSpec), "decision-evidence": path };
      pendingDecisions.push({ number, anchor, suiteContext, group, page, files });
    }
  }
  const latest = [], suites = [];
  for (const group of groups.values()) {
    const attempts = Array.from(group.attempts.values()).sort((a, b) => b.attempt - a.attempt);
    for (const run of attempts) {
      requireValue(run.cases.length === run.planned, "スイートの予定ケースが不足しています");
      run.totals = summarizeCaseOutcomes(run.cases);
      delete run.signature;
      delete run.planned;
    }
    for (const c of attempts[0].cases) latest.push({ ...c, suite: group.name, attempt: attempts[0].attempt });
    suites.push({ name: group.name, attempts });
  }
  for (const { number, anchor, suiteContext, group, page, files } of pendingDecisions) {
    const { attempt, title, name: suite } = suiteContext;
    const historical = attempt !== Math.max(...group.attempts.keys());
    const reviewed = await readCaseReview(files);
    await writeCasePage(reviewed, { ...suiteContext, historical });
    const { question, checkScope } = reviewed.run.decision;
    decisions.push({ number, anchor, title, outcome: reviewed.run.outcome, question, checkScope, attempt, suite, historical, page });
  }
  const data = { name, revision, environment, suites, latest, totals: summarizeCaseOutcomes(latest), decisions, gates };
  const template = await readResultTemplate(new URL("./overview.html", import.meta.url));
  await writeFile(join(stage, "index.html"), template.replace("/*OVERVIEW*/", () => JSON.stringify(data).replaceAll("<", "\\u003c")), { flag: "wx" });
}
