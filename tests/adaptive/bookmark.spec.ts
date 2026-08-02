import { expect, test } from "@playwright/test";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { PlaywrightAdaptiveAdapter } from "../../src/adapters/playwright.js";
import type { ActionCandidate, EvidenceArtifactRef, ExecutionResult, Observation } from "../../src/adaptive/contracts.js";
import { fileDigest } from "../../src/core/artifact-store.js";
import { loadConfig } from "../../src/core/config.js";
import { runLakda } from "../../src/core/runner.js";
import { verifyBookmarkEvidenceRefs } from "../../src/adaptive/coordinator/orchestrator.js";
import type { RecoveryResult } from "../../src/adapters/types.js";
import type { ExternalToolBridge } from "../../src/adapters/external-bridges.js";
import { startFixture } from "../fixtures/server.js";

test("Playwright bookmark capture writes a masked screenshot ref without stopping tracing", async () => {
  const fixture = await startFixture(() => ({ body: "<main><h1>Bookmark</h1><input type='password' value='secret'><span data-lakda-sensitive>private</span></main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-bookmark-capture-"));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: ["127.0.0.1"] });
  const tracePath = join(root, "trace.zip");
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await page.goto(fixture.baseUrl);
    await adapter.observe(adapter.primaryTarget(), { runId: "bookmark-test", scopeHosts: ["127.0.0.1"] });
    const refs = await adapter.captureEvidence({ runId: "lakda:run/bookmark-test", kinds: ["screenshot", "trace"], stagingDir: root });
    expect(refs).toHaveLength(1);
    const ref = refs[0]!;
    expect(ref.path).toMatch(/^artifacts\/bookmarks\/lakda-run-bookmark-test-0001\.png$/);
    expect(ref.path).not.toContain("..");
    expect(ref.classification).toBe("internal");
    expect(ref.redactionStatus).toBe("redacted");
    expect(ref.securityStatus).toBe("pass");
    const absolute = join(root, ...ref.path.split("/"));
    expect(existsSync(absolute)).toBe(true);
    const digest = await fileDigest(absolute);
    expect(digest).toEqual({ size: ref.size, sha256: ref.sha256 });
    expect(await page.locator("style").evaluateAll(styles => styles.some(style => style.textContent?.includes("data-lakda-sensitive")))).toBe(false);
    await context.tracing.stop({ path: tracePath });
    expect(existsSync(tracePath)).toBe(true);
  } finally {
    await context.close();
    await browser.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Playwright bookmark capture exposes target/masking failures", async () => {
  const fixture = await startFixture(() => ({ body: "<main><h1>Bookmark failure</h1></main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-bookmark-failure-"));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: ["127.0.0.1"] });
  try {
    await page.goto(fixture.baseUrl);
    await page.close();
    await expect(adapter.captureEvidence({ runId: "bookmark-failure", kinds: ["screenshot"], stagingDir: root })).rejects.toThrow("bookmark screenshot target is unavailable");
  } finally {
    await context.close();
    await browser.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Playwright bookmark verifier rejects pending or unscanned screenshot refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-bookmark-status-verify-"));
  const relativePath = "artifacts/bookmarks/pending.png";
  const absolutePath = join(root, ...relativePath.split("/"));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from("pending-screenshot"), "binary");
  const digest = await fileDigest(absolutePath);
  const pending = { path: relativePath, sha256: digest.sha256, size: digest.size, redactionStatus: "pending", securityStatus: "not_applicable" };
  try {
    await expect(verifyBookmarkEvidenceRefs([pending], root, true)).rejects.toThrow("security status is not verified");
    await expect(verifyBookmarkEvidenceRefs([pending], root, false)).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence verifier rejects traversal, digest drift, and duplicate refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-evidence-ref-verify-"));
  const outside = await mkdtemp(join(tmpdir(), "lakda-evidence-ref-outside-"));
  const relativePath = "artifacts/bookmarks/verified.png";
  const absolutePath = join(root, ...relativePath.split("/"));
  const outsidePath = join(outside, "outside.png");
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from("verified-screenshot"), "binary");
  await writeFile(outsidePath, Buffer.from("outside-screenshot"), "binary");
  const digest = await fileDigest(absolutePath);
  const valid = { path: relativePath, sha256: digest.sha256, size: digest.size, redactionStatus: "redacted", securityStatus: "pass" };
  try {
    await expect(verifyBookmarkEvidenceRefs([{ ...valid, path: "../outside.png" }], root, true)).rejects.toThrow(/portable|outside/);
    await expect(verifyBookmarkEvidenceRefs([{ ...valid, sha256: "0".repeat(64) }], root, true)).rejects.toThrow(/digest mismatch/);
    await expect(verifyBookmarkEvidenceRefs([valid, valid], root, true)).rejects.toThrow(/duplicated/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

const bridgeObservation: Observation = {
  schemaVersion: "lakda/adaptive-contracts/v1",
  observationId: "bookmark-bridge-observation",
  observedAt: "2026-08-03T00:00:00.000Z",
  targetRef: { targetId: "device-1", kind: "device" },
  completeness: "complete",
  ui: { screen: "ready" },
  forms: [],
  dialogs: [],
  topology: { activeTargetId: "device-1" },
  obligations: {},
  provenance: { adapterId: "airtest-poco", runtime: "fixture", capabilityRevision: "bookmark-test/v1" },
};

const emptyCaptureBridge: ExternalToolBridge = {
  capabilities: () => ({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "bookmark-test/v1", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: ["screen"], evidenceCapabilities: ["screenshot"], recoveryStrategies: ["backtrack"] }),
  observe: async () => bridgeObservation,
  generateCandidates: async (): Promise<ActionCandidate[]> => [],
  execute: async (): Promise<ExecutionResult> => { throw new Error("not called"); },
  recover: async (): Promise<RecoveryResult> => ({ recovered: false, strategy: "none", evidenceRefs: [] }),
  captureEvidence: async (): Promise<EvidenceArtifactRef[]> => [],
};

const pendingCaptureBridge: ExternalToolBridge = {
  ...emptyCaptureBridge,
  capabilities: () => ({ ...emptyCaptureBridge.capabilities(), evidenceCapabilities: [] }),
  captureEvidence: async (request): Promise<EvidenceArtifactRef[]> => {
    const relativePath = "artifacts/bookmarks/pending.png";
    const absolutePath = join(request.stagingDir!, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from("pending-screenshot"), "binary");
    const digest = await fileDigest(absolutePath);
    return [{ schemaVersion: "lakda/adaptive-contracts/v1", artifactId: "lakda:artifact-bookmark-pending", path: relativePath, sha256: digest.sha256, size: digest.size, classification: "internal", redactionStatus: "pending", securityStatus: "not_applicable" }];
  },
};

test("adaptive orchestrator turns an empty bookmark ref into explicit artifact failure", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-bookmark-orchestrator-"));
  const controlDir = await mkdtemp(join(tmpdir(), "lakda-bookmark-control-"));
  const controlPath = join(controlDir, "bookmark.json");
  await writeFile(controlPath, JSON.stringify({ command: "bookmark", requestId: "bookmark-request-1" }), "utf8");
  try {
    const config = loadConfig(undefined, {
      baseUrl: "http://127.0.0.1:1",
      outputDir,
      mode: "adaptive-explore",
      seed: 3,
      maxActions: 1,
      durationMs: 2_000,
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1",
        adapter: { id: "airtest-poco", endpoint: "http://127.0.0.1:1", initialTarget: bridgeObservation.targetRef },
        generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" },
        stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 100, stableWindowMs: 10 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["device"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config, undefined, { adaptiveBridge: emptyCaptureBridge, controlFile: controlDir });
    expect(result.outcome).toBe("error");
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: "UI-008", message: expect.stringContaining("bookmark evidence capture failed") })]));
    expect(result.actionSequencePath).toBeTruthy();
    const tracePath = join(dirname(result.actionSequencePath!), "adaptive", "trace.json");
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as { trace: Array<Record<string, unknown>> };
    expect(trace.trace).toEqual(expect.arrayContaining([expect.objectContaining({ type: "operator-bookmark-error", requestId: "bookmark-request-1", reason: "artifact-failure" })]));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(controlDir, { recursive: true, force: true });
  }
});

test("adaptive orchestrator preserves Airtest pending bookmark ref for final artifact policy", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-bookmark-status-"));
  const controlDir = await mkdtemp(join(tmpdir(), "lakda-bookmark-status-control-"));
  await writeFile(join(controlDir, "bookmark.json"), JSON.stringify({ command: "bookmark", requestId: "bookmark-request-status" }), "utf8");
  try {
    const config = loadConfig(undefined, {
      baseUrl: "http://127.0.0.1:1",
      outputDir,
      mode: "adaptive-explore",
      seed: 4,
      maxActions: 1,
      durationMs: 2_000,
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1",
        adapter: { id: "airtest-poco", endpoint: "http://127.0.0.1:1", initialTarget: bridgeObservation.targetRef },
        generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" },
        stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
        settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 100, stableWindowMs: 10 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
        recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["device"], denyActionIds: [], allowMutationKinds: ["none"] },
      },
    });
    const result = await runLakda(config, undefined, { adaptiveBridge: pendingCaptureBridge, controlFile: controlDir });
    expect(result.outcome).toBe("passed");
    expect(result.failures).toEqual([]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(controlDir, { recursive: true, force: true });
  }
});
