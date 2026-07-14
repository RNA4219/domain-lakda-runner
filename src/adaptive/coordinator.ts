import { chromium, type BrowserContext, type Page } from "playwright";
import { PlaywrightAdaptiveAdapter } from "../adapters/playwright.js";
import { AirtestPocoAdapter, SecurityAdapter } from "../adapters/external-bridges.js";
import { LoopbackJsonBridge } from "../adapters/loopback-json.js";
import type { AdaptiveAdapter } from "../adapters/types.js";
import { ActionBudget } from "../core/action-budget.js";
import { ArtifactCollector } from "../core/artifacts.js";
import { runSizeBytes } from "../core/artifact-store.js";
import { sha256 } from "../core/redaction.js";
import type { LakdaConfig, RunOutcome, TerminationReason } from "../core/types.js";
import { fingerprintObservation } from "./fingerprint.js";
import type { ActionCandidate, ExecutionResult, Observation, OracleResult, TargetRef } from "./contracts.js";
import { StateGraph } from "./graph.js";
import { evaluateAdaptiveSafety, KillSwitch } from "./safety.js";
import { SecurityExecutionController } from "./security-execution.js";
import { genericOracle } from "./oracles.js";
import { securityOracle } from "./security-oracle.js";
import { writeAdaptiveEvidence } from "./evidence.js";
import { generateInputs, shrinkFailure, type InputField } from "./input.js";

export type AdaptiveRuntime = { actionBudget?: ActionBudget; clock?: () => number };
export type AdaptiveRunResult = { outcome: RunOutcome; terminationReason: TerminationReason };
export type AdaptiveReplayTrace = { schemaVersion: "lakda/adaptive-trace/v1" | "lakda/adaptive-replay/v1"; seed: number; trace: Array<{ type: string; candidate?: ActionCandidate }> };
export function isAdaptiveReplayTrace(value: unknown): value is AdaptiveReplayTrace {
  const schemaVersion = value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
  return (schemaVersion === "lakda/adaptive-trace/v1" || schemaVersion === "lakda/adaptive-replay/v1") && Array.isArray((value as { trace?: unknown }).trace);
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value += 0x6d2b79f5; let next = value; next = Math.imul(next ^ (next >>> 15), next | 1); next ^= next + Math.imul(next ^ (next >>> 7), next | 61); return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296; };
}
function category(status: string): "unsupported" | "denied" | "timeout" | "target_lost" | "action_failed" | "infrastructure_error" {
  return ["unsupported", "denied", "timeout", "target_lost", "action_failed"].includes(status) ? status as "unsupported" | "denied" | "timeout" | "target_lost" | "action_failed" : "infrastructure_error";
}
function inputFields(observation: Observation): InputField[] {
  return observation.forms.flatMap(form => Array.isArray(form.fields) ? form.fields.flatMap(field => {
    if (!field || typeof field !== "object") return [];
    const record = field as Record<string, unknown>;
    if (typeof record.fieldId !== "string") return [];
    return [{ fieldId: record.fieldId, type: typeof record.type === "string" ? record.type : "text", required: record.required === true }];
  }) : []);
}
type ShrinkStep = {
  id: string;
  candidate: ActionCandidate;
  expectedStatus: Exclude<ExecutionResult["status"], "executed">;
};

function isSafeForShrinking(steps: ShrinkStep[]): boolean {
  return steps.length > 0 && steps.every(step => step.candidate.mutationKind === "none" && ["click", "check"].includes(step.candidate.actionKind));
}

