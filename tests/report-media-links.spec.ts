import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../src/core/redaction.js";
import { ADAPTIVE_SCHEMA_VERSION, type EvidenceArtifactRef, type OracleResult } from "../src/adaptive/contracts.js";
import { generateReport } from "../src/reporting/generation.js";
import { verifyReportBundle } from "../src/reporting/bundle-verifier.js";
import { assertReportViewSemantics } from "../src/reporting/view-validation.js";
import { readAdaptiveReportHistory } from "../src/reporting/adaptive-history.js";
import type { ExplorationCharter } from "../src/exploration/contracts.js";
import { appendSessionEvent, buildExplorationReport, createExplorationSession, registerRunManifest, writeFinding } from "../src/exploration/session.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5K0AAAAASUVORK5CYII=", "base64");
const reference: EvidenceArtifactRef = { schemaVersion: ADAPTIVE_SCHEMA_VERSION, artifactId: "adapter:picture-p", path: "artifacts/p.png", sha256: sha256(png), size: png.length, classification: "internal", redactionStatus: "redacted", securityStatus: "pass" };
const oracle: OracleResult = { schemaVersion: ADAPTIVE_SCHEMA_VERSION, oracleId: "exploration:freeze:fixture", oracleClass: "generic", verdict: "candidate", severity: "warning", sourceRefs: [], requirementRefs: [], evidenceRefs: [reference], message: "fixture finding" };

