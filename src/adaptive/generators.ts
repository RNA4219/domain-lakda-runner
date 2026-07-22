import type { LlmEvidence } from "../core/types.js";
import type { ActionCandidate, AdaptiveGeneratorStrategy } from "./contracts.js";
import type { Coverage, StateGraph } from "./graph.js";

export const BUILTIN_GENERATOR_STRATEGIES = ["random", "weighted-random", "least-visited-transition", "shortest-to-uncovered", "risk-weighted-uncovered", "llm-select"] as const satisfies readonly AdaptiveGeneratorStrategy[];
export const BUILTIN_GENERATOR_VERSION = "builtin/v1";
export type AdaptiveLlmDecision = { schemaVersion: "lakda/adaptive-llm-selection/v1"; decision: "action"; candidateId: string } | { schemaVersion: "lakda/adaptive-llm-selection/v1"; decision: "stop" };
export type RedactedGraphSummary = {
  schemaVersion: "lakda/adaptive-llm-graph-summary/v1";
  graphRevision: number;
  discoveredStateCount: number;
  transitionCount: number;
  coverage: Pick<Coverage, "actionCoverage" | "transitionCoverage" | "transitionPairCoverage" | "roundTripCoverage" | "obligationCoverage">;
  candidateStats: Array<{ candidateId: string; sourceStateVisits: number; transitionVisits: number; uncovered: boolean }>;
};
export type AdaptiveLlmSelector = { selectAdaptiveCandidate(candidateIds: string[], summary: RedactedGraphSummary): Promise<{ decision: AdaptiveLlmDecision; evidence: LlmEvidence }> };
export type GeneratorSelection = { kind: "candidate"; candidate: ActionCandidate; evidence?: LlmEvidence } | { kind: "stop"; reason: "llm-stop"; evidence: LlmEvidence } | { kind: "none" };
type GeneratorContext = { candidates: ActionCandidate[]; graph: StateGraph; random: () => number; llm?: AdaptiveLlmSelector };
type GeneratorRegistryEntry = { version: typeof BUILTIN_GENERATOR_VERSION; select(context: GeneratorContext): Promise<GeneratorSelection> };
const opaqueCandidateId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function orderedCandidates(candidates: ActionCandidate[]): ActionCandidate[] { return [...candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId)); }
function randomCandidate(candidates: ActionCandidate[], draw: () => number): ActionCandidate | undefined { return candidates[Math.floor(draw() * candidates.length)]; }
function weightedCandidate(candidates: ActionCandidate[], draw: () => number): ActionCandidate | undefined {
  const weights = candidates.map(candidate => Number.isFinite(candidate.risk.weight) ? Math.max(0, candidate.risk.weight) : 0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return randomCandidate(candidates, draw);
  const selected = draw() * total; let cumulative = 0;
  for (let index = 0; index < candidates.length; index += 1) { cumulative += weights[index]; if (selected < cumulative) return candidates[index]; }
  return candidates.at(-1);
}
function scoredCandidate(candidates: ActionCandidate[], graph: StateGraph, strategy: Exclude<AdaptiveGeneratorStrategy, "random" | "weighted-random" | "llm-select">, draw: () => number): ActionCandidate | undefined {
  const scored = candidates.map(candidate => {
    const transitionVisits = graph.transitionVisits(candidate.sourceFingerprint, candidate.candidateId); const stateVisits = graph.visits(candidate.sourceFingerprint); const unseen = graph.uncovered([candidate]).length ? 1 : 0;
    const score = strategy === "least-visited-transition" ? -transitionVisits : strategy === "shortest-to-uncovered" ? unseen * 10_000 - stateVisits * 10 - transitionVisits : unseen * candidate.risk.weight * 100 - transitionVisits;
    return { candidate, score };
  });
  const max = Math.max(...scored.map(value => value.score));
  return randomCandidate(scored.filter(value => value.score === max).map(value => value.candidate), draw);
}
export function assertOpaqueCandidateIds(candidates: ActionCandidate[]): void {
  const seen = new Set<string>();
  for (const candidate of candidates) { if (!opaqueCandidateId.test(candidate.candidateId)) throw new Error("adaptive LLM candidate ID is not an opaque safe reference"); if (seen.has(candidate.candidateId)) throw new Error("adaptive LLM candidate IDs must be unique"); seen.add(candidate.candidateId); }
}
export function redactedGraphSummary(graph: StateGraph, candidates: ActionCandidate[]): RedactedGraphSummary {
  assertOpaqueCandidateIds(candidates); const coverage = graph.coverage(); const uncovered = new Set(graph.uncovered(candidates).map(candidate => candidate.candidateId));
  return {
    schemaVersion: "lakda/adaptive-llm-graph-summary/v1", graphRevision: coverage.graphRevision, discoveredStateCount: coverage.discoveredStateCount, transitionCount: coverage.transitionCount,
    coverage: { actionCoverage: coverage.actionCoverage, transitionCoverage: coverage.transitionCoverage, transitionPairCoverage: coverage.transitionPairCoverage, roundTripCoverage: coverage.roundTripCoverage, obligationCoverage: coverage.obligationCoverage },
    candidateStats: orderedCandidates(candidates).map(candidate => ({ candidateId: candidate.candidateId, sourceStateVisits: graph.visits(candidate.sourceFingerprint), transitionVisits: graph.transitionVisits(candidate.sourceFingerprint, candidate.candidateId), uncovered: uncovered.has(candidate.candidateId) })),
  };
}
const registry = Object.freeze({
  random: Object.freeze({ version: BUILTIN_GENERATOR_VERSION, async select({ candidates, random }: GeneratorContext) { const candidate = randomCandidate(orderedCandidates(candidates), random); return candidate ? { kind: "candidate" as const, candidate } : { kind: "none" as const }; } }),
  "weighted-random": Object.freeze({ version: BUILTIN_GENERATOR_VERSION, async select({ candidates, random }: GeneratorContext) { const candidate = weightedCandidate(orderedCandidates(candidates), random); return candidate ? { kind: "candidate" as const, candidate } : { kind: "none" as const }; } }),
  "least-visited-transition": Object.freeze({ version: BUILTIN_GENERATOR_VERSION, async select({ candidates, graph, random }: GeneratorContext) { const candidate = scoredCandidate(orderedCandidates(candidates), graph, "least-visited-transition", random); return candidate ? { kind: "candidate" as const, candidate } : { kind: "none" as const }; } }),
  "shortest-to-uncovered": Object.freeze({ version: BUILTIN_GENERATOR_VERSION, async select({ candidates, graph, random }: GeneratorContext) { const candidate = scoredCandidate(orderedCandidates(candidates), graph, "shortest-to-uncovered", random); return candidate ? { kind: "candidate" as const, candidate } : { kind: "none" as const }; } }),
  "risk-weighted-uncovered": Object.freeze({ version: BUILTIN_GENERATOR_VERSION, async select({ candidates, graph, random }: GeneratorContext) { const candidate = scoredCandidate(orderedCandidates(candidates), graph, "risk-weighted-uncovered", random); return candidate ? { kind: "candidate" as const, candidate } : { kind: "none" as const }; } }),
  "llm-select": Object.freeze({ version: BUILTIN_GENERATOR_VERSION, async select({ candidates, graph, llm }: GeneratorContext): Promise<GeneratorSelection> {
    if (!candidates.length) return { kind: "none" }; if (!llm) throw new Error("adaptive LLM selector is unavailable"); assertOpaqueCandidateIds(candidates); const ordered = orderedCandidates(candidates);
    const response = await llm.selectAdaptiveCandidate(ordered.map(candidate => candidate.candidateId), redactedGraphSummary(graph, ordered));
    if (response.decision.decision === "stop") return { kind: "stop", reason: "llm-stop", evidence: response.evidence };
    const selectedCandidateId = response.decision.candidateId; const candidate = ordered.find(value => value.candidateId === selectedCandidateId); if (!candidate) throw new Error("adaptive LLM selected an unoffered candidate ID"); return { kind: "candidate", candidate, evidence: response.evidence };
  } }),
} satisfies Record<AdaptiveGeneratorStrategy, GeneratorRegistryEntry>);
export function assertBuiltInGenerator(strategy: unknown, version?: unknown): asserts strategy is AdaptiveGeneratorStrategy {
  if (typeof strategy !== "string" || !Object.prototype.hasOwnProperty.call(registry, strategy)) throw new Error("adaptive generator strategy must reference a built-in generator");
  if (version !== undefined && version !== registry[strategy as AdaptiveGeneratorStrategy].version) throw new Error("adaptive generator version is not supported by the built-in registry");
}
export async function selectAdaptiveGenerator(strategy: AdaptiveGeneratorStrategy, context: GeneratorContext): Promise<GeneratorSelection> { assertBuiltInGenerator(strategy); return registry[strategy].select(context); }