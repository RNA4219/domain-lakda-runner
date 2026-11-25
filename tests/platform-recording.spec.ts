import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadConfig } from "../src/core/config.js";
import { runLakda } from "../src/core/runner.js";
import type { PlatformRecordingRuntime } from "../src/core/platform-recording.js";
import { startFixture } from "./fixtures/server.js";

const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

test("reviewed recording binds input, maps real frames and retains success evidence", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<main data-testid="ready">ok</main>' }));
  try {
    const out = test.info().outputPath();
    const input = join(out, "plan.json");
    const actionBytes = Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219,
      baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    await writeFile(input, actionBytes);
    const configBytes = Buffer.from("fixture config");
    let recordedFrames = 0;
    let firstFramePath = "";
    const recording: PlatformRecordingRuntime = { configBytes, plan: { caseId: "TC-1", caseRevision: "r1", oracleRevision: "o1",
      reviewSha256: "a".repeat(64), actionSha256: hash(actionBytes), configSha256: hash(configBytes), profile: "standard",
      fps: 5, resolution: "fit-720p", reasons: ["final-state"] },
      process: async ({ frames, outputPath, durationMs, viewport, fps }) => {
        recordedFrames = frames.length;
        firstFramePath = frames[0]!.path;
        expect(frames[0]?.offsetMs).toBe(0);
        expect(durationMs - frames.at(-1)!.offsetMs).toBeGreaterThanOrEqual(1000 / fps);
        expect(await readFile(frames.at(-1)!.path)).not.toHaveLength(0);
        expect(await readFile(frames[0]!.path)).not.toHaveLength(0);
        const bytes = Buffer.from("fixture-video"); await writeFile(outputPath, bytes, { flag: "wx" });
        return { width: viewport.width, height: viewport.height, fps, durationMs, sizeBytes: bytes.length, sha256: hash(bytes) };
      } };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: out, mode: "regression-replay", reviewedE2E: true,
      obligations: [{ visible: { testId: "ready" } }] });
    const result = await runLakda(config, input, { platformRecording: recording });
    expect(result).toMatchObject({ outcome: "passed", terminationReason: "completed" });
    expect(recordedFrames).toBeGreaterThan(0);
    expect(existsSync(firstFramePath)).toBe(false);
    const runDir = dirname(result.actionSequencePath!);
    const data = JSON.parse(await readFile(join(runDir, "platform-recording.json"), "utf8"));
    expect(data.actions).toEqual([expect.objectContaining({ sequence: 1, actionId: "open", offsetMs: expect.any(Number) })]);
    expect(existsSync(join(runDir, "artifacts/video/0001.mp4"))).toBe(true);
    const metadata = JSON.parse(await readFile(join(runDir, "run-metadata.json"), "utf8"));
    expect(metadata.artifactPolicy.expectations.video).toBe(true);
  } finally { await fixture.close(); }
});
test("recording failure is artifact failure and does not leave source frames in run", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<main data-testid="ready">ok</main>' }));
  try {
    const out = test.info().outputPath();
    const input = join(out, "plan.json");
    const actionBytes = Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219,
      baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    await writeFile(input, actionBytes);
    const configBytes = Buffer.from("fixture config");
    let framePath = "";
    const recording: PlatformRecordingRuntime = { configBytes, plan: { caseId: "TC-1", caseRevision: "r1", oracleRevision: "o1",
      reviewSha256: "a".repeat(64), actionSha256: hash(actionBytes), configSha256: hash(configBytes), profile: "standard",
      fps: 5, resolution: "fit-720p", reasons: ["final-state"] },
      process: async ({ frames }) => { framePath = frames[0]!.path; throw new Error("untrusted callback detail"); } };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: out, mode: "regression-replay", reviewedE2E: true,
      obligations: [{ visible: { testId: "ready" } }] });
    const result = await runLakda(config, input, { platformRecording: recording });
    expect(result).toMatchObject({ outcome: "error", terminationReason: "artifact_failure", exitCode: 1 });
    expect(result.failures.some(item => item.message.includes("untrusted callback detail"))).toBe(false);
    expect(framePath).not.toBe("");
    expect(existsSync(framePath)).toBe(false);
    const runDir = dirname(result.actionSequencePath!);
    expect(existsSync(join(runDir, "artifacts/video/0001.mp4"))).toBe(false);
    const metadata = JSON.parse(await readFile(join(runDir, "run-metadata.json"), "utf8"));
    expect(metadata.platformRecording.machineResult).toEqual({ status: "evaluated", outcome: "passed", terminationReason: "completed" });
  } finally { await fixture.close(); }
});
test("invalid recording binding is not evaluated and opens no product connection", async () => {
  let requests = 0;
  const fixture = await startFixture(() => { requests++; return { contentType: "text/html", body: "ok" }; });
  try {
    const out = test.info().outputPath(); const input = join(out, "plan.json");
    await writeFile(input, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219,
      baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    const configBytes = Buffer.from("fixture config");
    const recording: PlatformRecordingRuntime = { configBytes, plan: { caseId: "TC-1", caseRevision: "r1", oracleRevision: "o1",
      reviewSha256: "a".repeat(64), actionSha256: "0".repeat(64), configSha256: hash(configBytes), profile: "standard",
      fps: 5, resolution: "fit-720p", reasons: ["final-state"] }, process: async () => { throw new Error("must not run"); } };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: out, mode: "regression-replay", reviewedE2E: true,
      obligations: [{ visible: { testId: "ready" } }] });
    const result = await runLakda(config, input, { platformRecording: recording });
    expect(result.outcome).toBe("error"); expect(requests).toBe(0);
    const metadata = JSON.parse(await readFile(join(dirname(result.actionSequencePath!), "run-metadata.json"), "utf8"));
    expect(metadata.platformRecording.machineResult).toEqual({ status: "not_evaluated" });
  } finally { await fixture.close(); }
});
test("recording publication does not remove an existing video", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<main data-testid="ready">ok</main>' }));
  try {
    const out = test.info().outputPath(); const input = join(out, "plan.json");
    const actionBytes = Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219,
      baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    await writeFile(input, actionBytes);
    const configBytes = Buffer.from("fixture config"); let existing = "";
    const recording: PlatformRecordingRuntime = { configBytes, plan: { caseId: "TC-1", caseRevision: "r1", oracleRevision: "o1",
      reviewSha256: "a".repeat(64), actionSha256: hash(actionBytes), configSha256: hash(configBytes), profile: "standard",
      fps: 5, resolution: "fit-720p", reasons: ["final-state"] },
      process: async ({ outputPath, durationMs, viewport, fps }) => {
        const { readdir, mkdir } = await import("node:fs/promises");
        const run = (await readdir(out)).find(name => name.startsWith("lakda-run-"))!;
        existing = join(out, run, "artifacts/video/0001.mp4");
        await mkdir(dirname(existing), { recursive: true }); await writeFile(existing, "existing", { flag: "wx" });
        const bytes = Buffer.from("fixture-video"); await writeFile(outputPath, bytes, { flag: "wx" });
        return { width: viewport.width, height: viewport.height, fps, durationMs, sizeBytes: bytes.length, sha256: hash(bytes) };
      } };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: out, mode: "regression-replay", reviewedE2E: true,
      obligations: [{ visible: { testId: "ready" } }] });
    const result = await runLakda(config, input, { platformRecording: recording });
    expect(result).toMatchObject({ outcome: "error", terminationReason: "artifact_failure" });
    expect(await readFile(existing, "utf8")).toBe("existing");
  } finally { await fixture.close(); }
});
test("failed reviewed check retains recording and machine result", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<style>@keyframes slide{to{margin-left:60px}} main{animation:slide 1s infinite alternate}</style><main data-testid="ready">actual</main>' }));
  try {
    const out = test.info().outputPath(); const input = join(out, "plan.json");
    const actionBytes = Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219,
      baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    await writeFile(input, actionBytes); const configBytes = Buffer.from("fixture config");
    const recording: PlatformRecordingRuntime = { configBytes, plan: { caseId: "TC-1", caseRevision: "r1", oracleRevision: "o1",
      reviewSha256: "a".repeat(64), actionSha256: hash(actionBytes), configSha256: hash(configBytes), profile: "standard",
      fps: 5, resolution: "fit-720p", reasons: ["final-state"] },
      process: async ({ outputPath, durationMs, viewport, fps }) => { const bytes = Buffer.from("fixture-video"); await writeFile(outputPath, bytes, { flag: "wx" }); return { width: viewport.width, height: viewport.height, fps, durationMs, sizeBytes: bytes.length, sha256: hash(bytes) }; } };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: out, mode: "regression-replay", reviewedE2E: true,
      obligations: [{ textEquals: { locator: { testId: "ready" }, text: "expected" } }] });
    const result = await runLakda(config, input, { platformRecording: recording });
    expect(result).toMatchObject({ outcome: "failed", terminationReason: "obligations_unmet" });
    const runDir = dirname(result.actionSequencePath!); expect(existsSync(join(runDir, "artifacts/video/0001.mp4"))).toBe(true);
    const metadata = JSON.parse(await readFile(join(runDir, "run-metadata.json"), "utf8"));
    expect(metadata.platformRecording.machineResult).toEqual({ status: "evaluated", outcome: "failed", terminationReason: "obligations_unmet" });
  } finally { await fixture.close(); }
});
test("metadata conflict rolls back only the newly published video", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<main data-testid="ready">ok</main>' }));
  try {
    const out = test.info().outputPath(); const input = join(out, "plan.json");
    const actionBytes = Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219,
      baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }] }));
    await writeFile(input, actionBytes); const configBytes = Buffer.from("fixture config"); let occupied = "";
    const recording: PlatformRecordingRuntime = { configBytes, plan: { caseId: "TC-1", caseRevision: "r1", oracleRevision: "o1",
      reviewSha256: "a".repeat(64), actionSha256: hash(actionBytes), configSha256: hash(configBytes), profile: "standard",
      fps: 5, resolution: "fit-720p", reasons: ["final-state"] },
      process: async ({ outputPath, durationMs, viewport, fps }) => {
        const { readdir } = await import("node:fs/promises");
        const run = (await readdir(out)).find(name => name.startsWith("lakda-run-"))!;
        occupied = join(out, run, "platform-recording.json"); await writeFile(occupied, "existing", { flag: "wx" });
        const bytes = Buffer.from("fixture-video"); await writeFile(outputPath, bytes, { flag: "wx" });
        return { width: viewport.width, height: viewport.height, fps, durationMs, sizeBytes: bytes.length, sha256: hash(bytes) };
      } };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: out, mode: "regression-replay", reviewedE2E: true,
      obligations: [{ visible: { testId: "ready" } }] });
    const result = await runLakda(config, input, { platformRecording: recording });
    expect(result).toMatchObject({ outcome: "error", terminationReason: "artifact_failure" });
    expect(await readFile(occupied, "utf8")).toBe("existing");
    expect(existsSync(join(dirname(result.actionSequencePath!), "artifacts/video/0001.mp4"))).toBe(false);
  } finally { await fixture.close(); }
});
test("a popup makes recording alignment unavailable without mapping its frames to the main page", async () => {
  const fixture = await startFixture(() => ({ contentType: "text/html", body: '<main data-testid="ready">ok</main><button data-testid="popup" onclick="window.open(\'/child\')">open</button>' }));
  try {
    const out = test.info().outputPath(); const input = join(out, "plan.json");
    const actionBytes = Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219,
      baseUrl: fixture.baseUrl, actions: [{ id: "open", kind: "navigate", path: "/" }, { id: "popup", kind: "click", locator: { testId: "popup" } }] }));
    await writeFile(input, actionBytes); const configBytes = Buffer.from("fixture config"); let processed = false;
    const recording: PlatformRecordingRuntime = { configBytes, plan: { caseId: "TC-1", caseRevision: "r1", oracleRevision: "o1",
      reviewSha256: "a".repeat(64), actionSha256: hash(actionBytes), configSha256: hash(configBytes), profile: "standard",
      fps: 5, resolution: "fit-720p", reasons: ["final-state"] },
      process: async () => { processed = true; throw new Error("must not process ambiguous page"); } };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: out, mode: "regression-replay", reviewedE2E: true,
      obligations: [{ visible: { testId: "ready" } }] });
    const result = await runLakda(config, input, { platformRecording: recording });
    expect(result).toMatchObject({ outcome: "error", terminationReason: "artifact_failure" });
    expect(processed).toBe(false);
    expect(result.failures).toContainEqual(expect.objectContaining({ message: "recording page alignment unavailable" }));
  } finally { await fixture.close(); }
});
