import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { expect, test } from "@playwright/test";
import { configFromJson } from "../dist/core/config.js";
import { runLakda } from "../dist/core/runner.js";
import { readCaseReview, writeCasePage } from "../scripts/e2e-case-review.mjs";
import { buildRecordingPlan } from "../scripts/e2e-recording-plan.mjs";

// 動画の符号化だけを置き換える。操作、判定、実行時刻、ログは Chromium の実行記録を使う。
async function fixtureEncoder({ outputPath, viewport, fps, durationMs }) {
  const bytes = Buffer.from("fixture-video");
  await writeFile(outputPath, bytes, { flag: "wx" });
  return { ...viewport, fps, durationMs, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

test("閉じた後も回答が残る配送画面を再生し、結果画面で開閉の合否を区別する", async ({ page }, info) => {
  const fixture = resolve("examples/e2e-platform/shipping-close-failure");
  const exportsDir = join(fixture, "exports");
  const caseDir = join(exportsDir, "TC-SHIPPING-CLOSE");
  const input = join(caseDir, "action-sequence.json");
  const { baseUrl } = JSON.parse(await readFile(input, "utf8"));
  expect(baseUrl).toBe("http://127.0.0.1:18943/");
  const plan = await buildRecordingPlan(exportsDir, baseUrl);
  const configBytes = await readFile(join(caseDir, "lakda.config.json"));
  const config = configFromJson(JSON.parse(configBytes), { baseUrl, outputDir: info.outputPath("runs") });

  const html = await readFile(join(fixture, "index.html"));
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html));
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(baseUrl).port), "127.0.0.1", resolveListen);
  });
  try {
    await page.goto(baseUrl);
    const details = page.locator("details");
    const question = page.getByTestId("shipping-question");
    const answer = page.getByTestId("shipping-answer");
    await expect(details).toHaveJSProperty("open", false);
    await expect(answer).toHaveCount(1);
    await expect(answer).toBeHidden();
    await question.click();
    await expect(details).toHaveJSProperty("open", true);
    await expect(answer).toBeVisible();
    await question.click();
    await expect(details).toHaveJSProperty("open", false);
    await expect(answer).toBeVisible();

    const result = await runLakda(config, input, { platformRecording: {
      plan: { ...plan.cases[0], policyVersion: plan.policyVersion }, configBytes, process: fixtureEncoder,
    } });
    expect(result).toMatchObject({ outcome: "failed", terminationReason: "obligations_unmet", exitCode: 2 });
    expect(result.failures.map(failure => failure.ruleId)).toEqual(["UI-009"]);

    const output = info.outputPath("case.html");
    const report = await readCaseReview({ "case-dir": caseDir, run: [dirname(result.actionSequencePath)], out: output });
    expect(report.run.actions.map(action => [action.actionId, action.status])).toEqual([
      ["visit", "completed"], ["open", "completed"], ["close", "completed"],
    ]);
    expect(report.run.observations.map(check => [check.index, check.result])).toEqual([[1, "passed"], [2, "failed"]]);
    await writeCasePage(report, { name: "配送案内", title: "配送日数の質問を開閉する", attempt: 1, criteria: report.review.expectedResults });

    await page.goto(pathToFileURL(output).href);
    await expect(page.locator("#status")).toHaveText("不合格");
    await expect(page.locator("#headline")).toContainText(report.review.expectedResults[1]);
    const rows = page.locator("#checks .row");
    await expect(rows.locator("strong")).toHaveText(report.review.expectedResults);
    await expect(rows.nth(0).locator("dd")).toHaveText([
      "「注文してから何日で届きますか？」を押す", "testId: shipping-answer", "表示される", "合格・条件を満たした",
    ]);
    await expect(rows.nth(1).locator("dd")).toHaveText([
      "同じ質問をもう一度押す", "testId: shipping-answer", "非表示になる", "不合格・観測値の記載なし",
    ]);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
