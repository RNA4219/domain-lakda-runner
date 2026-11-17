import { expect, test } from "@playwright/test";
import { summarizeTrend, type TrendRun } from "../src/runs/trend.js";

function run(outcome: TrendRun["outcome"], n: number, kind: TrendRun["evidenceKind"] = "real"): TrendRun {
  return { runRef: "run-" + n, scenarioId: "TC-001", caseRevision: "v1",
    environment: "staging", browser: "chromium", evidenceKind: kind,
    runId: "lakda:run-" + n, attempt: 1, outcome,
    startedAt: new Date(Date.UTC(2026, 10, 17, 0, 0, n)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 10, 17, 0, 0, n + 1)).toISOString(),
    durationMs: 1000, manifestSha256: "sha256:example-" + n };
}
test("pass/fail/pass is a flaky candidate with explicit denominator, not a Gate decision", () => {
  const inputs = [run("passed", 1), run("failed", 2), run("passed", 3), run("partial", 4)];
  const output = summarizeTrend(inputs);
  expect(output.gate).toBe("external-qeg-required");
  expect(output.series).toHaveLength(1);
  expect(output.series[0]).toMatchObject({ passed: 2, failed: 1, partial: 1, evaluated: 3, total: 4, flakyCandidate: true, successRate: 2 / 3 });
  expect(output.series[0].duration).toEqual({ count: 4, medianMs: 1000, p95Ms: null });
  expect(summarizeTrend([...inputs].reverse())).toEqual(output);
});
test("fixture/emulator cannot inflate real result series", () => {
  const values = [run("passed", 1, "fixture"), run("passed", 2, "emulator"), run("failed", 3, "real")];
  const output = summarizeTrend(values);
  expect(output.series).toHaveLength(3);
  expect(output.series.find(x => x.evidenceKind === "real")?.successRate).toBe(0);
});
test("P95 is not calculated without twenty duration samples", () => {
  expect(summarizeTrend(Array.from({ length: 19 }, (_, n) => run("passed", n))).series[0].duration.p95Ms).toBeNull();
  expect(summarizeTrend(Array.from({ length: 20 }, (_, n) => run("passed", n))).series[0].duration.p95Ms).toBe(1000);
});
