import { ActionBudget } from "../../core/action-budget.js";
import { runSizeBytes } from "../../core/artifact-store.js";
import type { ArtifactCollector } from "../../core/artifacts.js";
import { sha256 } from "../../core/redaction.js";
import { LocalLlmClient } from "../../core/llm.js";
import type { LakdaConfig, LlmStatus, RunOutcome, TerminationReason } from "../../core/types.js";
import type { ExecutionResult, Observation, OracleResult } from "../contracts.js";
import { writeAdaptiveEvidence } from "../evidence.js";
import { StateGraph } from "../graph.js";
import { matchesRecordedInputCase, recordInputCase, type GeneratedInput } from "../input.js";
import { evaluateActionGuard } from "../oracles.js";
import { buildReplaySteps, type AdaptiveReplayTrace } from "../replay.js";
import { evaluateAdaptiveSafety, KillSwitch } from "../safety.js";
import {
  observeAfterAction,
  observeCandidateSet,
  type CandidateSnapshot,
  type TimeoutQuarantine,
} from "./observation.js";
import { evaluateAndRecordOracles } from "./oracle.js";
import { recoverAdaptiveFailure } from "./recovery.js";
import {
  closeAdaptiveEnvironment,
  setupAdaptiveEnvironment,
  startAdaptiveEnvironment,
  type AdaptiveEnvironment,
  type AdaptiveRunResult,
  type AdaptiveRuntime,
} from "./runtime.js";
import { preflightLlmSelection, seededRandom, selectNextCandidate } from "./selection.js";
import { shrinkAdaptiveFailure, type ShrinkStep } from "./shrinking.js";

