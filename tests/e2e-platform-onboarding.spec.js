import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { aggregate, discover } from "../scripts/e2e-ci-results.mjs";
import { projectCaseChecks, writeCasePage } from "../scripts/e2e-case-review.mjs";
import { toObligation } from "../scripts/e2e-reviewed-checks.mjs";
import { openExecution } from "../scripts/local-console/execution.mjs";

const exec = promisify(execFile);
const sample = resolve("examples/e2e-platform");
const cli = resolve("scripts/e2e-local-console.mjs");
const read = async file => JSON.parse(await readFile(file, "utf8"));

test("初期設定は新規ファイルにだけ書き込み、再実行で製品の設定を上書きしない", async () => {
  const info = test.info();
  const path = info.outputPath("product", "platform.json");
  await exec(process.execPath, [cli, "--init", path]);
  expect(await read(path)).toEqual(await read(join(sample, "product.config.json")));
  await writeFile(path, "製品で編集した設定");
  await expect(exec(process.execPath, [cli, "--init", path])).rejects.toThrow(/既に存在/);
  expect(await readFile(path, "utf8")).toBe("製品で編集した設定");
});

test("過去の索引がなくてもレビュー済みの受入条件で第1回を予定し、開始前に結果を作らない", async () => {
  const info = test.info();
  const config = await read(join(sample, "demo.json"));
  const revision = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
  config.store = info.outputPath("history");
  config.target.binding = info.outputPath("build-binding.json");
  await mkdir(dirname(config.target.binding), { recursive: true });
  await writeFile(config.target.binding, JSON.stringify({
    bindingVersion: "qeg-build/v1",
    target: { projectId: "shipping-demo", revision, environmentId: "local-fixture" },
  }));
  const app = await openExecution(config, sample);
  const [suite] = app.catalog().suites;
  expect(suite).toMatchObject({ next: 1, latest: null, cases: [{ criteria: ["配送日数の目安が表示される"] }] });
  expect(app.view()).toBeNull();
  expect(await readdir(join(config.store, suite.id))).toEqual([]);
  config.suites[0].featureSpec = info.outputPath("different-feature.json");
  await writeFile(config.suites[0].featureSpec, "{}");
  await expect(openExecution(config, sample)).rejects.toThrow(/仕様書がレビュー時の版と一致/);
});

