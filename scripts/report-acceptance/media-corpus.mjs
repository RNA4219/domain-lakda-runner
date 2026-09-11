import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const version = "lakda/adaptive-contracts/v1";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value));
const reference = (id, path, bytes) => ({ schemaVersion: version, artifactId: id, path, sha256: sha256(bytes), size: bytes.length, classification: "internal", redactionStatus: "redacted", securityStatus: "pass" });
const oracle = (id, ref) => ({ schemaVersion: version, oracleId: id, oracleClass: "generic", verdict: "candidate", severity: "warning", sourceRefs: [], requirementRefs: [], evidenceRefs: [ref], message: "人工媒体の参照確認" });
const bookmark = { type: "operator-bookmark", requestId: "unlinked", evidenceRefs: [], actionCount: 0 };

async function run(root, runId, media, trace, oracles) {
  const runDir = join(root, runId); await mkdir(runDir);
  const metadata = { schemaVersion: "lakda/run-metadata/v1", runId, attempt: 1, mode: "adaptive-explore", seed: 7, outcome: "failed", terminationReason: "machine_failure", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", producerVersion: "artificial-media-fixture", commitSha: "a".repeat(40) };
  const files = new Map([
    ["run-metadata.json", json(metadata)], ["failure-report.json", json({ failures: [] })],
    ["adaptive/trace.json", json({ schemaVersion: "lakda/adaptive-trace/v1", seed: 7, actions: 0, trace })],
    ["adaptive/oracle-results.jsonl", Buffer.from(oracles.map(item => JSON.stringify(item)).join("\n") + "\n")], ...media,
  ]);
  const artifacts = [];
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(runDir, path)), { recursive: true });
    await writeFile(join(runDir, path), bytes, { flag: "wx" });
    artifacts.push({ artifact_id: "lakda:file-" + artifacts.length, kind: path.endsWith(".png") ? "screenshot" : path.endsWith(".webm") ? "video" : path.endsWith(".zip") ? "trace" : "report", path, sha256: "sha256:" + sha256(bytes), size_bytes: bytes.length, classification: "internal", redaction_status: "redacted", redaction_rule_version: "artificial-fixture/v1", safe_for_summary: true, public_exposure: "none", retention: {}, security_checks: { secrets_scan: "pass", pii_scan: "pass" } });
  }
  await mkdir(join(runDir, "exports"));
  await writeFile(join(runDir, "exports/artifact-manifest.json"), json({ schema_version: "HATE/v1", run_id: runId, run_attempt: 1, commit_sha: metadata.commitSha, artifacts }), { flag: "wx" });
  return { runDir, runId };
}