async function fixture(root: string, trace: unknown[], oracles: unknown[] = [oracle], runId = "links-fixture") {
  const runDir = join(root, "run");
  const metadata = { schemaVersion: "lakda/run-metadata/v1", runId, attempt: 1, mode: "adaptive-explore", seed: 7, outcome: "failed", terminationReason: "machine_failure", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", producerVersion: "fixture", commitSha: "a".repeat(40) };
  const files = new Map<string, Buffer>([
    ["run-metadata.json", Buffer.from(JSON.stringify(metadata))], ["failure-report.json", Buffer.from('{"failures":[]}')],
    ["adaptive/trace.json", Buffer.from(JSON.stringify({ schemaVersion: "lakda/adaptive-trace/v1", seed: 7, actions: 0, trace }))],
    ["adaptive/oracle-results.jsonl", Buffer.from(oracles.map(value => JSON.stringify(value)).join("\n") + "\n")],
    ["artifacts/p.png", png], ["artifacts/q.png", png],
  ]);
  const save = async (restricted = false) => {
    const artifacts = [];
    for (const [path, bytes] of files) {
      await mkdir(dirname(join(runDir, path)), { recursive: true }); await writeFile(join(runDir, path), bytes);
      artifacts.push({ artifact_id: "lakda:file-" + artifacts.length, kind: path.endsWith(".png") ? "screenshot" : "report", path, sha256: "sha256:" + sha256(bytes), size_bytes: bytes.length, classification: restricted && path === reference.path ? "restricted" : "internal", redaction_status: "redacted", redaction_rule_version: "fixture/v1", safe_for_summary: true, public_exposure: "none", retention: {}, security_checks: { secrets_scan: "pass", pii_scan: "pass" } });
    }
    await mkdir(join(runDir, "exports"), { recursive: true });
    await writeFile(join(runDir, "exports/artifact-manifest.json"), JSON.stringify({ schema_version: "HATE/v1", run_id: metadata.runId, run_attempt: 1, commit_sha: metadata.commitSha, artifacts }));
  };
  await save(); return { runDir, runId, files, save };
}

async function generate(root: string, runDir: string, name: string, profile: "local" | "share" = "local") {
  const output = join(root, name);
  const result = await generateReport({ runDir }, { output, profile, producerVersion: "fixture", timeoutMs: 10_000 });
  expect(result.receipt.generationStatus, JSON.stringify(result.receipt)).not.toBe("error");
  await verifyReportBundle(output);
  return { output, view: JSON.parse(await readFile(join(output, "report-data.json"), "utf8")) };
}

test("media links resolve recorded aliases and HATE IDs without assigning unbound images", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-links-"));
  try {
    const input = await fixture(root, [{ type: "oracle", result: oracle }, { type: "operator-bookmark", requestId: "bookmark", evidenceRefs: [reference.artifactId, "lakda:file-4"], actionCount: 0 }]);
    const { view } = await generate(root, input.runDir, "local");
    const linked = view.media.find((item: { scope: string }) => item.scope === "record");
    expect(linked).toBeDefined();
    expect(linked.recordIds).toEqual(view.timeline.map((item: { id: string }) => item.id));
    for (const event of view.timeline) expect(event.evidenceIds).toEqual([linked.id]);
    expect(view.media).toHaveLength(2);
    expect(view.media.filter((item: { scope: string }) => item.scope === "run")).toHaveLength(1);
    const shared = await generate(root, input.runDir, "share", "share");
    expect(shared.view.media.find((item: { id: string }) => item.id === linked.id)).toMatchObject({ path: null, verification: "excluded", recordIds: linked.recordIds });
    const oneWay = structuredClone(view); oneWay.timeline[0].evidenceIds = [];
    expect(() => assertReportViewSemantics(oneWay)).toThrow();
    const orphan = structuredClone(view); orphan.media.find((item: { scope: string }) => item.scope === "run").runKey = null;
    expect(() => assertReportViewSemantics(orphan)).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function sessionFixture(root: string, name: string, runs: Array<{ runDir: string; runId: string }>) {
  const charter: ExplorationCharter = { schemaVersion: "lakda/exploration-charter/v1", charterId: "report-links", targetRevision: "fixture-v1", platform: "pc-web", executionMode: "fixture", adapter: { id: "playwright" }, baseUrl: "http://127.0.0.1:3300", persona: "guest", scope: { allowHosts: ["127.0.0.1"] }, budget: { durationMs: 1000, maxActions: 2, maxActionsPerMinute: 10 }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" }, capture: { video: "off", screenshot: "finding-non-pass-bookmark", sampledFrames: { enabled: false, intervalMs: 1000, maxFrames: 2, maxBytes: 1000, source: "playwright", stopTimeoutMs: 1000 } }, templateCorpusVersion: "none", seed: 7 };
  const created = await createExplorationSession(charter, { seed: 7 }, join(root, name));
  await appendSessionEvent(created.paths, { type: "session-started", status: "running" });
  for (const run of runs) {
    await appendSessionEvent(created.paths, { type: "checkpoint", payload: { runId: run.runId } });
    await registerRunManifest(created.paths, run.runId, join(run.runDir, "exports/artifact-manifest.json"));
  }
  await writeFinding(created.paths, { schemaVersion: "lakda/exploration-finding/v1", findingId: "finding-A", sessionId: created.session.sessionId, platform: "pc-web", kind: "freeze", status: "exploratory-finding", severity: "warning", message: "fixture finding", observedAt: "2026-09-10T00:00:00Z", targetRevision: charter.targetRevision, oracleRefs: [oracle.oracleId], evidenceRefs: [reference.artifactId], requirementRefs: [] });
  await appendSessionEvent(created.paths, { type: "session-paused", status: "paused" });
  await buildExplorationReport(created.paths);
  return created.paths.root;
}

test("finding media follow bound session and oracle references, including event links and ambiguity", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-finding-links-"));
  try {
    const primary = await fixture(join(root, "primary"), []);
    const unrelated = await fixture(join(root, "other"), [], [oracle], "other-run");
    for (const [index, bound] of [[], [primary], [primary, unrelated]].entries()) {
      const session = await sessionFixture(root, "session-" + index, bound);
      const sources = join(root, "sources-" + index + ".json"); const output = join(root, "report-" + index);
      await writeFile(sources, JSON.stringify({ schemaVersion: "lakda/report-sources/v1", root: ".", entries: [
        { kind: "session", path: relative(root, session).replaceAll("\\", "/") },
        ...[primary, unrelated].map(run => ({ kind: "run", path: relative(root, run.runDir).replaceAll("\\", "/") })),
      ] }));
      const generated = await generateReport({ sources }, { output, profile: "local", producerVersion: "fixture", timeoutMs: 10_000 });
      expect(generated.receipt.generationStatus, JSON.stringify(generated.receipt)).not.toBe("error");
      const view = JSON.parse(await readFile(join(output, "report-data.json"), "utf8"));
      const finding = view.rows.find((row: { kind: string }) => row.kind === "finding");
      const event = view.timeline.find((event: { kind: string }) => event.kind === "finding");
      if (index !== 1) {
        expect(finding).toMatchObject({ evidenceIds: [], evidenceNotes: ["unavailable"] });
        expect(event.evidenceIds).toEqual([]);
      } else {
        expect(finding.evidenceIds).toHaveLength(1); expect(event.evidenceIds).toEqual(finding.evidenceIds);
        const media = view.media.find((item: { id: string }) => item.id === finding.evidenceIds[0]);
        expect(media.runKey).toBe("run:links-fixture:1"); expect(media.recordIds).toContain(event.id);
        const tampered = structuredClone(view);
        const foreign = tampered.media.find((item: { runKey: string }) => item.runKey === "run:other-run:1");
        foreign.scope = "record"; foreign.recordIds = [finding.id];
        tampered.rows.find((row: { id: string }) => row.id === finding.id).evidenceIds.push(foreign.id);
        expect(() => assertReportViewSemantics(tampered)).toThrow();
        await page.context().setOffline(true); await page.goto(pathToFileURL(join(output, "index.html")).href);
        await page.getByRole("button", { name: "表示する: finding-A", exact: true }).click();
        const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
        await expect(detail.locator(".media-card")).toHaveCount(1);
        await detail.getByRole("button", { name: "実行全体の証跡を見る (2件)", exact: true }).click();
        await expect(detail.locator(".media-card")).toHaveCount(2);
        await expect(detail.getByText("所属: run:other-run:1", { exact: true })).toHaveCount(0);
        await detail.getByRole("button", { name: "この項目の証跡へ戻る", exact: true }).click();
        await expect(detail.locator(".media-card")).toHaveCount(1);
      }
      await verifyReportBundle(output);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("viewer keeps run media visible and supports history selection, reset and focus restoration offline", async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-media-ui-"));
  try {
    const input = await fixture(root, [{ type: "oracle", result: oracle }, { type: "operator-bookmark", requestId: "missing", evidenceRefs: ["adapter:unmapped"], actionCount: 0 }]);
    const { output } = await generate(root, input.runDir, "viewer");
    const requests: string[] = []; page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.context().setOffline(true); await page.goto(pathToFileURL(join(output, "index.html")).href);
    await page.getByLabel("キーワード", { exact: true }).fill("links-fixture");
    const opener = page.getByRole("button", { name: "表示する: links-fixture", exact: true });
    await opener.focus(); await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
    await expect(detail.locator(".media-card")).toHaveCount(2);
    await expect(detail.getByText("対応する証跡を確認できません", { exact: true })).toBeVisible();
    const select = detail.getByRole("button", { name: "#1 の証跡を見る (1件)", exact: true });
    await select.click(); await expect(detail.locator(".media-card")).toHaveCount(1);
    await expect(detail.getByRole("heading", { name: /^選択した履歴: #1 · 判定/ })).toBeVisible();
    await expect(detail.locator(".step-summary")).toContainText("fixture finding");
    await expect(detail.locator(".media-card img")).toHaveJSProperty("naturalWidth", 1);
    await detail.getByRole("button", { name: "履歴の選択を解除", exact: true }).click();
    await expect(detail.locator(".media-card")).toHaveCount(2); await expect(select).toBeFocused();
    await select.click(); await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
    await opener.click(); await expect(detail.locator(".media-card")).toHaveCount(2);
    await detail.getByRole("button", { name: "詳細を閉じる", exact: true }).click();
    await expect(page.getByLabel("キーワード", { exact: true })).toHaveValue("links-fixture");
    await page.setViewportSize({ width: 390, height: 844 }); await opener.click();
    await expect(detail.locator(".media-card")).toHaveCount(2);
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await detail.getByRole("button", { name: "#1 の証跡を見る (1件)", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("media-associations.png"), fullPage: false });
    expect(requests).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const viewport of [{ width: 195, height: 422 }, { width: 683, height: 384 }]) test("expanded images expose original pixels and restore fitted bounds at " + viewport.width + " CSS pixels", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-image-zoom-"));
  try {
    const bytes = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 600;
      const brush = canvas.getContext("2d")!; brush.fillStyle = "blue"; brush.fillRect(0, 0, 320, 600);
      return Array.from(Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    }));
    const imageRef = { ...reference, sha256: sha256(bytes), size: bytes.length };
    const recordedOracle = { ...oracle, evidenceRefs: [imageRef] };
    const input = await fixture(root, [{ type: "oracle", result: recordedOracle }], [recordedOracle]);
    input.files.set(imageRef.path, bytes); await input.save();
    const { output } = await generate(root, input.runDir, "zoom");
    await page.setViewportSize(viewport); await page.context().setOffline(true);
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    await page.getByRole("button", { name: "表示する: links-fixture", exact: true }).click();
    await page.getByRole("button", { name: "#1 の証跡を見る (1件)", exact: true }).click();
    const image = page.locator(".media-card img"); await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveJSProperty("naturalWidth", 320);
    const fittedWidth = (await image.boundingBox())!.width;
    await page.getByRole("button", { name: "画像を拡大", exact: true }).click();
    expect((await image.boundingBox())!.width).toBeGreaterThan(fittedWidth);
    expect((await image.boundingBox())!.width).toBeGreaterThanOrEqual(320);
    const region = page.getByRole("region", { name: "拡大画像", exact: true }); await expect(region).toBeFocused();
    if (await region.evaluate(element => element.scrollWidth > element.clientWidth)) {
      await page.keyboard.press("ArrowRight"); await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    }
    await page.keyboard.press("ArrowDown"); await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
    expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "画像を縮小", exact: true }).click();
    expect((await image.boundingBox())!.width).toBeCloseTo(fittedWidth, 1);
    expect(await image.locator("..").evaluate(element => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await image.locator("..").evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual({ left: 0, top: 0 });
    await expect(page.getByRole("button", { name: "画像を拡大", exact: true })).toBeFocused();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing and non-media references are distinguished and restricted associations are omitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-links-"));
  try {
    const input = await fixture(root, [
      { type: "operator-bookmark", requestId: "missing", evidenceRefs: ["adapter:old-unmapped"], actionCount: 0 },
      { type: "operator-bookmark", requestId: "text", evidenceRefs: ["lakda:file-1"], actionCount: 0 },
      { type: "oracle", result: oracle },
    ]);
    let { view } = await generate(root, input.runDir, "local");
    expect(view.timeline[0]).toMatchObject({ evidenceIds: [], evidenceNotes: ["unavailable"] });
    expect(view.timeline[1]).toMatchObject({ evidenceIds: [], evidenceNotes: ["not-media"] });
    expect(view.issues.some((issue: { code: string }) => issue.code === "evidence-unavailable")).toBe(true);
    await input.save(true);
    ({ view } = await generate(root, input.runDir, "restricted"));
    expect(view.media.find((item: { classification: string }) => item.classification === "restricted")).toMatchObject({ path: null, recordIds: [], scope: "run" });
    expect(view.timeline[2].evidenceIds).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(reference.artifactId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit media references reject digest, size, path and oracle-contract inconsistencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-links-"));
  try {
    const badRefs = [{ ...reference, sha256: "b".repeat(64) }, { ...reference, size: png.length + 1 }, { ...reference, path: "../p.png" }, { ...reference, path: "artifacts/missing.png", sha256: "invalid".repeat(8) }];
    for (const [index, ref] of badRefs.entries()) {
      const input = await fixture(join(root, String(index)), [{ type: "oracle", result: { ...oracle, evidenceRefs: [ref] } }], []);
      const result = await generateReport({ runDir: input.runDir }, { output: join(root, "bad-" + index), profile: "local", producerVersion: "fixture", timeoutMs: 10_000 });
      expect(result.receipt.generationStatus).toBe("error"); expect(result.receipt.output).toBeNull();
    }
    const input = await fixture(join(root, "invalid-oracle"), [], [reference]);
    const result = await generateReport({ runDir: input.runDir }, { output: join(root, "bad-oracle"), profile: "local", producerVersion: "fixture", timeoutMs: 10_000 });
    expect(result.receipt.generationStatus).toBe("error");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ambiguous aliases, absent media and stronger reference classification never become guessed links", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-link-boundaries-"));
  try {
    const cases = [
      { oracles: [oracle, { ...oracle, oracleId: "another-oracle", evidenceRefs: [{ ...reference, path: "artifacts/q.png" }] }], notes: ["unavailable"] },
      { oracles: [{ ...oracle, evidenceRefs: [{ ...reference, path: "artifacts/missing.png" }] }], notes: ["unavailable"] },
      { oracles: [{ ...oracle, evidenceRefs: [{ ...reference, classification: "restricted" }] }], notes: undefined },
    ];
    for (const [index, current] of cases.entries()) {
      const base = join(root, String(index));
      const input = await fixture(base, [{ type: "operator-bookmark", requestId: "book", evidenceRefs: [reference.artifactId], actionCount: 0 }], current.oracles);
      const { view } = await generate(base, input.runDir, "report");
      expect(view.timeline[0].evidenceIds).toEqual([]); expect(view.timeline[0].evidenceNotes).toEqual(current.notes);
      if (index === 2) {
        expect(view.media.filter((item: { classification: string }) => item.classification === "restricted")).toEqual([expect.objectContaining({ path: null, recordIds: [], verification: "excluded" })]);
        expect(view.media.filter((item: { path: string | null }) => item.path !== null)).toHaveLength(1);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("history evidence requires the expected execution and oracle contract kinds", () => {
  const execution = { schemaVersion: ADAPTIVE_SCHEMA_VERSION, executionId: "execution-1", candidateId: "candidate-1", preFingerprint: "fixture", startedAt: "2026-09-10T00:00:00Z", endedAt: "2026-09-10T00:00:01Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: {}, evidenceRefs: [reference] };
  const trace = (entries: unknown[]) => ({ schemaVersion: "lakda/adaptive-trace/v1", seed: 7, trace: entries });
  const entries = [{ type: "execution", executionResult: execution }, { type: "oracle", result: oracle }, { type: "candidate-denied", candidateId: "candidate-2", reason: "policy", oracleResult: oracle }];
  expect(readAdaptiveReportHistory(trace(entries)).map(entry => entry.evidenceRefs)).toEqual([[reference], [reference], [reference]]);
  for (const invalid of [{ type: "execution", executionResult: oracle }, { type: "oracle", result: execution }, { type: "candidate-denied", candidateId: "candidate-2", oracleResult: reference }]) {
    expect(() => readAdaptiveReportHistory(trace([invalid]))).toThrow();
  }
});

test("history selection preserves a playable video's position without autoplay and closing pauses it", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-video-links-"));
  try {
    const bytes = Buffer.from(await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext("2d")!; const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" }); const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("fixture recording failed")); });
      let frame = 0; const paint = setInterval(() => { context.fillStyle = ++frame % 2 ? "blue" : "green"; context.fillRect(0, 0, 32, 32); }, 100);
      recorder.start(); await new Promise(resolve => setTimeout(resolve, 1100)); recorder.stop(); await stopped;
      clearInterval(paint); stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }));
    const videoRef = { ...reference, artifactId: "adapter:video", path: "artifacts/recording.webm", sha256: sha256(bytes), size: bytes.length };
    const recordedOracle = { ...oracle, evidenceRefs: [videoRef] };
    const input = await fixture(root, [{ type: "oracle", result: recordedOracle }], [recordedOracle]);
    input.files.set(videoRef.path, bytes); await input.save();
    const { output } = await generate(root, input.runDir, "viewer");
    await page.context().setOffline(true); await page.goto(pathToFileURL(join(output, "index.html")).href);
    await page.getByRole("button", { name: "表示する: links-fixture", exact: true }).click();
    const video = page.locator(".media-card video");
    await video.evaluate(async element => {
      const media = element as HTMLVideoElement;
      await new Promise<void>((resolve, reject) => { media.onloadeddata = () => resolve(); media.onerror = () => reject(new Error("fixture video cannot be decoded")); media.load(); });
      await new Promise<void>(resolve => { media.onseeked = () => resolve(); media.currentTime = 0.2; });
    });
    const position = await video.evaluate(element => (element as HTMLVideoElement).currentTime);
    expect(position).toBeGreaterThan(0);
    await page.getByRole("button", { name: "#1 の証跡を見る (1件)", exact: true }).click();
    expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(position, 2);
    await expect(video).toHaveJSProperty("autoplay", false); await expect(video).toHaveJSProperty("paused", true);
    await video.evaluate(async element => { const media = element as HTMLVideoElement; media.muted = true; await media.play(); });
    await expect(video).toHaveJSProperty("paused", false);
    await page.getByRole("button", { name: "詳細を閉じる", exact: true }).click();
    await expect(video).toHaveJSProperty("paused", true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
