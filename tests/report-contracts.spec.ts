import { expect, test } from "@playwright/test";
import { assertReportSchema } from "../src/reporting/contracts.js";
import type { ReportView } from "../src/reporting/types.js";

function emptyView(): ReportView {
  return { schemaVersion: "lakda/report-view/v1", reportId: "report-fixture", generatedAt: "2026-09-10T00:00:00.000Z", producerVersion: "0.5.0-rc.1",
    profile: "local", generationStatus: "ready", classification: "internal", timeZone: "UTC", sources: [], inputSourceIds: [], runs: [], sessions: [], rows: [], timeline: [], media: [], issues: [],
    counts: { sources: 0, duplicateSources: 0, runs: 0, workerIncomplete: 0, failures: 0, warnings: 0, findings: 0, actions: 0, plannedActions: 0, unknownActionRuns: 0, events: 0, excludedMedia: 0, outcomes: { passed: 0, failed: 0, partial: 0, error: 0 } } };
}

test("report projection is versioned and rejects unknown fields at nested boundaries", () => {
  expect(() => assertReportSchema("view", emptyView())).not.toThrow();
  expect(() => assertReportSchema("view", { ...emptyView(), schemaVersion: "lakda/report-view/v99" })).toThrow();
  expect(() => assertReportSchema("view", { ...emptyView(), rawDom: "hidden" })).toThrow();
  const view = emptyView();
  view.rows.push({ id: "row", sourceId: "source", runKey: null, kind: "finding", status: "exploratory-finding", severity: "info", title: "finding", message: "text", at: null, ruleId: null, relatedIds: [], evidenceIds: [] });
  expect(() => assertReportSchema("view", view)).not.toThrow();
  expect(() => assertReportSchema("view", { ...view, rows: [{ ...view.rows[0], rawPrompt: "hidden" }] })).toThrow();
  view.sessions.push({ key: "session:fixture", sourceId: "session:fixture", sessionId: "fixture", status: "completed", technicalOutcome: "passed", terminationReason: "completed", startedAt: view.generatedAt, endedAt: view.generatedAt, durationMs: 0, activeDurationMs: null, platform: "pc-web", executionMode: "fixture", seed: 7, producerVersion: null, producerRevision: "a".repeat(40), targetRevision: "fixture-v1", acceptanceStatus: "fixture_only", actionCount: 0, runKeys: [] });
  expect(() => assertReportSchema("view", view)).not.toThrow();
  expect(() => assertReportSchema("view", { ...view, sessions: [{ ...view.sessions[0], gateVerdict: "go" }] })).toThrow();
});

test("optional step details retain legacy views and reject malformed or extra fields", () => {
  const view = emptyView();
  const event = { id: "event:1", sourceId: "source", runKey: null, sequence: 1, at: null, kind: "execution", label: "execution", relatedIds: [], evidenceIds: [] };
  const step = { operation: "click", target: "次へ", status: "executed", durationMs: 120, message: null };
  expect(() => assertReportSchema("view", { ...view, timeline: [event] })).not.toThrow();
  expect(() => assertReportSchema("view", { ...view, timeline: [{ ...event, step }] })).not.toThrow();
  for (const invalid of [{ ...step, durationMs: -1 }, { ...step, target: {} }, { ...step, rawInput: "hidden" }, { operation: "click" }]) {
    expect(() => assertReportSchema("view", { ...view, timeline: [{ ...event, step: invalid }] })).toThrow();
  }
});

test("bundle and media references reject absolute paths, traversal and executable URLs", () => {
  const view = emptyView();
  const media = { id: "media", sourceId: "source", runKey: null, kind: "screenshot", sequence: null, path: "assets/one.png", classification: "internal", verification: "pending", reason: "unverified-media", scope: "run", recordIds: [] };
  expect(() => assertReportSchema("view", { ...view, media: [media] })).not.toThrow();
  for (const path of ["../one.png", "/one.png", "assets/../one.png", "assets//one.png", "C:\\one.png", "javascript:alert(1)", "https://example.invalid/image"]) {
    expect(() => assertReportSchema("view", { ...view, media: [{ ...media, path }] }), path).toThrow();
  }
  const receipt = { schemaVersion: "lakda/report-receipt/v1", reportId: "report-fixture", generationStatus: "error", profile: "local", sourceIds: [], issues: [], output: null, startedAt: view.generatedAt, endedAt: view.generatedAt, producerVersion: view.producerVersion, manifestSha256: null, workDir: null };
  expect(() => assertReportSchema("receipt", receipt)).not.toThrow();
  expect(() => assertReportSchema("receipt", { ...receipt, output: "../outside/index.html" })).toThrow();
  const manifest = { schemaVersion: "lakda/report-bundle-manifest/v1", reportId: view.reportId, producerVersion: view.producerVersion, rendererVersion: "lakda/report-renderer/v1", policyVersion: "lakda/report-policy/v1", profile: view.profile, classification: view.classification, generatedAt: view.generatedAt, verification: { scope: "report-bundle-files", inputVerifiedAt: view.generatedAt }, sources: [], excludedMedia: [], files: [{ path: "index.html", size: 1, sha256: "sha256:" + "a".repeat(64) }], viewSha256: "sha256:" + "b".repeat(64) };
  expect(() => assertReportSchema("bundle-manifest", manifest)).not.toThrow();
  expect(() => assertReportSchema("bundle-manifest", { ...manifest, files: [{ ...manifest.files[0], size: -1 }] })).toThrow();
});
