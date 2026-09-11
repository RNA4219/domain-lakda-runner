import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "../src/core/redaction.js";
import { loadReportRun } from "../src/reporting/run-source.js";
import { reportTimestamp } from "../src/reporting/source-values.js";
import { projectRunHistory } from "../src/reporting/run-history.js";

test("report history accepts recorded operator events and rejects malformed control evidence", () => {
  const controls = [
    { type: "operator-control", command: "pause", requestId: "pause-1", reason: "operator-pause", actionCount: 0 },
    { type: "operator-bookmark", requestId: "bookmark-1", evidenceRefs: ["evidence-1"], actionCount: 0 },
    { type: "operator-bookmark-error", actionCount: 0, reason: "artifact-failure" },
    { type: "operator-control-error", reason: "invalid-control-file" },
  ];
  const project = (entries: unknown[]) => projectRunHistory("run-1", "adaptive-explore", ref => ref === "adaptive/trace.json" ? { schemaVersion: "lakda/adaptive-trace/v1", seed: 7, actions: 0, trace: entries } : undefined, []);
  const history = project(controls);
  expect(history.actionCount).toBe(0); expect(history.timeline.map(event => event.kind)).toEqual(controls.map(event => event.type));
  expect(history.timeline[0].label).toContain("pause");
  for (const invalid of [
    { ...controls[0], command: "execute" }, { ...controls[0], actionCount: -1 },
    { ...controls[0], arbitraryField: true }, { ...controls[1], evidenceRefs: [null] },
    { ...controls[2], reason: "invented" }, { ...controls[3], reason: "invented" },
    { type: "unrecognized-operation" },
  ]) expect(() => project([invalid])).toThrow();
});

async function fixture(root: string, mode = "smoke") {
  const metadata = { schemaVersion: "lakda/run-metadata/v1", runId: "fixture-run", attempt: 1, mode, seed: 4, outcome: "failed", terminationReason: "machine_failure", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", producerVersion: "0.5.0-rc.1", commitSha: "a".repeat(40) };
  const files = new Map<string, Buffer>([
    ["run-metadata.json", Buffer.from(JSON.stringify(metadata))],
    ["action-sequence.json", Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode, seed: 4, baseUrl: "http://fixture.invalid", actions: [{ id: "open", kind: "navigate", path: "/" }, { id: "missing", kind: "click" }, { id: "unused", kind: "fill", value: "raw-input-must-not-appear" }] }))],
    ["failure-report.json", Buffer.from(JSON.stringify({ failures: [{ failureId: "failure-1", ruleId: "UI-006", severity: "failure", message: 'password=hidden-value user@example.invalid <script>fixture</script>' }] }))],
    ["artifacts/failure.png", Buffer.from([0, 1, 2, 3])],
  ]);
  const manifest = { schema_version: "HATE/v1", run_id: metadata.runId, run_attempt: 1, commit_sha: metadata.commitSha, artifacts: [] as Record<string, unknown>[] };
  const save = async (restricted = false) => {
    manifest.artifacts = [];
    for (const [path, bytes] of files) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes);
      const binary = path.endsWith(".png");
      manifest.artifacts.push({ artifact_id: "lakda:" + manifest.artifacts.length, kind: binary ? "screenshot" : "report", path, sha256: "sha256:" + sha256(bytes), size_bytes: bytes.length, classification: restricted ? "restricted" : "internal", redaction_status: binary ? "pending" : "not_required", redaction_rule_version: "fixture/v1", safe_for_summary: !binary, public_exposure: "none", retention: {}, security_checks: { secrets_scan: binary ? "not_applicable" : "pass", pii_scan: binary ? "not_applicable" : "pass" } });
    }
    await mkdir(join(root, "exports"), { recursive: true });
    await writeFile(join(root, "exports/artifact-manifest.json"), JSON.stringify(manifest));
  };
  await save();
  return { metadata, manifest, files, save };
}

