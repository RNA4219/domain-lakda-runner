import { chromium, type BrowserContext, type Page } from "playwright";
import { PlaywrightAdaptiveAdapter } from "../adapters/playwright.js";
import { AirtestPocoAdapter, SecurityAdapter } from "../adapters/external-bridges.js";
import { LoopbackJsonBridge } from "../adapters/loopback-json.js";
import type { AdaptiveAdapter } from "../adapters/types.js";
import { ActionBudget } from "../core/action-budget.js";
import { ArtifactCollector } from "../core/artifacts.js";
import { runSizeBytes } from "../core/artifact-store.js";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import type { LakdaConfig, RunOutcome, TerminationReason } from "../core/types.js";
import { fingerprintObservation } from "./fingerprint.js";
import type { ActionCandidate, ExecutionResult, Observation, OracleResult, TargetRef } from "./contracts.js";
import { StateGraph } from "./graph.js";
import { evaluateAdaptiveSafety, KillSwitch } from "./safety.js";
import { SecurityExecutionController } from "./security-execution.js";
import { evaluateActionGuard, evaluateActionPostconditions, genericOracle } from "./oracles.js";
import { securityOracle } from "./security-oracle.js";
import { writeAdaptiveEvidence } from "./evidence.js";
import { generateInputs, matchesRecordedInputCase, recordInputCase, shrinkFailure, type GeneratedInput, type InputField, type RecordedInputCase } from "./input.js";

export type AdaptiveRuntime = { actionBudget?: ActionBudget; clock?: () => number };
export type AdaptiveRunResult = { outcome: RunOutcome; terminationReason: TerminationReason };
export type AdaptiveReplayEntry = {
  type: string;
  candidate?: ActionCandidate;
  inputCase?: RecordedInputCase;
  executionResult?: ExecutionResult;
  result?: OracleResult;
  status?: ExecutionResult["status"];
  preFingerprint?: string;
  postFingerprint?: string;
  settle?: string;
};
export type AdaptiveReplayTrace = { schemaVersion: "lakda/adaptive-trace/v1" | "lakda/adaptive-replay/v1"; seed: number; trace: AdaptiveReplayEntry[] };
export function isAdaptiveReplayTrace(value: unknown): value is AdaptiveReplayTrace {
  const schemaVersion = value && typeof value === "object" ? (value as { schemaVersion?: unknown }).schemaVersion : undefined;
  return (schemaVersion === "lakda/adaptive-trace/v1" || schemaVersion === "lakda/adaptive-replay/v1") && Array.isArray((value as { trace?: unknown }).trace);
}

type ReplayExecutionExpectation = {
  status: ExecutionResult["status"];
  preFingerprint: string;
  postFingerprint?: string;
  settleStatus: string;
  targetChanges?: Array<Record<string, unknown>>;
};
type ReplayStep = {
  candidate: ActionCandidate;
  inputCase?: RecordedInputCase;
  execution?: ReplayExecutionExpectation;
  oracles: OracleResult[];
};

function expectedExecution(entry: AdaptiveReplayEntry): ReplayExecutionExpectation | undefined {
  const result = entry.executionResult;
  if (result) {
    return {
      status: result.status,
      preFingerprint: result.preFingerprint,
      ...(result.postFingerprint ? { postFingerprint: result.postFingerprint } : {}),
      settleStatus: result.settleResult.status,
      targetChanges: result.targetChanges,
    };
  }
  if (entry.type !== "execution" || !entry.status || !entry.preFingerprint || !entry.settle) return undefined;
  return {
    status: entry.status,
    preFingerprint: entry.preFingerprint,
    ...(entry.postFingerprint ? { postFingerprint: entry.postFingerprint } : {}),
    settleStatus: entry.settle,
  };
}

function buildReplaySteps(replay: AdaptiveReplayTrace | undefined): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let current: ReplayStep | undefined;
  for (const entry of replay?.trace ?? []) {
    if (entry.type === "candidate" && entry.candidate) {
      current = { candidate: entry.candidate, ...(entry.inputCase ? { inputCase: entry.inputCase } : {}), oracles: [] };
      steps.push(current);
    } else if (entry.type === "execution" && current) {
      current.execution = expectedExecution(entry);
    } else if (entry.type === "oracle" && entry.result && current) {
      current.oracles.push(entry.result);
    }
  }
  return steps;
}

function executionDivergence(expected: ReplayExecutionExpectation | undefined, actual: ExecutionResult): string | undefined {
  if (!expected) return "missing-execution-expectation";
  if (expected.status !== actual.status) return "execution-status-mismatch";
  if (expected.preFingerprint !== actual.preFingerprint) return "pre-fingerprint-mismatch";
  if (expected.postFingerprint !== actual.postFingerprint) return "post-fingerprint-mismatch";
  if (expected.settleStatus !== actual.settleResult.status) return "settle-status-mismatch";
  if (expected.targetChanges && canonicalJson(expected.targetChanges) !== canonicalJson(actual.targetChanges)) return "target-topology-mismatch";
  return undefined;
}

