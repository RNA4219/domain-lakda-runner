import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExplorationCharter } from "../src/exploration/contracts.js";
import { appendSessionEvent, buildExplorationReport, buildSessionHateManifest, createExplorationSession, verifyExplorationSessionSnapshot, writeFinding } from "../src/exploration/session.js";
import { loadReportSessionSnapshot } from "../src/reporting/session-snapshot.js";
import { readSessionFindings, readSessionRunReferences } from "../src/reporting/session-records.js";
import { projectReportSession } from "../src/reporting/session-source.js";
import { loadReportSourceCollection } from "../src/reporting/source-collection.js";
import { verifyReportSourcesUnchanged } from "../src/reporting/source-verifier.js";

const charter: ExplorationCharter = {
  schemaVersion: "lakda/exploration-charter/v1", charterId: "report-session-fixture", targetRevision: "fixture-v1", platform: "pc-web", executionMode: "fixture", adapter: { id: "playwright" }, baseUrl: "http://127.0.0.1:3300", persona: "guest", scope: { allowHosts: ["127.0.0.1"] }, budget: { durationMs: 1000, maxActions: 2, maxActionsPerMinute: 10 }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" }, capture: { video: "off", screenshot: "finding-non-pass-bookmark", sampledFrames: { enabled: false, intervalMs: 1000, maxFrames: 2, maxBytes: 1000, source: "playwright", stopTimeoutMs: 1000 } }, templateCorpusVersion: "none", seed: 7,
};

