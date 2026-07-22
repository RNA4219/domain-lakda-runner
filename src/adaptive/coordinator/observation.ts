import type { AdaptiveAdapter } from "../../adapters/types.js";
import { runSizeBytes } from "../../core/artifact-store.js";
import type { ArtifactCollector } from "../../core/artifacts.js";
import type { LakdaConfig } from "../../core/types.js";
import { assertCandidateDiscoveryResult } from "../contracts.js";
import type { ActionCandidate, CandidateClassification, CoverageDebt, Observation, OracleResult, TargetRef } from "../contracts.js";
import { fingerprintObservation } from "../fingerprint.js";
import { StateGraph } from "../graph.js";
import { generateInputs, type GeneratedInput, type InputField } from "../input.js";
import { evaluateActionGuard } from "../oracles.js";
import { evaluateAdaptiveSafety, type KillSwitch } from "../safety.js";
import type { SecurityExecutionController } from "../security-execution.js";

export type CandidateSnapshot = {
  observationId: string;
  candidates: ActionCandidate[];
  coverageDebt: CoverageDebt[];
  coverageDebtSummary: Record<string, number>;
  classification?: CandidateClassification;
};

export type TimeoutQuarantineEntry = { timeoutCount: number; revisitBudget: number; blockedUntilAction: number };
export type TimeoutQuarantine = Map<string, TimeoutQuarantineEntry>;

export function inputFields(observation: Observation): InputField[] {
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

export async function observeCandidateSet(input: {
  config: LakdaConfig;
  collector: ArtifactCollector;
  adapter: AdaptiveAdapter;
  activeTargets: () => TargetRef[];
  graph: StateGraph;
  trace: Array<Record<string, unknown>>;
  observations: Observation[];
  observationsByFingerprint: Map<string, Observation>;
  oracleResults: OracleResult[];
  candidateSnapshots: CandidateSnapshot[];
  generatedInputs: GeneratedInput[];
  killSwitch: KillSwitch;
  securityController?: SecurityExecutionController;
  timeoutQuarantine: TimeoutQuarantine;
  actions: number;
  replay: boolean;
}): Promise<{ safeCandidates: ActionCandidate[]; replayCandidates: ActionCandidate[] }> {
  if (!input.config.adaptive) throw new Error("adaptive-explore requires adaptive configuration");
  const safeCandidates: ActionCandidate[] = [];
  const replayCandidates: ActionCandidate[] = [];
  for (const target of input.activeTargets()) {
    const observation = await input.adapter.observe(target, { runId: input.collector.metadata.runId, personaRef: input.config.persona, scopeHosts: input.config.safety.allowHosts });
    input.observations.push(observation);
    for (const generatedInput of generateInputs(inputFields(observation), input.config.seed)) {
      if (!input.generatedInputs.some(existing => existing.caseId === generatedInput.caseId)) input.generatedInputs.push(generatedInput);
    }
    const fingerprint = fingerprintObservation(observation);
    input.observationsByFingerprint.set(fingerprint.value, observation);
    input.graph.recordState(fingerprint, observation.obligations, input.actions);
    input.trace.push({ type: "observation", observationId: observation.observationId, targetRef: observation.targetRef, fingerprint: fingerprint.value });
    const discovery = input.adapter.discoverCandidates
      ? await input.adapter.discoverCandidates(observation)
      : { candidates: await input.adapter.generateCandidates(observation), coverageDebt: [] };
    assertCandidateDiscoveryResult(discovery);
    const generated = discovery.candidates;
    const coverageDebtSummary = discovery.coverageDebt.reduce<Record<string, number>>(
      (summary, debt) => ({ ...summary, [debt.reason]: (summary[debt.reason] ?? 0) + 1 }),
      {},
    );
    input.candidateSnapshots.push({
      observationId: observation.observationId,
      candidates: generated,
      coverageDebt: discovery.coverageDebt,
      coverageDebtSummary,
      ...(discovery.classification ? { classification: discovery.classification } : {}),
    });
    input.graph.recordOffered(generated, input.actions);
    if (input.replay) replayCandidates.push(...generated);
    for (const candidate of generated) {
      const guard = evaluateActionGuard(candidate, observation);
      if (!guard.allowed) {
        if (guard.result) input.oracleResults.push(guard.result);
        if (guard.result) input.trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: guard.result.message, oracleResult: guard.result });
        else input.trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: "guard-not-satisfied" });
        continue;
      }
      const safety = evaluateAdaptiveSafety(candidate, input.config, {
        actionCount: input.actions,
        artifactBytes: await runSizeBytes(input.collector.paths.runDir),
        killSwitch: input.killSwitch,
      });
      if (!safety.allowed) {
        input.trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: safety.reason });
        continue;
      }
      const securityReason = input.securityController ? await input.securityController.denyReason(candidate) : undefined;
      if (securityReason) {
        input.trace.push({ type: "candidate-denied", candidateId: candidate.candidateId, reason: securityReason });
        continue;
      }
      const quarantine = input.timeoutQuarantine.get(candidate.sourceFingerprint + ":" + candidate.candidateId);
      const quarantined = !input.replay && quarantine && (input.actions < quarantine.blockedUntilAction || quarantine.timeoutCount >= quarantine.revisitBudget);
      if (quarantined) {
        input.trace.push({
          type: "candidate-quarantined",
          candidateId: candidate.candidateId,
          sourceFingerprint: candidate.sourceFingerprint,
          reason: "timeout",
          timeoutCount: quarantine.timeoutCount,
          revisitBudget: quarantine.revisitBudget,
          blockedUntilAction: quarantine.blockedUntilAction,
        });
      } else safeCandidates.push(candidate);
    }
  }
  return { safeCandidates, replayCandidates };
}

export async function recordTargetObservation(input: {
  config: LakdaConfig;
  collector: ArtifactCollector;
  adapter: AdaptiveAdapter;
  target: TargetRef;
  graph: StateGraph;
  trace: Array<Record<string, unknown>>;
  observations: Observation[];
  observationsByFingerprint: Map<string, Observation>;
  actions: number;
  phase: "post-action" | "recovery-post";
  candidateId: string;
}): Promise<Observation | undefined> {
  try {
    const observation = await input.adapter.observe(input.target, { runId: input.collector.metadata.runId, personaRef: input.config.persona, scopeHosts: input.config.safety.allowHosts });
    input.observations.push(observation);
    const state = fingerprintObservation(observation);
    input.observationsByFingerprint.set(state.value, observation);
    input.graph.recordState(state, observation.obligations, input.actions);
    input.trace.push({ type: "observation", phase: input.phase, observationId: observation.observationId, targetRef: observation.targetRef, fingerprint: state.value });
    return observation;
  } catch {
    input.trace.push({ type: "observation-unavailable", phase: input.phase, candidateId: input.candidateId });
    return undefined;
  }
}

export async function observeAfterAction(input: Omit<Parameters<typeof recordTargetObservation>[0], "target" | "phase"> & { activeTargets: () => TargetRef[]; targetId: string }): Promise<Observation | undefined> {
  const target = input.activeTargets().find(value => value.targetId === input.targetId);
  if (!target) {
    input.trace.push({ type: "observation-unavailable", phase: "post-action", candidateId: input.candidateId, reason: "target-not-active" });
    return undefined;
  }
  return recordTargetObservation({ ...input, target, phase: "post-action" });
}
