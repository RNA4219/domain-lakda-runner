import type { ArtifactCollector } from "../../core/artifacts.js";
import { LocalLlmClient, LlmContractError } from "../../core/llm.js";
import type { LakdaConfig, LlmStatus, RunOutcome, TerminationReason } from "../../core/types.js";
import type { ActionCandidate } from "../contracts.js";
import { selectAdaptiveGenerator } from "../generators.js";
import type { StateGraph } from "../graph.js";
import { candidateDivergence, type ReplayStep } from "../replay.js";

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function llmFailureKind(error: unknown): "timeout" | "contract-rejected" | "unavailable" {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|deadline/i.test(message)) return "timeout";
  if (error instanceof LlmContractError && error.evidence) return "contract-rejected";
  return "unavailable";
}

export function llmEvidenceRef(error: unknown): string | undefined {
  return error instanceof LlmContractError ? error.evidence?.rawResponseSha256 ?? error.evidence?.redactedResponseSha256 : undefined;
}

export type LlmPreflightResult =
  | { kind: "ready"; llmStatus: LlmStatus; client?: LocalLlmClient }
  | { kind: "terminal"; llmStatus: LlmStatus; outcome: RunOutcome; terminationReason: TerminationReason };

export async function preflightLlmSelection(input: {
  config: LakdaConfig;
  collector: ArtifactCollector;
  trace: Array<Record<string, unknown>>;
  replay: boolean;
}): Promise<LlmPreflightResult> {
  if (input.replay || input.config.adaptive?.generator.strategy !== "llm-select") return { kind: "ready", llmStatus: "not_requested" };
  const client = new LocalLlmClient(input.config);
  try {
    await client.preflight({ completion: false });
    input.trace.push({ type: "llm-preflight", status: "available" });
    return { kind: "ready", llmStatus: "available", client };
  } catch (error) {
    const reason = llmFailureKind(error);
    const llmStatus: LlmStatus = /model|GGUF/i.test(error instanceof Error ? error.message : "") ? "mismatch" : "unavailable";
    if (error instanceof LlmContractError && error.evidence) input.collector.addLlmEvidence(error.evidence);
    const evidenceRef = llmEvidenceRef(error);
    input.trace.push({ type: "llm-selection-error", phase: "preflight", reason, ...(evidenceRef ? { evidenceRef } : {}) });
    return { kind: "terminal", llmStatus, outcome: "partial", terminationReason: "llm_error" };
  }
}

export type CandidateSelection =
  | { kind: "candidate"; candidate: ActionCandidate; replayCandidateReason?: string }
  | { kind: "none" }
  | { kind: "terminal"; outcome: RunOutcome; terminationReason: TerminationReason; llmStatus?: LlmStatus };

export async function selectNextCandidate(input: {
  config: LakdaConfig;
  collector: ArtifactCollector;
  graph: StateGraph;
  trace: Array<Record<string, unknown>>;
  safeCandidates: ActionCandidate[];
  replayCandidates: ActionCandidate[];
  replayStep?: ReplayStep;
  replay: boolean;
  actions: number;
  random: () => number;
  llmClient?: LocalLlmClient;
}): Promise<CandidateSelection> {
  if (!input.config.adaptive) throw new Error("adaptive-explore requires adaptive configuration");
  if (input.replay) {
    if (!input.replayStep) {
      input.trace.push({ type: "replay-divergence", reason: "candidate-unresolved", candidateId: "missing-replay-step" });
      return { kind: "terminal", outcome: "failed", terminationReason: "machine_failure" };
    }
    const expectedCandidate = input.replayStep.candidate;
    const resolved = input.replayCandidates.find(value => value.candidateId === expectedCandidate.candidateId && value.targetRef.targetId === expectedCandidate.targetRef.targetId);
    if (!resolved) {
      const sameId = input.replayCandidates.some(value => value.candidateId === expectedCandidate.candidateId);
      input.trace.push({ type: "replay-divergence", candidateId: expectedCandidate.candidateId, reason: sameId ? "scope-or-safety-violation" : "candidate-unresolved", expectedCandidate });
      return { kind: "terminal", outcome: "failed", terminationReason: "machine_failure" };
    }
    const candidateReason = candidateDivergence(expectedCandidate, resolved);
    const contractOverride = Boolean(expectedCandidate.contract && !resolved.contract);
    if (candidateReason && !contractOverride) {
      input.trace.push({ type: "replay-divergence", candidateId: expectedCandidate.candidateId, reason: candidateReason, expectedCandidate, actualCandidate: resolved });
      return { kind: "terminal", outcome: "failed", terminationReason: "machine_failure" };
    }
    if (!input.safeCandidates.some(value => value.candidateId === resolved.candidateId && value.targetRef.targetId === resolved.targetRef.targetId)) {
      input.trace.push({ type: "replay-divergence", candidateId: resolved.candidateId, reason: "scope-or-safety-violation", expectedCandidate, actualCandidate: resolved });
      return { kind: "terminal", outcome: "failed", terminationReason: "machine_failure" };
    }
    return { kind: "candidate", candidate: resolved, ...(candidateReason ? { replayCandidateReason: candidateReason } : {}) };
  }

  try {
    const selection = await selectAdaptiveGenerator(input.config.adaptive.generator.strategy, {
      candidates: input.safeCandidates,
      graph: input.graph,
      random: input.random,
      ...(input.llmClient ? { llm: input.llmClient } : {}),
    });
    if ("evidence" in selection && selection.evidence) {
      input.collector.addLlmEvidence(selection.evidence);
      const evidenceRef = selection.evidence.rawResponseSha256 ?? selection.evidence.redactedResponseSha256;
      input.trace.push({
        type: "llm-selection",
        decision: selection.kind === "candidate" ? "action" : "stop",
        ...(selection.kind === "candidate" ? { candidateId: selection.candidate.candidateId } : {}),
        ...(evidenceRef ? { evidenceRef } : {}),
      });
    }
    if (selection.kind === "stop") {
      input.trace.push({ type: "stop", reason: selection.reason, actionCount: input.actions, coverage: input.graph.coverage() });
      return { kind: "terminal", outcome: input.collector.failures.length ? "failed" : "passed", terminationReason: "completed" };
    }
    return selection.kind === "candidate" ? { kind: "candidate", candidate: selection.candidate } : { kind: "none" };
  } catch (error) {
    const reason = llmFailureKind(error);
    if (error instanceof LlmContractError && error.evidence) input.collector.addLlmEvidence(error.evidence);
    const evidenceRef = llmEvidenceRef(error);
    input.trace.push({ type: "llm-selection-error", phase: "selection", reason, ...(evidenceRef ? { evidenceRef } : {}) });
    return {
      kind: "terminal",
      outcome: "partial",
      terminationReason: "llm_error",
      ...(reason !== "contract-rejected" ? { llmStatus: "unavailable" as const } : {}),
    };
  }
}