async function session(root, name, runs, findingId, recordedOracle, api, fillers = 0) {
  const charter = { schemaVersion: "lakda/exploration-charter/v1", charterId: name, targetRevision: "fixture-v1", platform: "pc-web", executionMode: "fixture", adapter: { id: "playwright" }, baseUrl: "http://127.0.0.1:3300", persona: "guest", scope: { allowHosts: ["127.0.0.1"] }, budget: { durationMs: 1000, maxActions: 2, maxActionsPerMinute: 10 }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" }, capture: { video: "off", screenshot: "finding-non-pass-bookmark", sampledFrames: { enabled: false, intervalMs: 1000, maxFrames: 2, maxBytes: 1000, source: "playwright", stopTimeoutMs: 1000 } }, templateCorpusVersion: "none", seed: 7 };
  const created = await api.createExplorationSession(charter, { seed: 7 }, join(root, name));
  await api.appendSessionEvent(created.paths, { type: "session-started", status: "running" });
  for (const entry of runs) {
    await api.appendSessionEvent(created.paths, { type: "checkpoint", payload: { runId: entry.runId } });
    await api.registerRunManifest(created.paths, entry.runId, join(entry.runDir, "exports/artifact-manifest.json"));
  }
  for (const id of [findingId, ...Array.from({ length: fillers }, (_, i) => "finding-linked-" + String(i).padStart(2, "0"))]) {
    await api.writeFinding(created.paths, { schemaVersion: "lakda/exploration-finding/v1", findingId: id, sessionId: created.session.sessionId, platform: "pc-web", kind: "freeze", status: "exploratory-finding", severity: "warning", message: "人工媒体のfinding", observedAt: "2026-09-10T00:00:00Z", targetRevision: charter.targetRevision, oracleRefs: [recordedOracle.oracleId], evidenceRefs: [recordedOracle.evidenceRefs[0].artifactId], requirementRefs: [] });
  }
  await api.appendSessionEvent(created.paths, { type: "session-paused", status: "paused" });
  await api.buildExplorationReport(created.paths);
  return created.paths.root;
}

/** Inputs are artificial; dependency injection lets ordinary tests use the source readers. */
export async function createMediaCorpus(root, bytes, api) {
  const picture = reference("adapter:picture-p", "artifacts/p.png", bytes.pngP);
  const pictureOracle = oracle("exploration:picture:fixture", picture);
  const foreignOracle = oracle("exploration:foreign-only:fixture", reference("adapter:foreign-only", "artifacts/q.png", bytes.pngQ));
  const primary = await run(root, "images-primary", [[picture.path, bytes.pngP], ["artifacts/q.png", bytes.pngQ]], [bookmark, { type: "oracle", result: pictureOracle }], [pictureOracle]);
  const foreign = await run(root, "images-foreign", [[picture.path, bytes.pngP], ["artifacts/q.png", bytes.pngQ]], [], [pictureOracle, foreignOracle]);
  const sessions = [
    await session(root, "related", [primary], "finding-A", pictureOracle, api, 30),
    await session(root, "foreign", [primary], "finding-foreign", foreignOracle, api),
    await session(root, "ambiguous", [primary, foreign], "finding-ambiguous", pictureOracle, api),
  ];
  const sources = join(root, "sources.json");
  await writeFile(sources, json({ schemaVersion: "lakda/report-sources/v1", root: ".", entries: [...sessions.map(path => ({ kind: "session", path: relative(root, path).replaceAll("\\", "/") })), ...[primary, foreign].map(entry => ({ kind: "run", path: relative(root, entry.runDir).replaceAll("\\", "/") }))] }), { flag: "wx" });
  const movie = reference("adapter:video", "artifacts/recording.webm", bytes.webm);
  const movieOracle = { ...oracle("exploration:video:fixture", movie), verdict: "fail", message: "人工動画: 次の画面が表示されませんでした" };
  const video = await run(root, "video-run", [[movie.path, bytes.webm], [picture.path, bytes.pngP]], [bookmark, { type: "oracle", result: movieOracle }, { type: "oracle", result: pictureOracle }], [movieOracle, pictureOracle]);
  const formats = await run(root, "formats-run", [["artifacts/frames/frame-7.png", bytes.pngQ], ["artifacts/frames/frame-2.png", bytes.pngP], ["artifacts/broken.png", bytes.pngP.subarray(0, 8)], ["artifacts/broken.webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("webm")])], ["artifacts/trace.zip", Buffer.from([0x50, 0x4b, 0x05, 0x06, ...Array(18).fill(0)])]], [], []);
  const result = {};
  for (const [name, selector, profile] of [["images", { sources }, "local"], ["shared", { sources }, "share"], ["video", { runDir: video.runDir }, "local"], ["formats", { runDir: formats.runDir }, "local"]]) {
    const generatedOutput = join(root, name + "-generated"), output = join(root, name + "-moved");
    const generated = await api.generateReport(selector, { output: generatedOutput, profile, producerVersion: "artificial-media-fixture", timeoutMs: 10_000 });
    assert.notEqual(generated.receipt.generationStatus, "error", JSON.stringify(generated.receipt));
    const originalVerification = await api.verifyReportBundle(generatedOutput);
    assert.equal(dirname(resolve(generatedOutput)), resolve(root));
    assert.equal(dirname(resolve(output)), resolve(root));
    await rename(generatedOutput, output);
    const verification = await api.verifyReportBundle(output);
    assert.equal(verification.manifestSha256, originalVerification.manifestSha256);
    result[name] = { output, receipt: generated.receipt, verification, viewBytes: (await readFile(join(output, "report-data.json"))).length };
  }
  await writeFile(join(root, "corpus.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  return result;
}
