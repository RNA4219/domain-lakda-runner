import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { discover } from "./e2e-ci-results.mjs";
import { validCheck } from "./e2e-reviewed-checks.mjs";

const observationsSchema = "lakda/recording-observations/v1";
const allowed = ["fine-text", "transient", "motion"];
const help = `使い方
  node scripts/e2e-recording-plan.mjs --scenario-dir <directory> --base-url <url> [--observations <file>]

  --scenario-dir <directory>  作業ディレクトリ内にある、承認済みケースのエクスポート先
  --base-url <url>            操作列と照合する製品の URL
  --observations <file>       ケースごとの観察対象を指定する JSON（省略可）
  --help                      使い方を表示する
`;

class InputError extends Error {}
function invalid(category) { throw new InputError(category); }
function requireKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("観察データの形式が不正");
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    invalid("観察データの形式が不正");
  }
}


async function reviewedChecks(item) {
  let bytes;
  try { bytes = await readFile(join(process.cwd(), item.path, "scenario.json")); }
  catch { invalid("エクスポート検証失敗"); }
  if (createHash("sha256").update(bytes).digest("hex") !== item.reviewSha256) {
    invalid("エクスポート検証失敗");
  }
  let review;
  try { review = JSON.parse(bytes.toString("utf8")); }
  catch { invalid("エクスポート検証失敗"); }
  if (review?.caseId !== item.id || review.caseRevision !== item.caseRevision ||
      review.oracleRevision !== item.oracleRevision) invalid("ケースまたはレビューが不一致");
  const actions = JSON.parse(await readFile(join(process.cwd(), item.path, "action-sequence.json"), "utf8"));
  const actionIds = new Set((actions.actions ?? []).map(action => action.id));
  const checks = review.machineChecks;
  if (!Array.isArray(checks) || checks.length === 0 || checks.some(check => !validCheck(check, review, actionIds))) {
    invalid("machineChecks の形式または種別が不正");
  }
  return { exact: checks.some(check => check.kind === "textEquals"), amount: checks.some(check => check.kind === "amountEquals") };
}

async function plan() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "scenario-dir": { type: "string" },
        "base-url": { type: "string" },
        observations: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
  } catch { invalid("コマンド引数が不正"); }
  const { values, tokens } = parsed;
  const names = tokens.filter(token => token.kind === "option").map(token => token.name);
  if (new Set(names).size !== names.length) invalid("コマンド引数が不正");
  if (values.help) {
    if (names.length !== 1) invalid("コマンド引数が不正");
    return null;
  }
  if (!values["scenario-dir"] || !values["base-url"] ||
      (values.observations !== undefined && !values.observations)) invalid("コマンド引数が不正");
  return buildRecordingPlan(values["scenario-dir"], values["base-url"], values.observations);
}

export async function buildRecordingPlan(scenarioDir, baseUrl, observationsPath) {
  let discovered;
  try { discovered = await discover(process.cwd(), scenarioDir, baseUrl, "platform"); }
  catch { invalid("エクスポート検証失敗"); }
  const cases = [...discovered.cases].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const known = new Map(cases.map(item => [item.id, item]));
  const byCase = new Map();
  if (observationsPath !== undefined) {
    let input;
    try { input = JSON.parse(await readFile(observationsPath, "utf8")); }
    catch { invalid("観察データの形式が不正"); }
    requireKeys(input, ["schemaVersion", "cases"]);
    if (input.schemaVersion !== observationsSchema || !Array.isArray(input.cases)) invalid("観察データの形式が不正");
    for (const row of input.cases) {
      requireKeys(row, ["caseId", "reviewSha256", "observations"]);
      if (typeof row.caseId !== "string" || typeof row.reviewSha256 !== "string" ||
          !Array.isArray(row.observations)) invalid("観察データの形式が不正");
      if (byCase.has(row.caseId)) invalid("観察の種別または重複が不正");
      const item = known.get(row.caseId);
      if (!item || item.reviewSha256 !== row.reviewSha256) invalid("ケースまたはレビューが不一致");
      if (row.observations.some(reason => !allowed.includes(reason)) ||
          new Set(row.observations).size !== row.observations.length) invalid("観察の種別または重複が不正");
      byCase.set(row.caseId, new Set(row.observations));
    }
  }
  const result = [];
  for (const item of cases) {
    const { exact, amount } = await reviewedChecks(item);
    const selected = byCase.get(item.id) ?? new Set();
    const detail = exact || amount || selected.has("fine-text");
    const motion = selected.has("transient") || selected.has("motion");
    const reasons = [...(exact ? ["exact-text"] : []), ...(amount ? ["amount"] : []), ...allowed.filter(reason => selected.has(reason))];
    result.push({
      caseId: item.id,
      caseRevision: item.caseRevision,
      oracleRevision: item.oracleRevision,
      reviewSha256: item.reviewSha256,
      actionSha256: item.actionSha256,
      configSha256: item.configSha256,
      profile: detail ? (motion ? "detail-motion" : "detail") : (motion ? "motion" : "standard"),
      fps: motion ? 15 : 5,
      resolution: detail ? "viewport" : "fit-720p",
      reasons: reasons.length ? reasons : ["final-state"],
    });
  }
  return { schemaVersion: "lakda/recording-plan/v1", policyVersion: "1", cases: result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await plan();
    process.stdout.write(result === null ? help : `${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof InputError ? error.message : "録画計画の生成に失敗"}\n`);
    process.exitCode = 2;
  }
}