export async function runAdaptiveExplore(
  config: LakdaConfig,
  collector: ArtifactCollector,
  runtime: AdaptiveRuntime = {},
  replay?: AdaptiveReplayTrace,
): Promise<AdaptiveRunResult> {
  if (!config.adaptive) throw new Error("adaptive-explore requires adaptive configuration");
  const started = (runtime.clock ?? Date.now)();
  const budget = runtime.actionBudget ?? new ActionBudget(config.safety.maxActionsPerMinute, runtime.clock);
  const graph = new StateGraph();
  const trace: Array<Record<string, unknown>> = [];
  const killSwitch = new KillSwitch();
  const observations: Observation[] = [];
  const observationsByFingerprint = new Map<string, Observation>();
  const candidateSnapshots: CandidateSnapshot[] = [];
  const oracleResults: OracleResult[] = [];
  const generatedInputs: GeneratedInput[] = [];
  const shrinkSteps: ShrinkStep[] = [];
  const timeoutQuarantine: TimeoutQuarantine = new Map();
  let failureStep: ShrinkStep | undefined;
  let recoveryAttempts = 0;
  let environment: AdaptiveEnvironment | undefined;
  let actions = 0;
  let outcome: RunOutcome = "error";
  let terminationReason: TerminationReason = "executor_error";
  let llmStatus: LlmStatus = "not_requested";
  let llmClient: LocalLlmClient | undefined;

  try {
    const preflight = await preflightLlmSelection({ config, collector, trace, replay: Boolean(replay) });
    llmStatus = preflight.llmStatus;
    if (preflight.kind === "terminal") {
      outcome = preflight.outcome;
      terminationReason = preflight.terminationReason;
      return { outcome, terminationReason, llmStatus };
    }
    llmClient = preflight.client;
    environment = await setupAdaptiveEnvironment(config, collector, generatedInputs, killSwitch);
    await startAdaptiveEnvironment(config, environment);
    const { adapter, activeTargets, securityController } = environment;

    if (replay && replay.seed !== config.seed) throw new Error("adaptive replayのseedが設定と一致しません");
    const replaySteps = buildReplaySteps(replay);
    const random = seededRandom(config.seed);

    while (true) {
      const elapsed = (runtime.clock ?? Date.now)() - started;
      if (elapsed >= config.durationMs) {
        outcome = "partial";
        terminationReason = "duration_limit";
        break;
      }
      if (actions >= config.maxActions) {
        outcome = "partial";
        terminationReason = "max_actions";
        break;
      }
      if (actions > 0) {
        const decision = graph.stop(config.adaptive.stopWhen, actions, elapsed);
        if (decision.stop) {
          trace.push({ type: "stop", reason: decision.reason, actionCount: actions, coverage: decision.coverage });
          outcome = collector.failures.length ? "failed" : "passed";
          terminationReason = "completed";
          break;
        }
      }

      const observed = await observeCandidateSet({
        config,
        collector,
        adapter,
        activeTargets,
        graph,
        trace,
        observations,
        observationsByFingerprint,
        oracleResults,
        candidateSnapshots,
        generatedInputs,
        killSwitch,
        ...(securityController ? { securityController } : {}),
        timeoutQuarantine,
        actions,
        replay: Boolean(replay),
      });
      const replayStep = replay ? replaySteps[actions] : undefined;
      const selection = await selectNextCandidate({
        config,
        collector,
        graph,
        trace,
        safeCandidates: observed.safeCandidates,
        replayCandidates: observed.replayCandidates,
        ...(replayStep ? { replayStep } : {}),
        replay: Boolean(replay),
        actions,
        random,
        ...(llmClient ? { llmClient } : {}),
      });
      if (selection.kind === "terminal") {
        if (selection.llmStatus) llmStatus = selection.llmStatus;
        outcome = selection.outcome;
        terminationReason = selection.terminationReason;
        break;
      }
      const candidate = selection.kind === "candidate" ? selection.candidate : undefined;
      const replayCandidateReason = selection.kind === "candidate" ? selection.replayCandidateReason : undefined;

      if (candidate && replay) {
        const safety = evaluateAdaptiveSafety(candidate, config, {
          actionCount: actions,
          artifactBytes: await runSizeBytes(collector.paths.runDir),
          killSwitch,
        });
        const securityReason = safety.allowed ? (securityController ? await securityController.denyReason(candidate) : undefined) : safety.reason;
        if (!safety.allowed || securityReason) {
          trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: "scope-or-safety-violation" });
          outcome = "failed";
          terminationReason = "machine_failure";
          break;
        }
      }
      if (!candidate) {
        trace.push({ type: "stop", reason: "no-safe-candidate", actionCount: actions });
        outcome = collector.failures.length ? "failed" : "passed";
        terminationReason = "completed";
        break;
      }

      const preObservation = observationsByFingerprint.get(candidate.sourceFingerprint);
      if (!preObservation) {
        trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: "pre-observation-missing", expectedFingerprint: candidate.sourceFingerprint });
        outcome = "failed";
        terminationReason = "machine_failure";
        break;
      }
      const guardCandidate = replay ? replayStep?.candidate ?? candidate : candidate;
      const guard = evaluateActionGuard(guardCandidate, preObservation);
      if (!guard.allowed) {
        if (guard.result) oracleResults.push(guard.result);
        trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: guard.result?.message ?? "guard-not-satisfied", ...(guard.result ? { oracleResult: guard.result } : {}) });
        if (replay) trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: guard.result?.message ?? "guard-not-satisfied" });
        outcome = replay ? "failed" : "partial";
        terminationReason = replay ? "machine_failure" : "completed";
        break;
      }

      const inputFieldId = candidate.inputProfileRef?.startsWith("input-field:") ? candidate.inputProfileRef.slice("input-field:".length) : undefined;
      const candidateInputs = inputFieldId ? generatedInputs.filter(input => input.fieldId === inputFieldId) : [];
      const generatedInput = candidate.inputProfileRef && candidateInputs.length ? candidateInputs[actions % candidateInputs.length] : undefined;
      const inputCase = replay ? replayStep?.inputCase : generatedInput ? recordInputCase(generatedInput) : undefined;
      if (candidate.inputProfileRef && !inputCase) {
        trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: "missing-input-case" });
        outcome = "failed";
        terminationReason = "machine_failure";
        break;
      }
      if (replay && inputCase) {
        const regenerated = generatedInputs.find(value => value.caseId === inputCase.caseId);
        if (!regenerated || !matchesRecordedInputCase(inputCase, regenerated)) {
          trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: "input-case-mismatch", expectedInputCase: inputCase, actualInputCase: regenerated });
          outcome = "failed";
          terminationReason = "machine_failure";
          break;
        }
      }
      if (!budget.tryConsume()) {
        outcome = "partial";
        terminationReason = "rate_limit";
        break;
      }

      trace.push({ type: "candidate", candidate, ...(inputCase ? { inputCase } : {}) });
      const executionContext = {
        runId: collector.metadata.runId,
        personaRef: config.persona,
        timeoutMs: Math.min(config.adaptive.settlePolicy.maxWaitMs, Math.max(1, config.durationMs - elapsed)),
        allowedMutationKinds: config.adaptive.safety.allowMutationKinds,
        ...(inputCase ? { inputCaseRef: inputCase.caseId } : {}),
      };
      const securityExecution = securityController && candidate.mutationKind !== "none"
        ? await securityController.execute(candidate, executionContext)
        : undefined;
      let result = securityExecution?.result ?? await adapter.execute(candidate, executionContext);
      if (securityExecution) trace.push(...securityExecution.trace);
      if (result.status === "timeout") {
        try {
          const captureRefs = await adapter.captureEvidence({ runId: collector.metadata.runId, kinds: ["screenshot", "trace", "network"] });
          if (captureRefs.length) result = { ...result, evidenceRefs: [...result.evidenceRefs, ...captureRefs] };
        } catch {
          trace.push({ type: "timeout-evidence-unavailable", candidateId: candidate.candidateId, reason: "capture-failed" });
        }
      }

      actions += 1;
      const shrinkStep: ShrinkStep = { id: "step-" + actions, candidate, expectedStatus: result.status as Exclude<ExecutionResult["status"], "executed"> };
      shrinkSteps.push(shrinkStep);
      if (!replay && result.status !== "executed") failureStep ??= shrinkStep;
      graph.recordTransition(candidate.sourceFingerprint, candidate, result, result.postFingerprint, actions);
      if (result.postFingerprint) graph.recordFingerprint(result.postFingerprint, {}, actions);
      trace.push({
        type: "execution",
        executionResult: result,
        executionId: result.executionId,
        candidateId: candidate.candidateId,
        ...(inputCase ? { inputCaseRef: inputCase.caseId } : {}),
        status: result.status,
        preFingerprint: result.preFingerprint,
        ...(result.postFingerprint ? { postFingerprint: result.postFingerprint } : {}),
        settle: result.settleResult.status,
      });

      const postObservation = await observeAfterAction({
        config,
        collector,
        adapter,
        activeTargets,
        targetId: candidate.targetRef.targetId,
        graph,
        trace,
        observations,
        observationsByFingerprint,
        actions,
        candidateId: candidate.candidateId,
      });
      if (result.status === "timeout") {
        const quarantineKey = candidate.sourceFingerprint + ":" + candidate.candidateId;
        const previousQuarantine = timeoutQuarantine.get(quarantineKey);
        const timeoutCount = (previousQuarantine?.timeoutCount ?? 0) + 1;
        const revisitBudget = config.adaptive.recovery.maxAttemptsPerState;
        const quarantine = { timeoutCount, revisitBudget, blockedUntilAction: actions + 1 };
        timeoutQuarantine.set(quarantineKey, quarantine);
        trace.push({ type: "candidate-quarantined", candidateId: candidate.candidateId, sourceFingerprint: candidate.sourceFingerprint, reason: "timeout", ...quarantine });
        trace.push({
          type: "timeout-evidence",
          candidateId: candidate.candidateId,
          targetRef: candidate.targetRef,
          preObservationId: preObservation.observationId,
          ...(postObservation ? { postObservationId: postObservation.observationId } : {}),
          preFingerprint: result.preFingerprint,
          ...(result.postFingerprint ? { postFingerprint: result.postFingerprint } : {}),
          elapsedMs: result.settleResult.elapsedMs,
          failureSignatureRef: sha256(result.failureSignature ?? "timeout"),
          captureRequested: ["screenshot", "trace", "network"],
          evidenceRefs: result.evidenceRefs.map(ref => ref.artifactId),
        });
      }

      const oracleCandidate = replay ? replayStep?.candidate ?? candidate : candidate;
      const oracleEvaluation = evaluateAndRecordOracles({
        graph,
        candidate,
        oracleCandidate,
        before: preObservation,
        ...(postObservation ? { after: postObservation } : {}),
        execution: result,
        oracleResults,
        trace,
        ...(replayStep ? { replayStep } : {}),
      });
      if (oracleEvaluation.replayDivergenceReason) {
        outcome = "failed";
        terminationReason = "machine_failure";
        break;
      }
      if (replay && replayCandidateReason) {
        trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, reason: replayCandidateReason, expectedCandidate: replayStep?.candidate, actualCandidate: candidate });
        outcome = "failed";
        terminationReason = "machine_failure";
        break;
      }
      if (oracleEvaluation.failed) {
        outcome = "failed";
        terminationReason = "machine_failure";
        break;
      }
      if (result.status === "executed") continue;
      if (result.status === "denied") {
        if (replay) {
          trace.push({ type: "replay-divergence", candidateId: candidate.candidateId, expectedFingerprint: candidate.sourceFingerprint, actualFingerprint: result.preFingerprint });
          outcome = "failed";
          terminationReason = "machine_failure";
          break;
        }
        continue;
      }

      collector.addFailure("UI-006", result.status);
      const recovery = await recoverAdaptiveFailure({
        config,
        collector,
        adapter,
        activeTargets,
        graph,
        trace,
        observations,
        observationsByFingerprint,
        actions,
        candidate,
        execution: result,
        preObservation,
        stepOracles: oracleEvaluation.stepOracles,
        recoveryAttempts,
      });
      recoveryAttempts = recovery.recoveryAttempts;
      if (recovery.terminal) {
        outcome = "failed";
        terminationReason = "machine_failure";
        break;
      }
    }

    if (outcome === "error") {
      outcome = collector.failures.length ? "failed" : "passed";
      terminationReason = "completed";
    }
  } catch (error) {
    collector.markExecutorFailure();
    collector.addFailure("UI-008", error instanceof Error ? error.name : "adaptive-executor-error");
    outcome = "error";
    terminationReason = "executor_error";
  } finally {
    await closeAdaptiveEnvironment(environment, outcome, collector);
    await writeAdaptiveEvidence(collector.paths.runDir, {
      seed: config.seed,
      actions,
      outcome,
      terminationReason,
      observations,
      candidateSnapshots,
      oracleResults,
      trace,
      graph: graph.snapshot(),
      coverage: graph.coverage(),
      coverageTimeline: graph.coverageTimeline(),
      shrink: outcome === "failed" && failureStep && !replay && config.adaptive?.adapter.id === "playwright"
        ? await shrinkAdaptiveFailure(config, trace, shrinkSteps, failureStep)
        : { status: "not_applicable", reason: "no-reproducible-action-failure", recordedActionCount: actions },
    });
  }
  return { outcome, terminationReason, llmStatus };
}
