import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { adapterFromInstance, assertBuiltInAdapterCapabilities, createBuiltInAdapter } from "../../adapters/registry.js";
import { LoopbackJsonBridge } from "../../adapters/loopback-json.js";
import type { AdaptiveAdapter } from "../../adapters/types.js";
import type { ActionBudget } from "../../core/action-budget.js";
import type { ArtifactCollector } from "../../core/artifacts.js";
import type { LakdaConfig, LlmStatus, RunOutcome, TerminationReason } from "../../core/types.js";
import type { TargetRef } from "../contracts.js";
import type { GeneratedInput } from "../input.js";
import { KillSwitch } from "../safety.js";
import { SecurityExecutionController } from "../security-execution.js";
import { attachGenericOracles } from "./oracle.js";

export type AdaptiveRuntime = { actionBudget?: ActionBudget; clock?: () => number };
export type AdaptiveRunResult = { outcome: RunOutcome; terminationReason: TerminationReason; llmStatus: LlmStatus };
export type AdaptiveEnvironment = { browser?: Browser; context?: BrowserContext; page?: Page; adapter: AdaptiveAdapter; securityController?: SecurityExecutionController; activeTargets: () => TargetRef[] };

export async function setupAdaptiveEnvironment(config: LakdaConfig, collector: ArtifactCollector, generatedInputs: GeneratedInput[], killSwitch: KillSwitch): Promise<AdaptiveEnvironment> {
  if (!config.adaptive) throw new Error("adaptive-explore requires adaptive configuration");
  if (config.adaptive.adapter.id === "playwright") {
    if (!config.baseUrl) throw new Error("Playwright adaptive-explore requires baseUrl");
    const browser = await chromium.launch({ headless: !config.headed });
    const context = await browser.newContext();
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

    return { browser, context, page, adapter: adapterFromInstance(instance), activeTargets: () => instance.adapter.activeTargets() };
  }
  const bridge = await LoopbackJsonBridge.connect(config.adaptive.adapter.endpoint!, config.adaptive.adapter.id);
  const runtimeBinding = bridge.binding();
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
  return {
    adapter: adapterFromInstance(instance),
    ...(instance.id === "security" ? { securityController: new SecurityExecutionController(config, instance.adapter, killSwitch, collector.metadata.runId, runtimeBinding) } : {}),
    activeTargets: () => [initialTarget],
  };
}

export async function startAdaptiveEnvironment(config: LakdaConfig, environment: AdaptiveEnvironment): Promise<void> {
  if (config.adaptive?.adapter.id !== "playwright") return;
  if (!config.baseUrl || !environment.page) throw new Error("Playwright adaptive-explore requires baseUrl");
  await environment.page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: Math.min(30_000, config.durationMs) });
}

export async function closeAdaptiveEnvironment(environment: AdaptiveEnvironment | undefined, outcome: RunOutcome, collector: ArtifactCollector): Promise<void> {
  if (!environment) return;
  if (environment.context) {
    if (outcome !== "passed" && environment.page) await environment.page.screenshot({ path: collector.paths.screenshot, fullPage: true }).catch(() => collector.markArtifactFailure());
    if (outcome !== "passed") await environment.context.tracing.stop({ path: collector.paths.trace }).catch(() => collector.markArtifactFailure());
    else await environment.context.tracing.stop().catch(() => collector.markArtifactFailure());
    await environment.context.close().catch(() => undefined);
  }
  await environment.browser?.close().catch(() => undefined);
}
