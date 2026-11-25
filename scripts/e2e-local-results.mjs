import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseArgs } from "node:util";
import { aggregate, discover, recordRun } from "./e2e-ci-results.mjs";

const help = `使い方
  node scripts/e2e-local-results.mjs plan --scenario-dir exports --base-url <URL> --environment <環境名> --out <新規ファイル>
  node scripts/e2e-local-results.mjs --plan <事前予定表> --scenario-dir exports --base-url <URL> --environment <環境名>
    --revision <製品コミット> --runtime-sha <使用したLakdaのコミット>
    --local-run-id <ローカル実行系列> --local-run-attempt <正整数> --out <新規ディレクトリ>
    [--run <ケースID>=<runディレクトリ>]... [--not-run <ケースID>]...

今回の実行記録を照合し、case-plan.json と index.json を発行します。
指定のないケースは unreported、明示的な未実行は not_run になります。\n`;

async function main() {
  const planning = process.argv[2] === "plan";
  if (planning) process.argv.splice(2, 1);
  const required = planning ? ["scenario-dir", "base-url", "environment", "out"] : ["plan", "scenario-dir", "base-url", "environment", "revision", "runtime-sha", "local-run-id", "local-run-attempt", "out"];
  const options = Object.fromEntries(required.map(name => [name, { type: "string" }]));
  const { values, tokens } = parseArgs({ options: { ...options, run: { type: "string", multiple: true },
    "not-run": { type: "string", multiple: true }, help: { type: "boolean" } }, tokens: true });
  if (values.help && tokens.length === 1) { process.stdout.write(help); return; }
  if (values.help || required.some(key => !values[key] || tokens.filter(t => t.name === key).length !== 1)) {
    throw new Error("必須引数または指定回数が不正です");
  }
  if (planning) {
    if ((values.run?.length ?? 0) || (values["not-run"]?.length ?? 0)) throw new Error("予定表に実行結果を指定できません");
    const plan = await discover(process.cwd(), values["scenario-dir"], values["base-url"], values.environment);
    const dest = resolve(values.out);
    await mkdir(dirname(dest), { recursive: true });
    const stage = await mkdtemp(join(dirname(dest), ".local-plan-"));
    try {
      const staged = join(stage, "case-plan.json");
      await writeFile(staged, JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
      await link(staged, dest);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
    process.stdout.write(JSON.stringify({ planned: plan.cases.length }) + "\n");
    return;
  }
  const attempt = Number(values["local-run-attempt"]);
  const revision = /^(?!0{40}$)[0-9a-f]{40}$/;
  if (!revision.test(values.revision) || !revision.test(values["runtime-sha"]) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(values["local-run-id"]) ||
      !/^[1-9]\d*$/.test(values["local-run-attempt"]) || !Number.isSafeInteger(attempt)) {
    throw new Error("製品版・runtime 版・実行系列・実行回を確認してください");
  }
  const planBytes = await readFile(resolve(values.plan));
  const plan = JSON.parse(planBytes.toString("utf8"));
  const current = await discover(process.cwd(), values["scenario-dir"], values["base-url"], values.environment);
  if (!isDeepStrictEqual(plan, current)) throw new Error("事前予定表と現在のケースまたは環境が一致しません");
  const cases = new Map(plan.cases.map(c => [c.id, c]));
  const receipts = [];
  function add(id, result) {
    const planned = cases.get(id);
    if (!planned) throw new Error("ケースが未登録または重複しています");
    cases.delete(id);
    receipts.push({ id, planSha256: createHash("sha256").update(JSON.stringify(planned)).digest("hex"), ...result });
  }
  for (const mapping of values.run ?? []) {
    const separator = mapping.indexOf("=");
    const id = mapping.slice(0, separator);
    const path = mapping.slice(separator + 1);
    if (separator < 1 || !path || !cases.has(id)) throw new Error("run のケース指定が不正です");
    const result = await recordRun(cases.get(id), resolve(path), { revision: values.revision, platformMode: true });
    add(id, result);
  }
  for (const id of values["not-run"] ?? []) add(id, { outcome: "not_run", reason: "replay_not_started" });
  const index = { ...aggregate(plan, receipts), executionOrigin: "local", localRunId: values["local-run-id"],
    localRunAttempt: attempt, runtimeSha: values["runtime-sha"], callerSha: values.revision };
  const dest = resolve(values.out);
  const parent = dirname(dest);
  await mkdir(parent, { recursive: true });
  // Reserve the destination atomically so concurrent publishers cannot replace one another.
  await mkdir(dest);
  try {
    await writeFile(join(dest, "index.json"), JSON.stringify(index, null, 2) + "\n", { flag: "wx" });
    await writeFile(join(dest, "case-plan.json"), planBytes, { flag: "wx" });
  } catch (error) {
    await rm(dest, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(JSON.stringify({ planned: index.planned, evaluated: index.evaluated,
    passed: index.passed, failed: index.failed, partial: index.partial, error: index.error,
    not_run: index.not_run, unreported: index.unreported }) + "\n");
}

try { await main(); }
catch (error) { process.stderr.write("local-results: " + error.message + "\n"); process.exitCode = 2; }
