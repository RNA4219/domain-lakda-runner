import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadConfig } from "../src/core/config.js";
import { runLakda } from "../src/core/runner.js";
import { startFixture } from "./fixtures/server.js";

const list = { testId: "list" }, item = { testId: "item" };
for (const [target, outcome] of [["shipping-answer", "passed"], ["shipping-question", "failed"]] as const) {
  test(`配送の詳細を閉じた直後の hidden: ${target} → ${outcome}`, async () => {
    const body = await readFile("examples/e2e-platform/site/index.html", "utf8");
    const fixture = await startFixture(() => ({ contentType: "text/html; charset=utf-8", body }));
    try {
      const outputDir = test.info().outputPath();
      const plan = join(outputDir, "plan.json");
      const question = { testId: "shipping-question" };
      await writeFile(plan, JSON.stringify({
        schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl,
        actions: [{ id: "visit", kind: "navigate", path: "/" }, { id: "open", kind: "click", locator: question },
          { id: "close", kind: "click", locator: question }],
      }));
      const config = loadConfig(undefined, { outputDir, mode: "regression-replay", baseUrl: fixture.baseUrl,
        reviewedE2E: true, reviewedOracleVersion: 2, obligations: [
          { afterActionId: "open", acceptanceRef: "AC-open", visible: { testId: "shipping-answer" } },
          { afterActionId: "close", acceptanceRef: "AC-close", hidden: { testId: target } },
        ] });
      const result = await runLakda(config, plan);
      expect(result.outcome).toBe(outcome);
      if (outcome === "failed") {
        expect(result.terminationReason).toBe("obligations_unmet");
        expect(result.failures).toContainEqual(expect.objectContaining({ ruleId: "UI-009" }));
      }
      const log = await readFile(join(dirname(result.actionSequencePath!), "console.jsonl"), "utf8");
      const checks = log.trim().split("\n").map(line => JSON.parse(line))
        .filter(row => row.source === "reviewed-oracle").map(row => JSON.parse(row.message));
      expect(checks).toEqual([
        { index: 1, acceptanceRef: "AC-open", actionId: "open", result: "passed" },
        { index: 2, acceptanceRef: "AC-close", actionId: "close", result: outcome },
      ]);
    } finally { await fixture.close(); }
  });
}

test("hidden は受入条件を持つ reviewed V2 判定として検証する", () => {
  const config = { mode: "regression-replay", reviewedE2E: true, reviewedOracleVersion: 2 } as const;
  const hidden = { testId: "shipping-answer" };
  const reviewed = { hidden, acceptanceRef: "AC-close" };
  expect(() => loadConfig(undefined, { ...config, obligations: [reviewed] })).not.toThrow();
  expect(() => loadConfig(undefined, { ...config, reviewedOracleVersion: undefined, obligations: [reviewed] })).toThrow();
  expect(() => loadConfig(undefined, { ...config, obligations: [{ hidden }] })).toThrow();
  expect(() => loadConfig(undefined, { ...config, obligations: [{ ...reviewed, visible: hidden }] })).toThrow();
});

test("V02 evaluates amounts and action-bound count delta with normalized evidence", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html; charset=utf-8", body: `<div data-testid="amount">$9.00</div><div data-testid="list"><span data-testid="item"></span></div><button data-testid="add" onclick="document.querySelector('[data-testid=list]').insertAdjacentHTML('beforeend','<span data-testid=item></span>')">Add</button>` }));
  try {
    const outputDir = test.info().outputPath(); const plan = join(outputDir, "plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }, { id: "add", kind: "click", locator: { testId: "add" } }] }));
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay", reviewedE2E: true, reviewedOracleVersion: 2, obligations: [
      { afterActionId: "add", acceptanceRef: "AC-1", countDelta: { locator: list, itemLocator: item, value: 1 } },
      { acceptanceRef: "AC-2", amountEquals: { locator: { testId: "amount" }, currency: "USD", format: "usd-dollar-prefix", minorUnits: 900 } },
    ] });
    const result = await runLakda(config, plan);
    expect(result.outcome).toBe("passed");
    const dir = dirname(result.actionSequencePath!);
    const logs = (await readFile(join(dir, "console.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(row => row.source === "reviewed-oracle").map(row => JSON.parse(row.message));
    expect(logs).toEqual([{ index: 1, acceptanceRef: "AC-1", actionId: "add", before: 1, observed: 2, result: "passed" }, { index: 2, acceptanceRef: "AC-2", observed: 900, result: "passed" }]);
  } finally { await fixture.close(); }
});