function oracleDivergence(expected: OracleResult[] | undefined, actual: OracleResult[]): string | undefined {
  if (!expected?.length) return "missing-oracle-expectation";
  const signature = (value: OracleResult) => canonicalJson({
    oracleClass: value.oracleClass,
    verdict: value.verdict,
    severity: value.severity,
    message: value.message,
    requirementRefs: value.requirementRefs,
  });
  const expectedSignatures = expected.map(signature).sort();
  const actualSignatures = actual.map(signature).sort();
  if (expectedSignatures.length === 1 && actualSignatures.includes(expectedSignatures[0])) return undefined;
  return canonicalJson(expectedSignatures) === canonicalJson(actualSignatures) ? undefined : "oracle-result-mismatch";
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
    if (typeof record.fieldId !== "string" || record.disabled === true) return [];
    const numeric = (key: string): number | undefined => typeof record[key] === "number" ? record[key] : undefined;
    return [{
      fieldId: record.fieldId,
      type: typeof record.type === "string" ? record.type : "text",
      domainRef: `form:${typeof form.formId === "string" ? form.formId : "unknown"}/${record.fieldId}`,
      required: record.required === true,
      ...(numeric("minLength") !== undefined ? { minLength: numeric("minLength") } : {}),
      ...(numeric("maxLength") !== undefined ? { maxLength: numeric("maxLength") } : {}),
      ...(numeric("minimum") !== undefined ? { minimum: numeric("minimum") } : {}),
      ...(numeric("maximum") !== undefined ? { maximum: numeric("maximum") } : {}),
      ...(typeof record.pattern === "string" ? { pattern: record.pattern } : {}),
    }];
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
  const observations: Observation[] = []; const observationsByFingerprint = new Map<string, Observation>(); const candidateSnapshots: Array<{ observationId: string; candidates: ActionCandidate[] }> = []; const oracleResults: OracleResult[] = [];
  const generatedInputs: GeneratedInput[] = []; const shrinkSteps: ShrinkStep[] = []; let failureStep: ShrinkStep | undefined; let recoveryAttempts = 0;
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
        inputValueProvider: (_candidate, execution) => execution.inputCaseRef ? generatedInputs.find(input => input.caseId === execution.inputCaseRef)?.value : undefined,
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
    const replaySteps = buildReplaySteps(replay);
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
        for (const generatedInput of generateInputs(inputFields(observation), config.seed)) {
          if (!generatedInputs.some(existing => existing.caseId === generatedInput.caseId)) generatedInputs.push(generatedInput);
        }
        const fingerprint = fingerprintObservation(observation);
        observationsByFingerprint.set(fingerprint.value, observation);
        graph.recordState(fingerprint, observation.obligations, actions);
        trace.push({ type: "observation", observationId: observation.observationId, targetRef: observation.targetRef, fingerprint: fingerprint.value });
        const generated = await adapter.generateCandidates(observation);
        candidateSnapshots.push({ observationId: observation.observationId, candidates: generated });
        graph.recordOffered(generated, actions);
        for (const candidate of generated) {
          const guard = evaluateActionGuard(candidate, observation);
          if (!guard.allowed) {
            if (guard.result) oracleResults.push(guard.result);
            trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: guard.result?.message ?? "guard-not-satisfied", ...(guard.result ? { oracleResult: guard.result } : {}) });
            continue;
          }
          const safety = evaluateAdaptiveSafety(candidate, config, { actionCount: actions, artifactBytes: await runSizeBytes(collector.paths.runDir), killSwitch });
          if (!safety.allowed) trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: safety.reason });
          else {
            const securityReason = securityController ? await securityController.denyReason(candidate) : undefined;
            if (securityReason) trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: securityReason });
            else safeCandidates.push(candidate);
          }
        }
      }
      const replayStep = replay ? replaySteps[actions] : undefined;
      const candidate = replay ? replayStep?.candidate : graph.choose(safeCandidates, config.adaptive.generator.strategy, rng);
      if (candidate && replay) {
        const safety = evaluateAdaptiveSafety(candidate, config, { actionCount: actions, artifactBytes: await runSizeBytes(collector.paths.runDir), killSwitch });
        const securityReason = safety.allowed ? (securityController ? await securityController.denyReason(candidate) : undefined) : safety.reason;
        if (!safety.allowed || securityReason) { trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: securityReason! }); outcome = "partial"; terminationReason = "completed"; break; }
      }
      if (!candidate) { trace.push({ type: "stop", reason: "no-safe-candidate", actionCount: actions }); outcome = collector.failures.length ? "failed" : "passed"; terminationReason = "completed"; break; }
      const preObservation = observationsByFingerprint.get(candidate.sourceFingerprint);
      if (!preObservation) {
        trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: "pre-observation-missing", expectedFingerprint: candidate.sourceFingerprint });
        outcome = "failed"; terminationReason = "machine_failure"; break;
      }
      const guard = evaluateActionGuard(candidate, preObservation);
      if (!guard.allowed) {
        if (guard.result) oracleResults.push(guard.result);
        trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: guard.result?.message ?? "guard-not-satisfied", ...(guard.result ? { oracleResult: guard.result } : {}) });
        if (replay) trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: guard.result?.message ?? "guard-not-satisfied" });
        outcome = replay ? "failed" : "partial"; terminationReason = replay ? "machine_failure" : "completed"; break;
      }
      const inputFieldId = candidate.inputProfileRef?.startsWith("input-field:") ? candidate.inputProfileRef.slice("input-field:".length) : undefined;
      const candidateInputs = inputFieldId ? generatedInputs.filter(input => input.fieldId === inputFieldId) : [];
      const generatedInput = candidate.inputProfileRef && candidateInputs.length ? candidateInputs[actions % candidateInputs.length] : undefined;
      const inputCase = replay ? replayStep?.inputCase : generatedInput ? recordInputCase(generatedInput) : undefined;
      if (candidate.inputProfileRef && !inputCase) {
        trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: "missing-input-case" });
        outcome = "failed"; terminationReason = "machine_failure"; break;
      }
      if (replay && inputCase) {
        const regenerated = generatedInputs.find(value => value.caseId === inputCase.caseId);
        if (!regenerated || !matchesRecordedInputCase(inputCase, regenerated)) {
          trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: "input-case-mismatch", expectedInputCase: inputCase, actualInputCase: regenerated });
          outcome = "failed"; terminationReason = "machine_failure"; break;
        }
      }
      if (!budget.tryConsume()) { outcome = "partial"; terminationReason = "rate_limit"; break; }
      trace.push({ type: "candidate", candidate, ...(inputCase ? { inputCase } : {}) });
      const executionContext = { runId: collector.metadata.runId, personaRef: config.persona, timeoutMs: Math.min(config.adaptive.settlePolicy.maxWaitMs, Math.max(1, config.durationMs - elapsed)), ...(inputCase ? { inputCaseRef: inputCase.caseId } : {}) };
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
      trace.push({ type: "execution", executionResult: result, executionId: result.executionId, candidateId: candidate.candidateId, ...(inputCase ? { inputCaseRef: inputCase.caseId } : {}), status: result.status, preFingerprint: result.preFingerprint, ...(result.postFingerprint ? { postFingerprint: result.postFingerprint } : {}), settle: result.settleResult.status });
      let postObservation: Observation | undefined;
      const postTarget = activeTargets().find(target => target.targetId === candidate.targetRef.targetId);
      if (postTarget) {
        try {
          postObservation = await adapter.observe(postTarget, { runId: collector.metadata.runId, personaRef: config.persona, scopeHosts: config.safety.allowHosts });
          observations.push(postObservation);
          const postState = fingerprintObservation(postObservation);
          observationsByFingerprint.set(postState.value, postObservation);
          graph.recordState(postState, postObservation.obligations, actions);
          trace.push({ type: "observation", phase: "post-action", observationId: postObservation.observationId, targetRef: postObservation.targetRef, fingerprint: postState.value });
        } catch {
          trace.push({ type: "observation-unavailable", phase: "post-action", candidateId: candidate.candidateId });
        }
      } else trace.push({ type: "observation-unavailable", phase: "post-action", candidateId: candidate.candidateId, reason: "target-not-active" });
      const productOracles = evaluateActionPostconditions(candidate, preObservation, postObservation, result);
      const generic = genericOracle(result, preObservation, postObservation);
      const security = securityOracle(candidate, result);
      const stepOracles = [generic, ...productOracles, ...(security ? [security] : [])];
      graph.recordOracleResults(candidate.sourceFingerprint, candidate.candidateId, result.postFingerprint, stepOracles, result.status);
      oracleResults.push(...stepOracles);
      stepOracles.forEach(oracle => trace.push({ type: "oracle", result: oracle }));
      if (replay) {
        const reason = executionDivergence(replayStep?.execution, result) ?? oracleDivergence(replayStep?.oracles, stepOracles);
        if (reason) {
          trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason, expectedExecution: replayStep?.execution, actualExecution: result, expectedOracles: replayStep?.oracles, actualOracles: stepOracles });
          outcome = "failed"; terminationReason = "machine_failure"; break;
        }
      }
      if (productOracles.some(oracle => oracle.verdict === "fail") || (generic.verdict === "fail" && ["executed", "denied"].includes(result.status))) {
        outcome = "failed"; terminationReason = "machine_failure"; break;
      }
      if (result.status === "executed") continue;
      if (result.status === "denied") {
        if (replay) { trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, expectedFingerprint: candidate.sourceFingerprint, actualFingerprint: result.preFingerprint }); outcome = "failed"; terminationReason = "machine_failure"; break; }
        continue;
      }
      collector.addFailure("UI-006", result.status);
      if (recoveryAttempts >= config.adaptive.recovery.maxBacktracks) { trace.push({ type: "recovery", candidateId: candidate.candidateId, recovered: false, strategy: "backtrack", reason: "max-backtracks" }); outcome = "failed"; terminationReason = "machine_failure"; break; }
      recoveryAttempts += 1;
      const expectedFingerprint = result.preFingerprint;
      const recoveryPreFingerprint = result.postFingerprint ?? result.preFingerprint;
      const recovered = await adapter.recover({ category: category(result.status), messageRef: result.failureSignature ?? result.status, targetRef: candidate.targetRef }, { runId: collector.metadata.runId, strategy: "backtrack", expectedFingerprint });
      let recoveryObservation: Observation | undefined;
      if (recovered.recovered) {
        const recoveredTarget = activeTargets().find(target => target.targetId === (recovered.targetRef?.targetId ?? candidate.targetRef.targetId));
        if (recoveredTarget) {
          try {
            recoveryObservation = await adapter.observe(recoveredTarget, { runId: collector.metadata.runId, personaRef: config.persona, scopeHosts: config.safety.allowHosts });
            observations.push(recoveryObservation);
            const recoveryState = fingerprintObservation(recoveryObservation);
            observationsByFingerprint.set(recoveryState.value, recoveryObservation);
            graph.recordState(recoveryState, recoveryObservation.obligations, actions);
            trace.push({ type: "observation", phase: "recovery-post", observationId: recoveryObservation.observationId, targetRef: recoveryObservation.targetRef, fingerprint: recoveryState.value });
          } catch { trace.push({ type: "observation-unavailable", phase: "recovery-post", candidateId: candidate.candidateId }); }
        }
      }
      const recoveryPostFingerprint = recoveryObservation ? fingerprintObservation(recoveryObservation).value : undefined;
      const matchedExpectedState = recovered.recovered && recoveryPostFingerprint === expectedFingerprint;
      const recoveryEdgeKind: "backtrack" | "reset" | "recovery" = recovered.strategy === "backtrack" ? "backtrack" : recovered.strategy.includes("reset") ? "reset" : "recovery";
      graph.recordControlTransition({
        from: recoveryPreFingerprint, candidateId: `recovery:${recovered.strategy}:${candidate.candidateId}:${recoveryAttempts}`,
        ...(recoveryPostFingerprint ? { to: recoveryPostFingerprint } : {}), edgeKind: recoveryEdgeKind,
        status: matchedExpectedState ? "recovered" : recovered.recovered ? "diverged" : "not_recovered",
        ...(!matchedExpectedState ? { failureSignature: recovered.recovered ? "recovery-divergence" : "recovery-failed" } : {}),
        evidenceArtifactIds: recovered.evidenceRefs.map(ref => ref.artifactId), actionIndex: actions,
      });
      trace.push({ type: "recovery", candidateId: candidate.candidateId, recovered: recovered.recovered, strategy: recovered.strategy, preFingerprint: recoveryPreFingerprint, expectedFingerprint, ...(recoveryPostFingerprint ? { postFingerprint: recoveryPostFingerprint } : {}), matchedExpectedState });
      if (recovered.recovered && !matchedExpectedState) {
        trace.push({ type: "recovery-divergence", candidateId: candidate.candidateId, strategy: recovered.strategy, expectedFingerprint, actualFingerprint: recoveryPostFingerprint ?? null });
        outcome = "failed"; terminationReason = "machine_failure"; break;
      }
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
      graph: graph.snapshot(), coverage: graph.coverage(), coverageTimeline: graph.coverageTimeline(),
      shrink: outcome === "failed" && failureStep && !replay && config.adaptive?.adapter.id === "playwright"
        ? await shrinkAdaptiveFailure(config, trace, shrinkSteps, failureStep)
        : { status: "not_applicable", reason: "no-reproducible-action-failure", recordedActionCount: actions },
    });
  }
  return { outcome, terminationReason };
}