async function replayFailureForShrink(config: LakdaConfig, steps: ShrinkStep[], failure: ShrinkStep): Promise<{ reproduced: boolean; signature?: string }> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: !config.headed });
    context = await browser.newContext();
    const page = await context.newPage();
    const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: config.safety.allowHosts, settlePolicy: config.adaptive!.settlePolicy });
    await page.goto(config.baseUrl!, { waitUntil: "domcontentloaded", timeout: Math.min(30_000, config.durationMs) });
    for (const step of steps) {
      let resolved: ActionCandidate | undefined;
      for (const target of adapter.activeTargets()) {
        const observation = await adapter.observe(target, { runId: "shrink-replay", personaRef: config.persona, scopeHosts: config.safety.allowHosts });
        resolved = (await adapter.generateCandidates(observation)).find(candidate => candidate.candidateId === step.candidate.candidateId);
        if (resolved) break;
      }
      if (!resolved) return { reproduced: false };
      const result = await adapter.execute(resolved, { runId: "shrink-replay", personaRef: config.persona, timeoutMs: config.adaptive!.settlePolicy.maxWaitMs });
      if (result.status !== "executed") {
        return { reproduced: result.status === failure.expectedStatus, signature: result.failureSignature ?? result.status };
      }
    }
    return { reproduced: false };
  } catch {
    return { reproduced: false };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

async function shrinkAdaptiveFailure(config: LakdaConfig, trace: Array<Record<string, unknown>>, steps: ShrinkStep[], failure: ShrinkStep): Promise<Record<string, unknown>> {
  const parentTraceSha256 = sha256(JSON.stringify(trace));
  if (!isSafeForShrinking(steps)) {
    return { status: "skipped", reason: "unsafe-or-mutating-sequence", algorithmVersion: "delta-debug/1", parentTraceSha256, originalStepCount: steps.length };
  }
  let attempts = 0;
  let finalFailureSignature: string | undefined;
  const reduced = await shrinkFailure(steps, async candidate => {
    attempts += 1;
    const replay = await replayFailureForShrink(config, candidate, failure);
    if (replay.reproduced) finalFailureSignature = replay.signature;
    return replay.reproduced;
  });
  return {
    status: reduced.length < steps.length ? "shrunk" : "not_reduced",
    reason: reduced.length < steps.length ? "status-equivalent-failure-reproduced" : "no-smaller-reproducing-subsequence",
    algorithmVersion: "delta-debug/1",
    parentTraceSha256,
    comparison: "execution-status/v1",
    attempts,
    originalStepCount: steps.length,
    reducedStepCount: reduced.length,
    originalFailureSignature: failure.expectedStatus,
    finalFailureSignature: finalFailureSignature ?? failure.expectedStatus,
    derivedCandidateIds: reduced.map(step => step.candidate.candidateId),
  };
}

function attachGenericOracles(page: Page, context: BrowserContext, collector: ArtifactCollector, config: LakdaConfig): void {
  const attach = (target: Page) => {
    target.on("pageerror", error => collector.addFailure("UI-001", error.name));
    target.on("crash", () => collector.addFailure("UI-002", "page-crash"));
    target.on("console", message => { if (message.type() === "error") collector.addFailure("UI-003", message.type()); });
    target.on("response", response => { if (response.status() >= 500 && config.safety.allowHosts.includes(new URL(response.url()).hostname)) collector.addFailure("UI-004", `HTTP ${response.status()}`); });
  };
  attach(page); context.on("page", attach);
}

export async function runAdaptiveExplore(config: LakdaConfig, collector: ArtifactCollector, runtime: AdaptiveRuntime = {}, replay?: AdaptiveReplayTrace): Promise<AdaptiveRunResult> {
  if (!config.adaptive) throw new Error("adaptive-explore requires adaptive configuration");
  const started = (runtime.clock ?? Date.now)();
  const budget = runtime.actionBudget ?? new ActionBudget(config.safety.maxActionsPerMinute, runtime.clock);
  const graph = new StateGraph(); const trace: Array<Record<string, unknown>> = []; const killSwitch = new KillSwitch();
  const observations: Observation[] = []; const candidateSnapshots: Array<{ observationId: string; candidates: ActionCandidate[] }> = []; const oracleResults: OracleResult[] = [];
  const generatedInputValues: string[] = []; const shrinkSteps: ShrinkStep[] = []; let failureStep: ShrinkStep | undefined; let recoveryAttempts = 0;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined; let context: BrowserContext | undefined; let page: Page | undefined; let adapter!: AdaptiveAdapter; let securityController: SecurityExecutionController | undefined; let activeTargets!: () => TargetRef[];
  let actions = 0; let outcome: RunOutcome = "error"; let terminationReason: TerminationReason = "executor_error";
  try {
    if (config.adaptive.adapter.id === "playwright") {
      if (!config.baseUrl) throw new Error("Playwright adaptive-explore requires baseUrl");
      browser = await chromium.launch({ headless: !config.headed });
      context = await browser.newContext();
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      collector.markCaptureAvailable();
      page = await context.newPage(); attachGenericOracles(page, context, collector, config);
      const playwrightAdapter = new PlaywrightAdaptiveAdapter({
        page, context, scopeHosts: config.safety.allowHosts,
        settlePolicy: config.adaptive.settlePolicy,
        inputValueProvider: candidate => candidate.actionKind === "select" ? "1" : generatedInputValues[actions % generatedInputValues.length] ?? `lakda-${config.seed}-${actions + 1}`,
      });
      adapter = playwrightAdapter;
      activeTargets = () => playwrightAdapter.activeTargets();
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded", timeout: Math.min(30_000, config.durationMs) });
    } else {
      const bridge = await LoopbackJsonBridge.connect(config.adaptive.adapter.endpoint!, config.adaptive.adapter.id);
      if (config.adaptive.adapter.id === "airtest-poco") {
        adapter = new AirtestPocoAdapter(bridge);
      } else {
        const securityAdapter = new SecurityAdapter(bridge);
        adapter = securityAdapter;
        securityController = new SecurityExecutionController(config, securityAdapter, killSwitch, collector.metadata.runId);
      }
      const initialTarget = config.adaptive.adapter.initialTarget!;
      if (!adapter.capabilities().targetKinds.includes(initialTarget.kind)) throw new Error("operator bridge does not support configured initialTarget kind");
      activeTargets = () => [initialTarget];
    }
    if (replay && replay.seed !== config.seed) throw new Error("adaptive replayのseedが設定と一致しません");
    const replayCandidates = replay?.trace.flatMap(entry => entry.type === "candidate" && entry.candidate ? [entry.candidate] : []) ?? [];
    const rng = random(config.seed); let stop = false;
    while (!stop) {
      const elapsed = (runtime.clock ?? Date.now)() - started;
      if (elapsed >= config.durationMs) { outcome = "partial"; terminationReason = "duration_limit"; break; }
      if (actions >= config.maxActions) { outcome = "partial"; terminationReason = "max_actions"; break; }
      if (actions > 0) {
        const decision = graph.stop(config.adaptive.stopWhen, actions, elapsed);
        if (decision.stop) { trace.push({ type: "stop", reason: decision.reason, actionCount: actions, coverage: decision.coverage }); outcome = collector.failures.length ? "failed" : "passed"; terminationReason = "completed"; break; }
      }
      const safeCandidates = [];
      for (const target of activeTargets()) {
        const observation = await adapter.observe(target, { runId: collector.metadata.runId, personaRef: config.persona, scopeHosts: config.safety.allowHosts });
        observations.push(observation);
        generatedInputValues.push(...generateInputs(inputFields(observation), config.seed + generatedInputValues.length).map(value => value.value));
        const fingerprint = fingerprintObservation(observation);
        graph.recordState(fingerprint, observation.obligations, actions);
        trace.push({ type: "observation", observationId: observation.observationId, targetRef: observation.targetRef, fingerprint: fingerprint.value });
        const generated = await adapter.generateCandidates(observation);
        candidateSnapshots.push({ observationId: observation.observationId, candidates: generated });
        graph.recordOffered(generated);
        for (const candidate of generated) {
          const safety = evaluateAdaptiveSafety(candidate, config, { actionCount: actions, artifactBytes: await runSizeBytes(collector.paths.runDir), killSwitch });
          if (!safety.allowed) trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: safety.reason });
          else {
            const securityReason = securityController ? await securityController.denyReason(candidate) : undefined;
            if (securityReason) trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: securityReason });
            else safeCandidates.push(candidate);
          }
        }
      }
      const candidate = replay ? replayCandidates[actions] : graph.choose(safeCandidates, config.adaptive.generator.strategy, rng);
      if (candidate && replay) {
        const safety = evaluateAdaptiveSafety(candidate, config, { actionCount: actions, artifactBytes: await runSizeBytes(collector.paths.runDir), killSwitch });
        const securityReason = safety.allowed ? (securityController ? await securityController.denyReason(candidate) : undefined) : safety.reason;
        if (!safety.allowed || securityReason) { trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: securityReason! }); outcome = "partial"; terminationReason = "completed"; break; }
      }
      if (!candidate) { trace.push({ type: "stop", reason: "no-safe-candidate", actionCount: actions }); outcome = collector.failures.length ? "failed" : "passed"; terminationReason = "completed"; break; }
      if (!budget.tryConsume()) { outcome = "partial"; terminationReason = "rate_limit"; break; }
      trace.push({ type: "candidate", candidate });
      const executionContext = { runId: collector.metadata.runId, personaRef: config.persona, timeoutMs: Math.min(config.adaptive.settlePolicy.maxWaitMs, Math.max(1, config.durationMs - elapsed)) };
      const securityExecution = securityController && candidate.mutationKind !== "none"
        ? await securityController.execute(candidate, executionContext)
        : undefined;
      const result = securityExecution?.result ?? await adapter.execute(candidate, executionContext);
      if (securityExecution) trace.push(...securityExecution.trace);
      actions += 1;
      const shrinkStep: ShrinkStep = { id: "step-" + actions, candidate, expectedStatus: result.status as Exclude<ExecutionResult["status"], "executed"> };
      shrinkSteps.push(shrinkStep);
      if (!replay && result.status !== "executed") failureStep ??= shrinkStep;
      graph.recordTransition(candidate.sourceFingerprint, candidate, result, result.postFingerprint, actions);
      if (result.postFingerprint) graph.recordFingerprint(result.postFingerprint, {}, actions);
      trace.push({ type: "execution", executionId: result.executionId, candidateId: candidate.candidateId, status: result.status, preFingerprint: result.preFingerprint, ...(result.postFingerprint ? { postFingerprint: result.postFingerprint } : {}), settle: result.settleResult.status });
      const oracle = securityOracle(candidate, result) ?? genericOracle(result);
      oracleResults.push(oracle);
      trace.push({ type: "oracle", result: oracle });
      if (result.status === "executed") continue;
      if (result.status === "denied") {
        if (replay) { trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, expectedFingerprint: candidate.sourceFingerprint, actualFingerprint: result.preFingerprint }); outcome = "failed"; terminationReason = "machine_failure"; break; }
        continue;
      }
      collector.addFailure("UI-006", result.status);
      if (recoveryAttempts >= config.adaptive.recovery.maxBacktracks) { trace.push({ type: "recovery", candidateId: candidate.candidateId, recovered: false, strategy: "backtrack", reason: "max-backtracks" }); outcome = "failed"; terminationReason = "machine_failure"; break; }
      recoveryAttempts += 1;
      const recovered = await adapter.recover({ category: category(result.status), messageRef: result.failureSignature ?? result.status, targetRef: candidate.targetRef }, { runId: collector.metadata.runId, strategy: "backtrack", expectedFingerprint: result.preFingerprint });
      trace.push({ type: "recovery", candidateId: candidate.candidateId, recovered: recovered.recovered, strategy: recovered.strategy });
      if (!recovered.recovered) { outcome = "failed"; terminationReason = "machine_failure"; stop = true; }
    }
    if (outcome === "error") { outcome = collector.failures.length ? "failed" : "passed"; terminationReason = "completed"; }
  } catch (error) {
    collector.markExecutorFailure(); collector.addFailure("UI-008", error instanceof Error ? error.name : "adaptive-executor-error");
    outcome = "error"; terminationReason = "executor_error";
  } finally {
    if (context) {
      if (outcome !== "passed" && page) await page.screenshot({ path: collector.paths.screenshot, fullPage: true }).catch(() => collector.markArtifactFailure());
      if (outcome !== "passed") await context.tracing.stop({ path: collector.paths.trace }).catch(() => collector.markArtifactFailure());
      else await context.tracing.stop().catch(() => collector.markArtifactFailure());
      await context.close().catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
    await writeAdaptiveEvidence(collector.paths.runDir, {
      seed: config.seed, actions, outcome, terminationReason, observations, candidateSnapshots, oracleResults, trace,
      graph: graph.snapshot(), coverage: graph.coverage(),
      shrink: outcome === "failed" && failureStep && !replay && config.adaptive?.adapter.id === "playwright"
        ? await shrinkAdaptiveFailure(config, trace, shrinkSteps, failureStep)
        : { status: "not_applicable", reason: "no-reproducible-action-failure", recordedActionCount: actions },
    });
  }
  return { outcome, terminationReason };
}
