import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { runLakda } from "../src/core/runner.js";
import { loadReportRun } from "../src/reporting/run-source.js";
import { projectActionExecutions } from "../src/reporting/execution-history.js";
import { startFixture } from "./fixtures/server.js";

test("ordinary action execution records attempted actions without counting an unexecuted plan tail", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-report-execution-"));
  try {
    const actions = [{ id: "first", kind: "navigate" as const, path: "/" }, { id: "unexecuted", kind: "navigate" as const, path: "/" }];
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, actionCatalog: actions, profiles: { smoke: { actionIds: actions.map(action => action.id) } }, safety: { maxActionsPerMinute: 1 }, artifacts: { video: false } }));
    expect(result.outcome).toBe("partial"); expect(result.terminationReason).toBe("rate_limit");
    const runDir = dirname(result.actionSequencePath!);
    const record = JSON.parse(await readFile(join(runDir, "action-execution.json"), "utf8"));
    expect(record).toMatchObject({ schemaVersion: "lakda/action-execution/v1", runId: result.runId, attempt: result.attempt });
    expect(record.executions).toHaveLength(1);
    expect(record.executions[0]).toMatchObject({ sequence: 1, actionId: "first", kind: "navigate", status: "completed" });
    expect(record.executions[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(record.executions[0].startedAt).toMatch(/Z$/); expect(record.executions[0].endedAt).toMatch(/Z$/);
    expect(JSON.stringify(record)).not.toContain(fixture.baseUrl);
    const source = await loadReportRun(runDir);
    expect(source.run).toMatchObject({ actionCount: 1, plannedActionCount: 2 });
    expect(source.timeline.filter(event => event.kind === "execution")).toHaveLength(1);
    expect(source.issues.some(issue => issue.code === "execution-history-unavailable")).toBe(false);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("failed action attempts retain their status without copying locator or input values", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-report-execution-"));
  try {
    const actions = [{ id: "first", kind: "navigate" as const, path: "/" }, { id: "missing-field", kind: "fill" as const, locator: { testId: "private-locator-fixture" }, inputProfileId: "fixture-input" }, { id: "tail", kind: "navigate" as const, path: "/" }];
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, durationMs: 1000, actionCatalog: actions, profiles: { smoke: { actionIds: actions.map(action => action.id) } }, inputProfiles: { "fixture-input": "private-input-fixture" }, artifacts: { video: false } }));
    expect(result.outcome).toBe("failed");
    const runDir = dirname(result.actionSequencePath!);
    const bytes = await readFile(join(runDir, "action-execution.json"), "utf8");
    const record = JSON.parse(bytes);
    expect(record.executions.map((entry: { status: string }) => entry.status)).toEqual(["completed", "failed"]);
    expect(Object.keys(record.executions[1]).sort()).toEqual(["actionId", "durationMs", "endedAt", "kind", "sequence", "startedAt", "status"]);
    expect(bytes).not.toContain("private-locator-fixture"); expect(bytes).not.toContain("private-input-fixture");
    expect((await loadReportRun(runDir)).run).toMatchObject({ actionCount: 2, plannedActionCount: 3 });
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("execution history rejects contradictory identity, sequence, plan binding and extra data", () => {
  const entry = { sequence: 1, actionId: "first", kind: "navigate", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:00.010Z", durationMs: 10, status: "completed" };
  const original = { schemaVersion: "lakda/action-execution/v1", runId: "fixture", attempt: 1, executions: [entry] };
  const plan = { actions: [{ id: "first", kind: "navigate" }, { id: "second", kind: "navigate" }] };
  expect(projectActionExecutions("run:fixture:1", original, plan)).toHaveLength(1);
  const records = [
    { ...original, runId: "other" }, { ...original, schemaVersion: "unknown" },
    { ...original, executions: [{ ...entry, sequence: 2 }] },
    { ...original, executions: [{ ...entry, actionId: "second" }] },
    { ...original, executions: [{ ...entry, kind: "click" }] },
    { ...original, executions: [{ ...entry, startedAt: "2026-02-30T00:00:00.000Z" }] },
    { ...original, executions: [{ ...entry, input: "unexpected" }] },
    { ...original, executions: [{ ...entry, status: "failed" }, { ...entry, actionId: "second", sequence: 2 }] },
  ];
  for (const record of records) expect(() => projectActionExecutions("run:fixture:1", record, plan)).toThrow();
});
