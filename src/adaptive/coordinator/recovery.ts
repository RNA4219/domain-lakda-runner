import type { AdaptiveAdapter } from "../../adapters/types.js";
import type { ArtifactCollector } from "../../core/artifacts.js";
import type { LakdaConfig } from "../../core/types.js";
import type { ActionCandidate, ExecutionResult, Observation, OracleResult, TargetRef } from "../contracts.js";
import { fingerprintObservation } from "../fingerprint.js";
import { StateGraph } from "../graph.js";
import { evaluateActionPostconditions } from "../oracles.js";
import { recordTargetObservation } from "./observation.js";

export function executionFailureCategory(status: string): "unsupported" | "denied" | "timeout" | "target_lost" | "action_failed" | "infrastructure_error" {
  return ["unsupported", "denied", "timeout", "target_lost", "action_failed"].includes(status)
    ? status as "unsupported" | "denied" | "timeout" | "target_lost" | "action_failed"
    : "infrastructure_error";
}

export function recoveryScopeAllowed(config: LakdaConfig, observation: Observation): boolean {
  const candidateUrl = observation.url ?? observation.targetRef.origin;
  if (!candidateUrl) return true;
  try {
    const url = new URL(candidateUrl);
    if (!config.safety.allowHosts.includes(url.hostname)) return false;
    const prefixes = config.safety.pathPrefixes;
    if (prefixes === undefined) return true;
    return prefixes.some(prefix => {
      const normalized = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      return normalized === "/" || url.pathname === normalized || url.pathname.startsWith(`${normalized}/`);
    });
  } catch {
    return false;
  }
}

export function recoveryInvariantAllowed(candidate: ActionCandidate, before: Observation, after: Observation | undefined, execution: ExecutionResult): boolean {
  if (!candidate.contract?.invariants) return true;
  const result = evaluateActionPostconditions(candidate, before, after, execution);
  return result.every(oracle => !(oracle.oracleClass === "product" && oracle.verdict === "fail" && oracle.message.startsWith("invariant-mismatch:")));
}

export async function recoverAdaptiveFailure(input: {
  config: LakdaConfig;
  collector: ArtifactCollector;
  adapter: AdaptiveAdapter;
  activeTargets: () => TargetRef[];
  graph: StateGraph;
  trace: Array<Record<string, unknown>>;
  observations: Observation[];
  observationsByFingerprint: Map<string, Observation>;
  actions: number;
  candidate: ActionCandidate;
  execution: ExecutionResult;
  preObservation: Observation;
  stepOracles: OracleResult[];
  recoveryAttempts: number;
}): Promise<{ recoveryAttempts: number; terminal: boolean }> {
  if (!input.config.adaptive) throw new Error("adaptive-explore requires adaptive configuration");
  if (input.recoveryAttempts >= input.config.adaptive.recovery.maxBacktracks) {
    input.trace.push({ type: "recovery", candidateId: input.candidate.candidateId, recovered: false, strategy: "backtrack", reason: "max-backtracks" });
    return { recoveryAttempts: input.recoveryAttempts, terminal: true };
  }

  const recoveryAttempts = input.recoveryAttempts + 1;
  const expectedFingerprint = input.execution.preFingerprint;
  const recoveryPreFingerprint = input.execution.postFingerprint ?? input.execution.preFingerprint;
  const recovered = await input.adapter.recover(
    { category: executionFailureCategory(input.execution.status), messageRef: input.execution.failureSignature ?? input.execution.status, targetRef: input.candidate.targetRef },
    { runId: input.collector.metadata.runId, strategy: "backtrack", expectedFingerprint },
  );
  let recoveryObservation: Observation | undefined;
  if (recovered.recovered) {
    const recoveredTarget = input.activeTargets().find(target => target.targetId === (recovered.targetRef?.targetId ?? input.candidate.targetRef.targetId));
    if (recoveredTarget) {
      recoveryObservation = await recordTargetObservation({
        config: input.config,
        collector: input.collector,
        adapter: input.adapter,
        target: recoveredTarget,
        graph: input.graph,
        trace: input.trace,
        observations: input.observations,
        observationsByFingerprint: input.observationsByFingerprint,
        actions: input.actions,
        phase: "recovery-post",
        candidateId: input.candidate.candidateId,
      });
    }
  }
  const recoveryPostFingerprint = recoveryObservation ? fingerprintObservation(recoveryObservation).value : undefined;
  const recoveryChecks = {
    targetReobserved: recovered.recovered && recoveryObservation?.completeness === "complete",
    scopeAllowed: Boolean(recoveryObservation && recoveryScopeAllowed(input.config, recoveryObservation)),
    personaPreserved: recoveryObservation?.personaRef === input.config.persona,
    invariantPreserved: recoveryInvariantAllowed(input.candidate, input.preObservation, recoveryObservation, input.execution),
    criticalOracleClear: !input.stepOracles.some(oracle => oracle.severity === "critical" && ["fail", "confirmed"].includes(oracle.verdict)),
    artifactSecurityClear: !input.execution.evidenceRefs.some(ref => ref.securityStatus === "fail" || ref.redactionStatus === "failed"),
  };
  const recoveryFailures = Object.entries(recoveryChecks).filter(([, passed]) => !passed).map(([name]) => name);
  const matchedExpectedState = recovered.recovered && recoveryPostFingerprint === expectedFingerprint && recoveryFailures.length === 0;
  const recoveryFailureSignature = recoveryFailures.length ? "recovery-safety-divergence" : recovered.recovered ? "recovery-divergence" : "recovery-failed";
  const recoveryEdgeKind: "backtrack" | "reset" | "recovery" = recovered.strategy === "backtrack" ? "backtrack" : recovered.strategy.includes("reset") ? "reset" : "recovery";
  input.graph.recordControlTransition({
    from: recoveryPreFingerprint,
    candidateId: "recovery-" + recovered.strategy + ":" + input.candidate.candidateId + ":" + recoveryAttempts,
    ...(recoveryPostFingerprint ? { to: recoveryPostFingerprint } : {}),
    edgeKind: recoveryEdgeKind,
    status: matchedExpectedState ? "recovered" : recovered.recovered ? "diverged" : "not_recovered",
    ...(!matchedExpectedState ? { failureSignature: recoveryFailureSignature } : {}),
    evidenceArtifactIds: recovered.evidenceRefs.map(ref => ref.artifactId),
    actionIndex: input.actions,
  });
  input.trace.push({
    type: "recovery",
    candidateId: input.candidate.candidateId,
    recovered: recovered.recovered,
    strategy: recovered.strategy,
    preFingerprint: recoveryPreFingerprint,
    expectedFingerprint,
    ...(recoveryPostFingerprint ? { postFingerprint: recoveryPostFingerprint } : {}),
    matchedExpectedState,
    recoveryChecks,
    recoveryFailures,
  });
  if (recovered.recovered && !matchedExpectedState) {
    input.trace.push({
      type: "recovery-divergence",
      candidateId: input.candidate.candidateId,
      strategy: recovered.strategy,
      expectedFingerprint,
      actualFingerprint: recoveryPostFingerprint ?? null,
      recoveryFailures,
    });
  }
  return { recoveryAttempts, terminal: !recovered.recovered || !matchedExpectedState };
}
