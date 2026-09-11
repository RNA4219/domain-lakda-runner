import { expect, test } from "@playwright/test";
import { projectActionExecutions } from "../src/reporting/execution-history.js";
import { projectRunHistory } from "../src/reporting/run-history.js";

const schemaVersion = "lakda/adaptive-contracts/v1";
const candidate = { schemaVersion, candidateId: "next", adapterId: "playwright", targetRef: { targetId: "page-1", kind: "page" }, sourceFingerprint: "state-1", actionKind: "click", locatorRecipe: { strategy: "role", value: "button", name: "次へ" }, generatedBy: { ruleId: "fixture", observationId: "obs", reason: "visible" }, risk: { weight: 1 }, mutationKind: "none" };
const execution = { schemaVersion, executionId: "execution-1", candidateId: "next", preFingerprint: "state-1", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: {}, evidenceRefs: [] };
const oracle = { schemaVersion, oracleId: "next-page", oracleClass: "product", verdict: "fail", severity: "major", sourceRefs: [], requirementRefs: [], evidenceRefs: [], message: "次の画面が表示されません" };
const project = (trace: unknown[]) => projectRunHistory("run:fixture:1", "adaptive-explore", path => path === "adaptive/trace.json" ? { schemaVersion: "lakda/adaptive-trace/v1", seed: 7, trace } : undefined, []).timeline;

test("step details preserve recorded execution and oracle semantics without guessing missing values", () => {
  const history = project([{ type: "candidate", candidate }, { type: "execution", executionResult: execution }, { type: "oracle", result: oracle }, { type: "oracle", result: { ...oracle, verdict: "candidate" } }]);
  expect(history[1]).toMatchObject({ label: "execution", at: execution.startedAt, step: { operation: "click", target: "次へ", status: "executed", durationMs: 1000, message: null } });
  expect(history[2]).toMatchObject({ label: "oracle", step: { operation: "assert", target: "next-page", status: "fail", durationMs: null, message: oracle.message } });
  expect(history[3]).toMatchObject({ step: { status: "candidate" } });
  expect(project([{ type: "execution", executionResult: execution }])[0]).toMatchObject({ step: { operation: null, target: null, status: "executed" } });
});

test("ambiguous candidate descriptions do not assign an operation target to an execution", () => {
  const conflict = { ...candidate, locatorRecipe: { ...candidate.locatorRecipe, name: "別の操作" } };
  const history = project([{ type: "candidate", candidate }, { type: "candidate", candidate: conflict }, { type: "execution", executionResult: execution }]);
  expect(history[2]).toMatchObject({ step: { operation: null, target: null } });
  const future = project([{ type: "execution", executionResult: execution }, { type: "candidate", candidate }]);
  expect(future[0]).toMatchObject({ step: { operation: null, target: null } });
  const duplicate = project([{ type: "candidate", candidate }, { type: "candidate", candidate }, { type: "execution", executionResult: execution }]);
  expect(duplicate[2]).toMatchObject({ step: { operation: "click", target: "次へ" } });
});

test("ordinary step details expose recorded status and duration without copying private action inputs", () => {
  const records = { schemaVersion: "lakda/action-execution/v1", runId: "fixture", attempt: 1, executions: [{ sequence: 1, actionId: "next", kind: "fill", startedAt: execution.startedAt, endedAt: execution.endedAt, durationMs: 1000, status: "failed" }] };
  const history = projectActionExecutions("run:fixture:1", records, { actions: [{ id: "next", kind: "fill", locator: { testId: "private-locator" }, input: "private-input" }] });
  expect(history[0]).toMatchObject({ step: { operation: "fill", target: "next", status: "failed", durationMs: 1000, message: null } });
  expect(JSON.stringify(history)).not.toContain("private-");
});
