import { expect, test } from "@playwright/test";
import { buildReportView } from "../src/reporting/view-builder.js";
import { assertReportViewSemantics } from "../src/reporting/view-validation.js";
import type { ReportSourceCollection } from "../src/reporting/source-collection.js";
import type { ReportRunInput } from "../src/reporting/run-source.js";
import type { ReportRun, ReportSource, ReportView } from "../src/reporting/types.js";

// An already-verified source boundary: test the independent aggregation and ordering rules.
function collection(): ReportSourceCollection {
  const runs = (["passed", "failed"] as const).map((outcome, index): ReportRunInput => {
    const key = "run:" + outcome + ":1";
    const source: ReportSource = { id: key, kind: "run", status: "verified", manifestSha256: "sha256:" + "a".repeat(64), eventHeadDigest: null, producerRevision: "a".repeat(40), targetRevision: null, classification: "internal" };
    const run: ReportRun = { key, sourceId: key, runId: outcome, attempt: 1, mode: "smoke", platform: "pc-web", executionMode: "fixture", outcome, terminationReason: "completed", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", durationMs: 1000, seed: index, producerVersion: "fixture", producerRevision: "a".repeat(40), targetRevision: null, acceptanceStatus: null, actionCount: index ? null : 2, plannedActionCount: 3, coverage: [] };
    return { source, run, metadata: {}, snapshot: { root: "unused", manifest: {}, manifestSha256: source.manifestSha256!, artifacts: [], snapshots: new Map(), verifiedArtifactBytes: 0, retainedTextBytes: 0 },
      rows: [{ id: key, sourceId: key, runKey: key, kind: "run", status: outcome, severity: null, title: outcome, message: "recorded result", at: run.endedAt, ruleId: null, relatedIds: [], evidenceIds: [] }],
      timeline: [{ id: key + ":event:2", sourceId: key, runKey: key, sequence: 2, at: run.startedAt, kind: "checkpoint", label: "checkpoint", relatedIds: [], evidenceIds: [] }, { id: key + ":event:1", sourceId: key, runKey: key, sequence: 1, at: run.endedAt, kind: "planned-action", label: "計画", relatedIds: [], evidenceIds: [] }, ...(!index ? [3, 4].map(sequence => ({ id: key + ":event:" + sequence, sourceId: key, runKey: key, sequence, at: run.endedAt, kind: "execution", label: "実行", relatedIds: [], evidenceIds: [] })) : [])], issues: [], mediaCandidates: [] };
  });
  return { runs, sessions: [], snapshots: [], explicitSourceCount: 2, explicitSourceIds: runs.map(input => input.source.id), duplicateSources: 1, textBytes: 0, artifactBytes: 0 };
}

const options = { reportId: "report-fixture", generatedAt: "2026-09-10T09:00:00+09:00", producerVersion: "fixture", profile: "local" as const, media: [], issues: [] };

test("report counts known actions separately from plans and sorts outcomes and source sequences deterministically", () => {
  const sources = collection();
  const view = buildReportView(sources, options);
  expect(view.counts).toMatchObject({ sources: 2, duplicateSources: 1, runs: 2, actions: 2, plannedActions: 6, unknownActionRuns: 1, events: 2, outcomes: { passed: 1, failed: 1, partial: 0, error: 0 } });
  expect(view.runs.map(run => run.outcome)).toEqual(["failed", "passed"]);
  expect(view.timeline.map(event => event.sequence)).toEqual([1, 2, 1, 2, 3, 4]);
  expect(view.inputSourceIds).toEqual(["run:failed:1", "run:passed:1"]);
  expect(view.generatedAt).toBe("2026-09-10T00:00:00.000Z");
  expect(view.generationStatus).toBe("degraded");
  expect(sources.runs.map(input => input.run?.outcome)).toEqual(["passed", "failed"]);
  expect(buildReportView({ ...sources, runs: [...sources.runs].reverse() }, options)).toEqual(view);
});

test("failed tests can have a ready report and oversized projections are rejected", () => {
  const sources = collection();
  for (const input of sources.runs) input.run!.actionCount = input.timeline.filter(event => event.kind === "execution").length;
  expect(buildReportView(sources, options).generationStatus).toBe("ready");
  sources.runs[0].rows[0].message = "x".repeat(16 * 1024 * 1024);
  expect(() => buildReportView(sources, options)).toThrow(/容量/);
});

test("saved report semantics reject inconsistent counts, identities, references, times and status", () => {
  const original = buildReportView(collection(), options);
  expect(() => assertReportViewSemantics(original)).not.toThrow();
  const mutations: Array<(view: ReportView) => void> = [
    view => { view.counts.actions += 1; },
    view => { view.counts.outcomes.failed = 0; },
    view => { view.inputSourceIds = ["missing"]; },
    view => { view.sources.push(view.sources[0]); },
    view => { view.timeline[0].sourceId = "missing"; },
    view => { view.rows[0].runKey = "missing"; },
    view => { view.rows[0].evidenceIds.push("missing"); },
    view => { view.runs[0].durationMs = 9; },
    view => { view.runs[0].startedAt = "2026-02-30T00:00:00.000Z"; },
    view => { view.generationStatus = "ready"; },
    view => { view.classification = "public"; },
    view => { view.runs[0].coverage.push({ name: "states", definition: "fixture", scope: view.runs[0].sourceId, status: "recorded", numerator: 0, denominator: 0, ratio: 0 }); },
    view => { view.media.push({ id: "media", sourceId: view.sources[0].id, runKey: null, kind: "screenshot", sequence: null, path: "assets/unlisted.png", classification: "internal", verification: "excluded", reason: "text-only", scope: "run", recordIds: [] }); view.counts.excludedMedia = 1; },
  ];
  for (const mutate of mutations) {
    const view = structuredClone(original);
    mutate(view);
    expect(() => assertReportViewSemantics(view)).toThrow();
  }
});