test("V02 requires version and rejects ambiguous target before executing", async () => {
  expect(() => loadConfig(undefined, { mode: "regression-replay", reviewedE2E: true, obligations: [{ acceptanceRef: "AC", countEquals: { locator: list, itemLocator: item, value: 0 } }] })).toThrow();
  const fixture = await startFixture();
  try {
    const outputDir = test.info().outputPath(); const plan = join(outputDir, "plan.json");
    const action = { id: "open", kind: "navigate", path: "/" };
    await writeFile(plan, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl, actions: [action, action] }));
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay", reviewedE2E: true, reviewedOracleVersion: 2, obligations: [{ afterActionId: "open", acceptanceRef: "AC", visible: list }] }), plan);
    expect(result).toMatchObject({ outcome: "error", terminationReason: "executor_error" });
    expect(await readFile(result.actionSequencePath!, "utf8")).toBeTruthy();
  } finally { await fixture.close(); }
});


test("missing delta baseline stops before the associated action", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<button data-testid="add">Add</button>' }));
  try {
    const outputDir = test.info().outputPath(); const plan = join(outputDir, "plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }, { id: "add", kind: "click", locator: { testId: "add" } }] }));
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay", reviewedE2E: true, reviewedOracleVersion: 2, obligations: [{ afterActionId: "add", acceptanceRef: "AC-1", countDelta: { locator: list, itemLocator: item, value: 1 } }] }), plan);
    expect(result).toMatchObject({ outcome: "failed", terminationReason: "obligations_unmet" });
    expect(result.failures).toContainEqual(expect.objectContaining({ ruleId: "UI-009" }));
    const dir = dirname(result.actionSequencePath!);
    const logs = (await readFile(join(dir, "console.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(row => row.source === "reviewed-oracle").map(row => JSON.parse(row.message));
    expect(logs).toEqual([{ index: 1, acceptanceRef: "AC-1", actionId: "add", before: null, observed: null, result: "failed" }]);
    const metadata = JSON.parse(await readFile(join(dir, "action-execution.json"), "utf8"));
    expect(JSON.stringify(metadata.executions)).not.toContain('"actionId":"add"');
  } finally { await fixture.close(); }
});



test("V02 mismatches report UI-009 and normalized observation", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html; charset=utf-8", body: '<span data-testid="amount">901円</span>' }));
  try {
    const outputDir = test.info().outputPath(); const plan = join(outputDir, "plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay", reviewedE2E: true, reviewedOracleVersion: 2, obligations: [{ acceptanceRef: "AC-2", amountEquals: { locator: { testId: "amount" }, currency: "JPY", format: "jpy-yen-suffix", minorUnits: 900 } }] }), plan);
    expect(result).toMatchObject({ outcome: "failed", terminationReason: "obligations_unmet" });
    expect(result.failures).toContainEqual(expect.objectContaining({ ruleId: "UI-009" }));
    const logs = (await readFile(join(dirname(result.actionSequencePath!), "console.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(row => row.source === "reviewed-oracle").map(row => JSON.parse(row.message));
    expect(logs).toEqual([{ index: 1, acceptanceRef: "AC-2", observed: 901, result: "failed" }]);
  } finally { await fixture.close(); }
});


test("legacy reviewed replay continues actions after an earlier machine failure", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<script>console.error("fixture failure")</script><button data-testid="next">Next</button><span data-testid="done">ok</span>' }));
  try {
    const outputDir = test.info().outputPath(); const plan = join(outputDir, "plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }, { id: "next", kind: "click", locator: { testId: "next" } }] }));
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay", reviewedE2E: true, obligations: [{ visible: { testId: "done" } }] }), plan);
    expect(result).toMatchObject({ outcome: "failed", terminationReason: "machine_failure" });
    const executions = JSON.parse(await readFile(join(dirname(result.actionSequencePath!), "action-execution.json"), "utf8")).executions;
    expect(executions.map((entry: { actionId: string }) => entry.actionId)).toEqual(["open", "next"]);
  } finally { await fixture.close(); }
});

test("multiple intermediate checks preserve order and legacy observations are omitted", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<span data-testid="done">ok</span><div data-testid="list"></div>' }));
  try {
    const outputDir = test.info().outputPath(); const plan = join(outputDir, "plan.json");
    await writeFile(plan, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay", reviewedE2E: true, reviewedOracleVersion: 2, obligations: [{ afterActionId: "open", acceptanceRef: "AC-1", visible: { testId: "done" } }, { afterActionId: "open", acceptanceRef: "AC-2", countEquals: { locator: list, itemLocator: item, value: 0 } }] }), plan);
    expect(result.outcome).toBe("passed");
    const logs = (await readFile(join(dirname(result.actionSequencePath!), "console.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(row => row.source === "reviewed-oracle").map(row => JSON.parse(row.message));
    expect(logs).toEqual([{ index: 1, acceptanceRef: "AC-1", actionId: "open", result: "passed" }, { index: 2, acceptanceRef: "AC-2", actionId: "open", observed: 0, result: "passed" }]);
  } finally { await fixture.close(); }
});