test("legacy plans across four modes retain unknown execution counts and sanitized failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-run-"));
  try {
    for (const mode of ["smoke", "seeded-random", "regression-replay", "llm-explore"]) {
      const run = join(root, mode);
      await fixture(run, mode);
      const before = await readFile(join(run, "exports/artifact-manifest.json"));
      const result = await loadReportRun(run);
      expect(result.run).toMatchObject({ outcome: "failed", actionCount: null, plannedActionCount: 3, targetRevision: null });
      expect(result.timeline).toHaveLength(3);
      expect(result.timeline.every(event => event.kind === "planned-action")).toBe(true);
      expect(result.issues.some(issue => issue.code === "execution-history-unavailable")).toBe(true);
      const projection = JSON.stringify({ source: result.source, run: result.run, rows: result.rows, timeline: result.timeline });
      expect(projection).not.toContain("raw-input-must-not-appear");
      expect(projection).not.toContain("hidden-value");
      expect(projection).not.toContain("user@example.invalid");
      expect(result.mediaCandidates).toHaveLength(1);
      expect(result.mediaCandidates[0].snapshot.bytes).toBeUndefined();
      expect(await readFile(join(run, "exports/artifact-manifest.json"))).toEqual(before);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run source rejects binding and artifact mismatches instead of dropping the failed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-run-"));
  try {
    const input = await fixture(root);
    input.manifest.run_attempt = 2;
    await input.save();
    await expect(loadReportRun(root)).rejects.toThrow(/binding/);
    input.manifest.run_attempt = 1;
    await input.save();
    await writeFile(join(root, "artifacts/failure.png"), Buffer.from([4, 3, 2, 1]));
    await expect(loadReportRun(root)).rejects.toThrow(/bytes\/hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restricted run projects only an opaque reference and the restriction reason", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-run-"));
  try {
    const input = await fixture(root);
    await input.save(true);
    const result = await loadReportRun(root);
    expect(result.run).toBeUndefined();
    expect(result.rows).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.source.status).toBe("restricted");
    expect(JSON.stringify(result.source)).not.toContain("fixture-run");
    expect(result.issues.some(issue => issue.code === "restricted-source")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("adaptive run preserves zero denominators as null ratios and rejects unknown graph versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-run-"));
  try {
    const input = await fixture(root, "adaptive-explore");
    const graph = { schemaVersion: "lakda/state-graph/v1", model: "discovered-model", revision: 0, nodes: [], edges: [], transitionPairs: [] };
    input.files.set("adaptive/transition-graph.json", Buffer.from(JSON.stringify(graph)));
    const metrics = Object.fromEntries(["state", "action", "transition", "transitionPair", "roundTrip", "obligation"].map(key => [key, { numerator: 0, denominator: 0, ratio: 0 }]));
    input.files.set("adaptive/coverage.json", Buffer.from(JSON.stringify({ schemaVersion: "lakda/coverage-report/v1", graphRevision: 0, stateCount: 0, transitionCount: 0, transitionPairCount: 0, roundTripCount: 0, ...metrics, stateCoverage: 0, actionCoverage: 0, transitionCoverage: 0, transitionPairCoverage: 0, roundTripCoverage: 0, obligationCoverage: 1 })));
    input.files.set("adaptive/trace.json", Buffer.from(JSON.stringify({ schemaVersion: "lakda/adaptive-trace/v1", seed: 4, actions: 0, trace: [], outcome: "failed", terminationReason: "machine_failure" })));
    await input.save();
    const result = await loadReportRun(root);
    expect(result.run?.actionCount).toBe(0);
    expect(result.run?.plannedActionCount).toBeNull();
    expect(result.run?.coverage).toHaveLength(6);
    expect(result.run?.coverage.every(metric => metric.numerator === 0 && metric.denominator === 0 && metric.ratio === null)).toBe(true);
    graph.schemaVersion = "lakda/state-graph/v99";
    input.files.set("adaptive/transition-graph.json", Buffer.from(JSON.stringify(graph)));
    await input.save();
    await expect(loadReportRun(root)).rejects.toThrow(/schemaVersion/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("report deduplicates matching failure IDs, rejects conflicts, and converts valid timestamps to UTC", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-run-"));
  try {
    const input = await fixture(root);
    input.metadata.startedAt = "2026-09-10T09:00:00+09:00";
    input.metadata.endedAt = "2026-09-10T09:00:01+09:00";
    input.files.set("run-metadata.json", Buffer.from(JSON.stringify(input.metadata)));
    const failure = { failureId: "same", ruleId: "UI-006", severity: "failure", message: "recorded failure" };
    input.files.set("failure-report.json", Buffer.from(JSON.stringify({ failures: Array.from({ length: 1001 }, () => failure) })));
    await input.save();
    const result = await loadReportRun(root);
    expect(result.rows.filter(row => row.kind === "failure")).toHaveLength(1);
    expect(result.run).toMatchObject({ startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", durationMs: 1000 });
    input.files.set("failure-report.json", Buffer.from(JSON.stringify({ failures: [failure, { ...failure, message: "conflicting failure" }] })));
    await input.save();
    await expect(loadReportRun(root)).rejects.toMatchObject({ issueCode: "conflicting-failure" });
    for (const value of ["2026-02-30T01:00:00Z", "2026-09-10T24:00:00Z", "September 10, 2026", "2026-09-10T12:00:00"]) expect(() => reportTimestamp(value)).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
