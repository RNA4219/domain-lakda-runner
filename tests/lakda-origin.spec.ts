import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { assertExplorationCharter, assertExplorationReport, adaptiveConfigFromCharter, explorationDigest } from "../src/exploration/contracts.js";

const template = JSON.parse(readFileSync("examples/exploration-charter.playwright.json", "utf8"));
const origin = { tool: "manual-bb-test-harness", charterId: "CHARTER-001", revision: "r1", contentHash: "hash1", oracleRevision: "o1",
  questions: ["Can the user retry?"], traceTo: ["OBS-01"], basisRefs: ["AC-01"] };

test("optional origin validates, preserves exploration settings, and changes only evidence identity", () => {
  const original = structuredClone(template);
  const sourced = { ...structuredClone(template), origin };
  assertExplorationCharter(original);
  assertExplorationCharter(sourced);
  expect(adaptiveConfigFromCharter(sourced)).toEqual(adaptiveConfigFromCharter(original));
  expect(explorationDigest(sourced)).not.toEqual(explorationDigest(original));
});
test("unknown origin fields and secret questions fail before connection", () => {
  expect(() => assertExplorationCharter({ ...template, origin: { ...origin, forbidden: true } })).toThrow();
  expect(() => assertExplorationCharter({ ...template, origin: { ...origin, questions: ["api_key=very-private"] } })).toThrow();
});
test("report accepts matching charter identity with origin while retaining external Gate", () => {
  const report = { schemaVersion: "lakda/exploration-report/v1", sessionId: "s1", status: "completed",
    charterDigest: "sha256:" + "a".repeat(64), charterId: template.charterId, origin, platform: "pc-web",
    lane: "pc-web", targetRevision: "fixture-local", executionMode: "fixture",
    coverage: { actions: 0, states: 0, transitions: 0, unexplored: [] }, findings: [], blockers: [],
    capture: { screenshots: 0, videos: 0, sampledFrames: 0, failures: [] }, residualRisk: [],
    goNoGo: "external-qeg-required" };
  expect(() => assertExplorationReport(report)).not.toThrow();
});
