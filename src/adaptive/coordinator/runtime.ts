import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { adapterFromInstance, assertBuiltInAdapterCapabilities, createBuiltInAdapter } from "../../adapters/registry.js";
import { LoopbackJsonBridge } from "../../adapters/loopback-json.js";
import type { AdaptiveAdapter } from "../../adapters/types.js";
import type { CaptureControlRequest, CaptureControlResult, ExternalToolBridge } from "../../adapters/external-bridges.js";
import type { ActionBudget } from "../../core/action-budget.js";
import type { ArtifactCollector } from "../../core/artifacts.js";
import type { ExplorationCaptureRuntime, LakdaConfig, LlmStatus, RunOutcome, TerminationReason } from "../../core/types.js";
import { captureFailureScreenshot, finalizeVideoCapture, videoRecordingOptions } from "../../core/browser-artifacts.js";
import type { TargetRef } from "../contracts.js";
import { verifyEvidenceArtifactRefs } from "../evidence.js";
import type { GeneratedInput } from "../input.js";
import { KillSwitch } from "../safety.js";
import { SecurityExecutionController } from "../security-execution.js";
import { attachGenericOracles } from "./oracle.js";

export type AdaptiveRuntime = { actionBudget?: ActionBudget; clock?: () => number; controlFile?: string; adaptiveExpectedFingerprint?: string; explorationCapture?: ExplorationCaptureRuntime; adaptiveBridge?: ExternalToolBridge; explorationTargetRevisionProbe?: { kind: "response-header" | "dom-meta"; name: string; expected: string } };
export type AdaptiveRunResult = { outcome: RunOutcome; terminationReason: TerminationReason; llmStatus: LlmStatus };
export type AdaptiveEnvironment = { browser?: Browser; context?: BrowserContext; page?: Page; adapter: AdaptiveAdapter; securityController?: SecurityExecutionController; activeTargets: () => TargetRef[]; screenshotAvailable?: boolean; capture?: { control: (request: CaptureControlRequest) => Promise<CaptureControlResult>; mode: "video" | "sampled-frames/v1"; stopTimeoutMs?: number } };