test("従来の sources から既存の第3回とレビュー版を照合し、第4回を予定する", async () => {
  const info = test.info();
  const config = await read(join(sample, "demo.json"));
  const [suite] = config.suites;
  const cwd = resolve(sample, suite.checkout);
  const revision = (await exec("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
  const plan = await discover(cwd, suite.scenarios, config.baseUrl, "local-fixture");
  const index = { ...aggregate(plan, []), executionOrigin: "local", localRunId: suite.id,
    localRunAttempt: 3, runtimeSha: revision, callerSha: revision };
  const record = { index: "index.json", qegDir: "qeg", caseDir: join(cwd, suite.scenarios, plan.cases[0].id),
    manualCaseSet: join(sample, suite.manualCaseSet), featureSpec: join(sample, suite.featureSpec), suiteName: suite.name };
  await mkdir(info.outputPath("qeg"), { recursive: true });
  await writeFile(info.outputPath("index.json"), JSON.stringify(index));
  config.sources = info.outputPath("sources.json");
  config.store = info.outputPath("history");
  config.suites = [{ id: suite.id, checkout: suite.checkout, scenarios: suite.scenarios }];
  await writeFile(config.sources, JSON.stringify({
    overview: { productId: "shipping-demo", name: "配送案内", revision, environment: "local-fixture" }, records: [record],
  }));
  const app = await openExecution(config, sample);
  expect(app.catalog().suites[0]).toMatchObject({ name: suite.name, next: 4 });
  expect(app.view()).toMatch(/^view-/);
  index.cases[0].reviewSha256 = "0".repeat(64);
  await writeFile(info.outputPath("index.json"), JSON.stringify(index));
  await expect(openExecution(config, sample)).rejects.toThrow(/保存時の版と異なります/);
});

test("ケース画面の各判定に操作・対象・期待値と選択した回の結果が表示される", async ({ page }, info) => {
  const review = await read(join(sample, "exports/TC-SHIPPING/scenario.json"));
  review.expectedResults = ["質問を開くと回答が表示される", "質問を閉じると回答が非表示になる", "配送案内に戻るボタンが表示される"];
  review.machineChecks = [
    { kind: "visible", locator: { testId: "shipping-answer" }, afterActionId: "open", acceptanceRef: "AC-OPEN" },
    { kind: "hidden", locator: { testId: "shipping-answer" }, afterActionId: "close", acceptanceRef: "AC-CLOSE" },
    { kind: "visible", locator: { role: "button", name: "配送案内に戻る" }, acceptanceRef: "AC-RETURN" },
  ];
  const checks = projectCaseChecks(review.machineChecks.map(toObligation), review, true);
  const run = {
    runId: "review-1", attempt: 1, startedAt: "2026-11-26T00:00:00Z", outcome: "passed", reason: "completed",
    actions: [{ actionId: "open", sequence: 1, status: "completed", offsetMs: 0 },
      { actionId: "close", sequence: 2, status: "completed", offsetMs: 100 }], video: { allowed: false },
    observations: [{ index: 1, result: "passed" }, { index: 2, result: "passed" }, { index: 3, result: "passed" }],
  };
  const model = {
    ...review, ac: ["AC-OPEN", "AC-CLOSE", "AC-RETURN"], actions: ["open", "close"], checks,
    actionLabels: { open: "配送日数の質問を開く", close: "配送日数の質問を閉じる" },
    runs: [run, { ...run, runId: "review-2", attempt: 2, outcome: "failed", reason: "obligations_unmet",
      observations: [{ index: 1, result: "passed" }, { index: 2, result: "failed" }] }],
  };
  const output = info.outputPath("case.html");
  await writeCasePage({ output, model });
  const url = "http://127.0.0.1/case.html";
  await page.route(url, route => route.fulfill({ path: output }));
  await page.goto(url);

  const rows = page.locator("#checks .row");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator("strong")).toHaveText(review.expectedResults);
  await expect(rows.first().locator("dd")).toHaveText([
    "配送日数の質問を開く", "testId: shipping-answer", "表示される", "合格・条件を満たした",
  ]);
  await expect(rows.nth(1).locator("dd")).toHaveText([
    "配送日数の質問を閉じる", "testId: shipping-answer", "非表示になる", "合格・条件を満たした",
  ]);
  await expect(rows.last().locator("dd")).toHaveText([
    "全操作後", "button「配送案内に戻る」", "表示される", "合格・条件を満たした",
  ]);
  await page.locator("#pick").selectOption("1");
  await expect(rows.first().locator("dd").last()).toHaveText("合格・条件を満たした");
  await expect(rows.nth(1).locator("dd").last()).toHaveText("不合格・観測値の記載なし");
  await expect(rows.last().locator("dd").last()).toHaveText("判定記録なし");
});

test("期待文を対応する判定だけに結び付け、判断依頼には照合の詳細を加えない", () => {
  const check = { kind: "visible", locator: { testId: "shipping-answer" } };
  const review = { expectedResults: ["配送日数の目安が表示される"], machineChecks: [check] };
  const [differentTarget] = projectCaseChecks([{ visible: { testId: "shipping-question" } }], review, true);
  expect(differentTarget.reviewText).toBeUndefined();
  expect(differentTarget.targetLabel).toBe("testId: shipping-question");
  const [decision] = projectCaseChecks([toObligation(check)], review, false);
  expect(decision).not.toHaveProperty("reviewText");
  expect(decision).not.toHaveProperty("targetLabel");
});