test("session report verification checks the event chain and projection without repairing stored data", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-session-"));
  try {
    const created = await createExplorationSession(charter, { seed: 7 }, root);
    await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
    const paused = await appendSessionEvent(created.paths, { type: "session-paused", status: "paused" });
    const raw = await readFile(created.paths.events, "utf8");
    const before = await readFile(created.paths.session);
    const result = verifyExplorationSessionSnapshot(paused, raw);
    expect(result.session).toEqual(paused);
    expect(result.events).toHaveLength(3);
    expect(() => verifyExplorationSessionSnapshot({ ...paused, runIds: ["invented-run"] }, raw)).toThrow(/projection/);
    const events = raw.trim().split("\n").map(line => JSON.parse(line));
    events[0].payload = { changed: true };
    expect(() => verifyExplorationSessionSnapshot(paused, events.map(event => JSON.stringify(event)).join("\n"))).toThrow(/digest/);
    expect(await readFile(created.paths.session)).toEqual(before);
    await appendSessionEvent(created.paths, { type: "session-resumed", status: "running" });
    const advancedRaw = await readFile(created.paths.events, "utf8");
    const advancedBefore = await readFile(created.paths.session);
    expect(() => verifyExplorationSessionSnapshot(paused, advancedRaw)).toThrow(/未確定/);
    expect(await readFile(created.paths.session)).toEqual(advancedBefore);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("session findings deduplicate identical IDs and reject conflicting or unbound records", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-session-"));
  try {
    const input = await finalizedSession(root);
    const finding = { schemaVersion: "lakda/exploration-finding/v1" as const, findingId: "finding-1", sessionId: input.session.sessionId, platform: charter.platform, kind: "freeze" as const, status: "exploratory-finding" as const, severity: "warning" as const, message: "画面変化が観測されませんでした", observedAt: "2026-09-10T00:00:00Z", targetRevision: charter.targetRevision, oracleRefs: ["freeze"], evidenceRefs: [], requirementRefs: [] };
    await writeFinding(input.paths, finding);
    await writeFinding(input.paths, finding);
    await buildExplorationReport(input.paths);
    let snapshot = await loadReportSessionSnapshot(input.paths.root);
    expect(readSessionFindings(snapshot)).toEqual([finding]);
    expect(readSessionRunReferences(snapshot)).toEqual([]);
    await writeFinding(input.paths, { ...finding, message: "同じIDで異なる内容" });
    await buildExplorationReport(input.paths);
    snapshot = await loadReportSessionSnapshot(input.paths.root);
    expect(() => readSessionFindings(snapshot)).toThrow(/競合/);
    const missing = { ...snapshot, session: { ...snapshot.session, runIds: ["missing-run"] } };
    expect(() => readSessionRunReferences(missing)).toThrow(/参照/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function finalizedSession(root: string, status: "paused" | "aborted" | "completed" = "paused") {
  const created = await createExplorationSession(charter, { seed: 7 }, root);
  if (status !== "aborted") await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
  const session = await appendSessionEvent(created.paths, { type: status === "paused" ? "session-paused" : status === "aborted" ? "session-aborted" : "session-completed", status });
  const report = await buildExplorationReport(created.paths);
  return { ...created, session, report };
}

test("report reads finalized and preflight-aborted sessions without rewriting evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-session-"));
  try {
    for (const status of ["paused", "aborted", "completed"] as const) {
      const input = await finalizedSession(root, status);
      const before = await readFile(input.paths.hateManifest);
      const result = await loadReportSessionSnapshot(input.paths.root);
      expect(result.session.status).toBe(status);
      expect(result.session.runIds).toEqual([]);
      expect(result.report.acceptanceStatus).toBe("fixture_only");
      expect(result.events).toHaveLength(status === "aborted" ? 2 : 3);
      expect(await readFile(input.paths.hateManifest)).toEqual(before);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("report refuses a running or locked session instead of waiting or repairing", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-session-"));
  try {
    const input = await finalizedSession(root);
    await mkdir(input.paths.lock);
    await expect(loadReportSessionSnapshot(input.paths.root)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    await rmdir(input.paths.lock); // Only this test-created empty lock directory.
    await appendSessionEvent(input.paths, { type: "session-resumed", status: "running" });
    await buildExplorationReport(input.paths);
    await expect(loadReportSessionSnapshot(input.paths.root)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("session report binding rejects a rehashed report from another target or state", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-session-"));
  try {
    const input = await finalizedSession(root);
    for (const change of [{ targetRevision: "another-target" }, { sessionStatus: "completed" }, { executionMode: "real" }, { runIds: ["invented-run"] }]) {
      await writeFile(input.paths.report, JSON.stringify({ ...input.report, ...change }));
      await buildSessionHateManifest(input.paths, input.session);
      await expect(loadReportSessionSnapshot(input.paths.root)).rejects.toMatchObject({ issueCode: "session-binding-mismatch" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("session projection keeps session state and technical outcome separate and hides restricted contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-session-"));
  try {
    const input = await finalizedSession(root, "aborted");
    const raw = await loadReportSessionSnapshot(input.paths.root);
    const result = projectReportSession(raw);
    expect(result.summary).toMatchObject({ status: "aborted", technicalOutcome: null, actionCount: 0, executionMode: "fixture", acceptanceStatus: "fixture_only" });
    expect(result.timeline.map(event => event.sequence)).toEqual([1, 2]);
    expect(result.timeline.every(event => event.at?.endsWith("Z"))).toBe(true);
    const restricted = projectReportSession({ ...raw, classification: "restricted" });
    expect(restricted.summary).toBeUndefined();
    expect(restricted.rows).toEqual([]);
    expect(restricted.timeline).toEqual([]);
    expect(restricted.source).toMatchObject({ status: "restricted", producerRevision: null, targetRevision: null });
    expect(JSON.stringify(restricted.source)).not.toContain(input.session.sessionId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the final source check detects a resumed session without changing the earlier snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-session-"));
  try {
    const input = await finalizedSession(root);
    const collection = await loadReportSourceCollection({ entries: [{ kind: "session", root: input.paths.root }], duplicatePaths: 0, indexBytes: 0 });
    await expect(verifyReportSourcesUnchanged(collection)).resolves.toBeUndefined();
    await appendSessionEvent(input.paths, { type: "session-resumed", status: "running" });
    const resumed = await readFile(input.paths.session);
    await expect(verifyReportSourcesUnchanged(collection)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    expect(await readFile(input.paths.session)).toEqual(resumed);
    const abort = new AbortController();
    abort.abort(new Error("report cancelled"));
    await expect(verifyReportSourcesUnchanged(collection, abort.signal)).rejects.toThrow("report cancelled");
  } finally { await rm(root, { recursive: true, force: true }); }
});