export async function setupAdaptiveEnvironment(config: LakdaConfig, collector: ArtifactCollector, generatedInputs: GeneratedInput[], killSwitch: KillSwitch, runtime: AdaptiveRuntime = {}): Promise<AdaptiveEnvironment> {
  if (!config.adaptive) throw new Error("adaptive-explore requires adaptive configuration");
  if (config.adaptive.adapter.id === "playwright") {
    if (!config.baseUrl) throw new Error("Playwright adaptive-explore requires baseUrl");
    const browser = await chromium.launch({ headless: !config.headed });
    collector.markCaptureStarted();
    const context = await browser.newContext({
      recordVideo: videoRecordingOptions(config.artifacts.video, collector.paths.runDir),
      ...(config.explorationPlatform === "mobile-web" ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    collector.markCaptureAvailable();
    const page = await context.newPage();
    attachGenericOracles(page, context, collector, config);
    const instance = createBuiltInAdapter("playwright", { kind: "playwright", options: {
      page, context, scopeHosts: config.safety.allowHosts, scopePathPrefixes: config.safety.pathPrefixes,
      actionContracts: config.adaptive.actionContracts, settlePolicy: config.adaptive.settlePolicy,
      inputValueProvider: (_candidate, execution) => execution.inputCaseRef ? generatedInputs.find(input => input.caseId === execution.inputCaseRef)?.value : undefined,
    } });
    if (instance.id !== "playwright") throw new Error("built-in adapter registry identity mismatch");
    assertBuiltInAdapterCapabilities(instance, config.adaptive.safety.allowTargetKinds);

    return { browser, context, page, adapter: adapterFromInstance(instance), screenshotAvailable: true, activeTargets: () => instance.adapter.activeTargets() };
  }
  const bridge = runtime.adaptiveBridge ?? await LoopbackJsonBridge.connect(config.adaptive.adapter.endpoint!, config.adaptive.adapter.id);
  const runtimeBinding = bridge.binding?.() ?? { capabilityDigest: "", bridgeDigest: "" };
  if (config.adaptive.adapter.id === "security") {
    const expected = config.adaptive.securityAuthorization?.binding;
    if (!expected || expected.capabilityDigest !== runtimeBinding.capabilityDigest || expected.bridgeDigest !== runtimeBinding.bridgeDigest) {
      throw new Error("security operator bridge binding mismatch");
    }
  }
  const instance = createBuiltInAdapter(config.adaptive.adapter.id, { kind: "loopback", bridge });
  if (instance.id !== config.adaptive.adapter.id) throw new Error("built-in adapter registry identity mismatch");
  const initialTarget = config.adaptive.adapter.initialTarget!;
  assertBuiltInAdapterCapabilities(instance, config.adaptive.safety.allowTargetKinds, initialTarget.kind);
  const adapter = adapterFromInstance(instance);
  const capabilities = adapter.capabilities();
  const captureControl = (adapter as AdaptiveAdapter & { captureControl?: (request: CaptureControlRequest) => Promise<CaptureControlResult> }).captureControl;
  const screenshotAvailable = capabilities.evidenceCapabilities.includes("screenshot");
  const sampledFramesEnabled = runtime.explorationCapture?.sampledFrames.enabled ?? true;
  const captureMode = capabilities.evidenceCapabilities.includes("video")
    ? "video"
    : sampledFramesEnabled && capabilities.evidenceCapabilities.includes("sampled-frames/v1")
      ? "sampled-frames/v1"
      : undefined;
  collector.markCaptureAvailable({ screenshot: screenshotAvailable, trace: false, video: false });
  if (captureControl && captureMode && config.artifacts.video !== false) {
    const frames = runtime.explorationCapture?.sampledFrames;
    const capture = await captureControl({ runId: collector.metadata.runId, stagingDir: collector.paths.runDir, action: "start", mode: captureMode, ...(captureMode === "sampled-frames/v1" ? { intervalMs: frames?.intervalMs ?? 1_000, maxFrames: frames?.maxFrames ?? 300, maxBytes: frames?.maxBytes ?? 1_073_741_824, stopTimeoutMs: frames?.stopTimeoutMs ?? 5_000 } : {}) });
    if (!capture.accepted) throw new Error(`operator capture start was rejected: ${capture.reason ?? "unknown"}`);
    collector.markCaptureAvailable({ screenshot: screenshotAvailable, trace: false, video: captureMode === "video" });
    return {
      adapter,
      screenshotAvailable,
      ...(captureMode ? { capture: { control: captureControl, mode: captureMode, ...(captureMode === "sampled-frames/v1" ? { stopTimeoutMs: frames?.stopTimeoutMs ?? 5_000 } : {}) } } : {}),
      ...(instance.id === "security" ? { securityController: new SecurityExecutionController(config, instance.adapter, killSwitch, collector.metadata.runId, runtimeBinding) } : {}),
      activeTargets: () => [initialTarget],
    };
  }
  return {
    adapter,
    screenshotAvailable,
    ...(instance.id === "security" ? { securityController: new SecurityExecutionController(config, instance.adapter, killSwitch, collector.metadata.runId, runtimeBinding) } : {}),
    activeTargets: () => [initialTarget],
  };
}

export async function startAdaptiveEnvironment(config: LakdaConfig, environment: AdaptiveEnvironment, revisionProbe?: AdaptiveRuntime["explorationTargetRevisionProbe"]): Promise<void> {
  if (config.adaptive?.adapter.id !== "playwright") return;
  if (!config.baseUrl || !environment.page) throw new Error("Playwright adaptive-explore requires baseUrl");
  const response = await environment.page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: Math.min(30_000, config.durationMs) });
  if (revisionProbe) {
    const actual = revisionProbe.kind === "response-header"
      ? response?.headers()[revisionProbe.name.toLowerCase()]
      : await environment.page.locator(`meta[name="${revisionProbe.name.replace(/"/g, "\\\"")}"]`).getAttribute("content");
    if (actual !== revisionProbe.expected) throw new Error("real target revision probeがmanifestと一致しません");
  }
}

export async function closeAdaptiveEnvironment(config: LakdaConfig, environment: AdaptiveEnvironment | undefined, outcome: RunOutcome, collector: ArtifactCollector): Promise<void> {
  if (!environment) return;
  let stopped = true;
  const needsFailureEvidence = outcome !== "passed" || collector.findingDetected;
  if (!environment.context && needsFailureEvidence && environment.screenshotAvailable === true) {
    await environment.adapter.captureEvidence({ runId: collector.metadata.runId, kinds: ["screenshot"], stagingDir: collector.paths.runDir })
      .then(refs => verifyEvidenceArtifactRefs(refs, collector.paths.runDir, { requireScreenshot: true }))
      .catch(error => { stopped = false; collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "operator screenshot capture failure"); });
  }
  if (environment.capture) {
    try {
      const captureResult = await environment.capture.control({ runId: collector.metadata.runId, stagingDir: collector.paths.runDir, action: outcome === "passed" && !collector.findingDetected ? "discard" : "stop", mode: environment.capture.mode, ...(environment.capture.mode === "sampled-frames/v1" ? { stopTimeoutMs: environment.capture.stopTimeoutMs ?? 5_000 } : {}) });
      if (!captureResult.accepted) stopped = false;
      if (captureResult.artifactRefs.length) await verifyEvidenceArtifactRefs(captureResult.artifactRefs, collector.paths.runDir);
      if (!captureResult.accepted || (environment.capture.mode === "sampled-frames/v1" && outcome !== "passed" && captureResult.frameCount === 0)) {
        collector.markArtifactFailure();
        collector.addFailure("UI-008", captureResult.reason ?? "operator capture produced no usable artifact");
      }
    } catch (error) { stopped = false; collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "operator capture finalization failure"); }
  }
  if (environment.context) {
    if (needsFailureEvidence) await captureFailureScreenshot(environment.context, environment.page, collector.paths.screenshot).catch(error => { collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "screenshot failure"); });
    if (needsFailureEvidence) await environment.context.tracing.stop({ path: collector.paths.trace }).catch(() => collector.markArtifactFailure());
    else await environment.context.tracing.stop().catch(() => collector.markArtifactFailure());
    await environment.context.close().catch(() => { stopped = false; });
    await finalizeVideoCapture(config.artifacts.video, collector.paths.runDir).catch(error => { collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "video finalization failure"); });
  }
  await environment.browser?.close().catch(() => { stopped = false; });
  if (stopped) collector.markCaptureStopped();
}
