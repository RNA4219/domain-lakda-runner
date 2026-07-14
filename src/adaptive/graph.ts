import type { ActionCandidate, AdaptiveGeneratorStrategy, AdaptiveStopCondition, ExecutionResult, StateFingerprint } from "./contracts.js";

export type GraphNode = { fingerprint: string; visits: number; obligations: Record<string, "met" | "unmet" | "unknown"> };
export type GraphEdge = { from: string; candidateId: string; to?: string; count: number; statuses: Record<string, number> };
export type GraphSnapshot = { schemaVersion: "lakda/state-graph/v1"; nodes: GraphNode[]; edges: GraphEdge[]; transitionPairs: string[]; offeredCandidateIds: string[]; executedCandidateIds: string[] };
export type Coverage = { stateCoverage: number; actionCoverage: number; transitionCoverage: number; transitionPairCoverage: number; roundTripCoverage: number; obligationCoverage: number; stateCount: number; transitionCount: number; transitionPairCount: number; roundTripCount: number };
export type StopDecision = { stop: boolean; reason?: string; coverage: Coverage };

export class StateGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly offered = new Set<string>();
  private readonly executed = new Set<string>();
  private readonly transitionPairs = new Set<string>();
  private lastTransition: string | undefined;
  private lastNovelAction = 0;

  recordState(fingerprint: StateFingerprint, obligations: GraphNode["obligations"], actionIndex: number): boolean {
    return this.recordFingerprint(fingerprint.value, obligations, actionIndex);
  }

  recordFingerprint(value: string, obligations: GraphNode["obligations"], actionIndex: number): boolean {
    const current = this.nodes.get(value);
    if (current) { current.visits += 1; return false; }
    this.nodes.set(value, { fingerprint: value, visits: 1, obligations: { ...obligations } });
    this.lastNovelAction = actionIndex;
    return true;
  }

  recordOffered(candidates: ActionCandidate[]): void { candidates.forEach(candidate => this.offered.add(candidate.candidateId)); }

  recordTransition(from: string, candidate: ActionCandidate, result: ExecutionResult, to?: string, actionIndex = 0): boolean {
    this.executed.add(candidate.candidateId);
    const key = `${from}\u0000${candidate.candidateId}\u0000${to ?? ""}`;
    const edge = this.edges.get(key) ?? { from, candidateId: candidate.candidateId, ...(to ? { to } : {}), count: 0, statuses: {} };
    const novel = !this.edges.has(key);
    edge.count += 1; edge.statuses[result.status] = (edge.statuses[result.status] ?? 0) + 1;
    this.edges.set(key, edge);
    if (this.lastTransition) this.transitionPairs.add(`${this.lastTransition}\u0000${key}`);
    this.lastTransition = key;
    if (novel) this.lastNovelAction = actionIndex;
    return novel;
  }

  visits(fingerprint: string): number { return this.nodes.get(fingerprint)?.visits ?? 0; }
  transitionVisits(from: string, candidateId: string): number { return [...this.edges.values()].filter(edge => edge.from === from && edge.candidateId === candidateId).reduce((sum, edge) => sum + edge.count, 0); }
  uncovered(candidates: ActionCandidate[]): ActionCandidate[] { return candidates.filter(candidate => !this.executed.has(candidate.candidateId)); }

  coverage(): Coverage {
    const obligations = [...this.nodes.values()].flatMap(node => Object.values(node.obligations));
    const roundTrips = [...this.edges.values()].filter(edge => edge.to && [...this.edges.values()].some(reverse => reverse.from === edge.to && reverse.to === edge.from)).length;
    return {
      // Dynamic exploration has no complete predeclared state universe; counts make this explicit.
      stateCoverage: this.nodes.size ? 1 : 0,
      actionCoverage: this.offered.size ? this.executed.size / this.offered.size : 0,
      transitionCoverage: this.offered.size ? this.edges.size / this.offered.size : 0,
      transitionPairCoverage: this.edges.size > 1 ? this.transitionPairs.size / (this.edges.size - 1) : 0,
      roundTripCoverage: this.edges.size ? roundTrips / this.edges.size : 0,
      obligationCoverage: obligations.length ? obligations.filter(value => value === "met").length / obligations.length : 1,
      stateCount: this.nodes.size,
      transitionCount: this.edges.size,
      transitionPairCount: this.transitionPairs.size,
      roundTripCount: roundTrips,
    };
  }

  choose(candidates: ActionCandidate[], strategy: AdaptiveGeneratorStrategy, random: () => number): ActionCandidate | undefined {
    if (!candidates.length) return undefined;
    const ordered = [...candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    if (strategy === "random" || strategy === "llm-select") return ordered[Math.floor(random() * ordered.length)];
    const scored = ordered.map(candidate => {
      const transitionVisits = this.transitionVisits(candidate.sourceFingerprint, candidate.candidateId);
      const stateVisits = this.visits(candidate.sourceFingerprint);
      const unseen = this.executed.has(candidate.candidateId) ? 0 : 1;
      const score = strategy === "weighted-random" ? candidate.risk.weight * (0.5 + random())
        : strategy === "least-visited-transition" ? -transitionVisits
          : strategy === "shortest-to-uncovered" ? unseen * 10_000 - stateVisits * 10 - transitionVisits
            : unseen * candidate.risk.weight * 100 - transitionVisits;
      return { candidate, score };
    });
    const max = Math.max(...scored.map(value => value.score));
    const tied = scored.filter(value => value.score === max);
    return tied[Math.floor(random() * tied.length)].candidate;
  }

  stop(conditions: { any?: AdaptiveStopCondition[]; all?: AdaptiveStopCondition[] }, actionCount: number, elapsedMs: number): StopDecision {
    const coverage = this.coverage();
    const matches = (condition: AdaptiveStopCondition): boolean => {
      if (condition.type === "noveltyPlateau") return actionCount >= condition.minActions && actionCount - this.lastNovelAction >= condition.windowActions;
      if (condition.type === "durationMs") return elapsedMs >= condition.atMost;
      return coverage[condition.type] >= condition.atLeast;
    };
    if (conditions.any?.some(matches)) return { stop: true, reason: "any-condition", coverage };
    if (conditions.all?.length && conditions.all.every(matches)) return { stop: true, reason: "all-condition", coverage };
    return { stop: false, coverage };
  }

  snapshot(): GraphSnapshot {
    return { schemaVersion: "lakda/state-graph/v1", nodes: [...this.nodes.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)), edges: [...this.edges.values()].sort((a, b) => `${a.from}\u0000${a.candidateId}\u0000${a.to ?? ""}`.localeCompare(`${b.from}\u0000${b.candidateId}\u0000${b.to ?? ""}`)), transitionPairs: [...this.transitionPairs].sort(), offeredCandidateIds: [...this.offered].sort(), executedCandidateIds: [...this.executed].sort() };
  }
}
