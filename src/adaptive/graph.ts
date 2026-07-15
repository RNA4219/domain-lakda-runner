import type { ActionCandidate, AdaptiveGeneratorStrategy, AdaptiveStopCondition, ExecutionResult, OracleResult, StateFingerprint } from "./contracts.js";

export type CoverageMetric = { numerator: number; denominator: number; ratio: number };
export type GraphNode = {
  fingerprint: string;
  observationDigest?: string;
  componentSummary?: StateFingerprint["componentSummary"];
  firstSeenAction: number;
  lastSeenAction: number;
  visits: number;
  knownCandidateIds: string[];
  obligations: Record<string, "met" | "unmet" | "unknown">;
};
export type GraphEdgeKind = "action" | "denied" | "timeout" | "recovery" | "reset" | "backtrack";
export type GraphEdge = {
  from: string;
  candidateId: string;
  edgeKind: GraphEdgeKind;
  to?: string;
  count: number;
  statuses: Record<string, number>;
  failureSignatures: string[];
  oracleRefs: string[];
  evidenceArtifactIds: string[];
  latencyMs: { count: number; total: number; min: number; max: number };
};
export type GraphSnapshot = {
  schemaVersion: "lakda/state-graph/v1";
  model: "discovered-model";
  revision: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  transitionPairs: string[];
  offeredCandidateIds: string[];
  executedCandidateIds: string[];
};
export type Coverage = {
  model: "discovered-model";
  openWorld: true;
  graphRevision: number;
  discoveredStateCount: number;
  newStateCount: number;
  novelStateRate: number;
  state: CoverageMetric;
  action: CoverageMetric;
  transition: CoverageMetric;
  transitionPair: CoverageMetric;
  roundTrip: CoverageMetric;
  obligation: CoverageMetric;
  stateCoverage: number;
  actionCoverage: number;
  transitionCoverage: number;
  transitionPairCoverage: number;
  roundTripCoverage: number;
  obligationCoverage: number;
  stateCount: number;
  transitionCount: number;
  transitionPairCount: number;
  roundTripCount: number;
};
export type CoveragePoint = { actionIndex: number; graphRevision: number; coverage: Coverage };
export type StopDecision = { stop: boolean; reason?: string; matchedConditions: string[]; coverage: Coverage };

const actionKey = (from: string, candidateId: string): string => `${from}\u0000${candidateId}`;
const edgeKey = (from: string, candidateId: string, to: string | undefined, edgeKind: GraphEdgeKind): string => `${from}\u0000${candidateId}\u0000${to ?? ""}\u0000${edgeKind}`;
const executionEdgeKind = (status: ExecutionResult["status"]): GraphEdgeKind => status === "denied" ? "denied" : status === "timeout" ? "timeout" : "action";
const pairKey = (left: string, right: string): string => `${left}\u0001${right}`;
const metric = (numerator: number, denominator: number): CoverageMetric => ({
  numerator,
  denominator,
  ratio: denominator > 0 ? numerator / denominator : 0,
});
const elapsed = (result: ExecutionResult): number => {
  const started = Date.parse(result.startedAt);
  const ended = Date.parse(result.endedAt);
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
};

export class StateGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly offeredActions = new Set<string>();
  private readonly offeredCandidateIds = new Set<string>();
  private readonly executedActions = new Set<string>();
  private readonly executedCandidateIds = new Set<string>();
  private readonly transitionPairs = new Set<string>();
  private readonly history: CoveragePoint[] = [];
  private lastTransition: string | undefined;
  private lastNovelAction = 0;
  private revision = 0;
  private actionCount = 0;

  recordState(fingerprint: StateFingerprint, obligations: GraphNode["obligations"], actionIndex: number): boolean {
    return this.upsertState(fingerprint.value, obligations, actionIndex, fingerprint);
  }

  recordFingerprint(value: string, obligations: GraphNode["obligations"], actionIndex: number): boolean {
    return this.upsertState(value, obligations, actionIndex);
  }

  private upsertState(value: string, obligations: GraphNode["obligations"], actionIndex: number, fingerprint?: StateFingerprint): boolean {
    const current = this.nodes.get(value);
    if (!current) {
      this.nodes.set(value, {
        fingerprint: value,
        ...(fingerprint ? { observationDigest: fingerprint.observationDigest, componentSummary: { ...fingerprint.componentSummary } } : {}),
        firstSeenAction: actionIndex,
        lastSeenAction: actionIndex,
        visits: 1,
        knownCandidateIds: [],
        obligations: { ...obligations },
      });
      this.revision += 1;
      this.lastNovelAction = actionIndex;
      return true;
    }

    current.visits += 1;
    current.lastSeenAction = Math.max(current.lastSeenAction, actionIndex);
    let obligationChanged = false;
    for (const [id, status] of Object.entries(obligations)) {
      if (current.obligations[id] !== status) {
        current.obligations[id] = status;
        obligationChanged = true;
      }
    }
    if (obligationChanged) {
      this.revision += 1;
      this.lastNovelAction = actionIndex;
    }
    return false;
  }

  recordOffered(candidates: ActionCandidate[], actionIndex = 0): void {
    for (const candidate of candidates) {
      this.offeredCandidateIds.add(candidate.candidateId);
      const key = actionKey(candidate.sourceFingerprint, candidate.candidateId);
      const isNew = !this.offeredActions.has(key);
      this.offeredActions.add(key);
      const node = this.nodes.get(candidate.sourceFingerprint);
      if (node && !node.knownCandidateIds.includes(candidate.candidateId)) {
        node.knownCandidateIds.push(candidate.candidateId);
        node.knownCandidateIds.sort();
        node.lastSeenAction = Math.max(node.lastSeenAction, actionIndex);
      }
      if (isNew) {
        this.revision += 1;
        this.lastNovelAction = actionIndex;
      }
    }
  }

  recordTransition(from: string, candidate: ActionCandidate, result: ExecutionResult, to?: string, actionIndex = 0): boolean {
    this.actionCount = Math.max(this.actionCount, actionIndex);
    this.executedActions.add(actionKey(from, candidate.candidateId));
    this.executedCandidateIds.add(candidate.candidateId);
    const edgeKind = executionEdgeKind(result.status);
    const key = edgeKey(from, candidate.candidateId, to, edgeKind);
    const duration = elapsed(result);
    const existing = this.edges.get(key);
    const edge = existing ?? {
      from,
      candidateId: candidate.candidateId,
      edgeKind,
      ...(to ? { to } : {}),
      count: 0,
      statuses: {},
      failureSignatures: [],
      oracleRefs: [],
      evidenceArtifactIds: [],
      latencyMs: { count: 0, total: 0, min: duration, max: duration },
    };
    edge.count += 1;
    edge.statuses[result.status] = (edge.statuses[result.status] ?? 0) + 1;
    if (result.failureSignature && !edge.failureSignatures.includes(result.failureSignature)) edge.failureSignatures.push(result.failureSignature);
    for (const ref of result.evidenceRefs) if (!edge.evidenceArtifactIds.includes(ref.artifactId)) edge.evidenceArtifactIds.push(ref.artifactId);
    edge.failureSignatures.sort();
    edge.evidenceArtifactIds.sort();
    edge.latencyMs.count += 1;
    edge.latencyMs.total += duration;
    edge.latencyMs.min = Math.min(edge.latencyMs.min, duration);
    edge.latencyMs.max = Math.max(edge.latencyMs.max, duration);
    this.edges.set(key, edge);

    const previous = this.lastTransition ? this.edges.get(this.lastTransition) : undefined;
    if (previous?.to === from && this.lastTransition) {
      const transitionPair = pairKey(this.lastTransition, key);
      if (!this.transitionPairs.has(transitionPair)) this.lastNovelAction = actionIndex;
      this.transitionPairs.add(transitionPair);
    }
    this.lastTransition = key;
    this.revision += 1;
    if (!existing) this.lastNovelAction = actionIndex;
    const coverage = this.coverage();
    this.history.push({ actionIndex, graphRevision: coverage.graphRevision, coverage });
    return !existing;
  }

  recordControlTransition(input: {
    from: string; candidateId: string; to?: string; edgeKind: "recovery" | "reset" | "backtrack";
    status: "recovered" | "not_recovered" | "diverged"; failureSignature?: string; evidenceArtifactIds?: string[]; actionIndex?: number;
  }): boolean {
    const actionIndex = input.actionIndex ?? this.actionCount;
    const key = edgeKey(input.from, input.candidateId, input.to, input.edgeKind);
    const existing = this.edges.get(key);
    const edge = existing ?? {
      from: input.from, candidateId: input.candidateId, edgeKind: input.edgeKind, ...(input.to ? { to: input.to } : {}),
      count: 0, statuses: {}, failureSignatures: [], oracleRefs: [], evidenceArtifactIds: [],
      latencyMs: { count: 0, total: 0, min: 0, max: 0 },
    };
    edge.count += 1;
    edge.statuses[input.status] = (edge.statuses[input.status] ?? 0) + 1;
    if (input.failureSignature && !edge.failureSignatures.includes(input.failureSignature)) edge.failureSignatures.push(input.failureSignature);
    for (const artifactId of input.evidenceArtifactIds ?? []) if (!edge.evidenceArtifactIds.includes(artifactId)) edge.evidenceArtifactIds.push(artifactId);
    edge.failureSignatures.sort(); edge.evidenceArtifactIds.sort();
    this.edges.set(key, edge);
    const previous = this.lastTransition ? this.edges.get(this.lastTransition) : undefined;
    if (previous?.to === input.from && this.lastTransition) this.transitionPairs.add(pairKey(this.lastTransition, key));
    this.lastTransition = key; this.revision += 1;
    if (!existing) this.lastNovelAction = actionIndex;
    const coverage = this.coverage(); this.history.push({ actionIndex, graphRevision: coverage.graphRevision, coverage });
    return !existing;
  }

  recordOracleResults(from: string, candidateId: string, to: string | undefined, results: OracleResult[], status?: ExecutionResult["status"]): void {
    const edgeKind = status ? executionEdgeKind(status) : undefined;
    const matches = [...this.edges.values()].filter(edge => edge.from === from && edge.candidateId === candidateId && edge.to === to && (!edgeKind || edge.edgeKind === edgeKind));
    if (matches.length !== 1) throw new Error("cannot attach oracle results to an unknown or ambiguous graph edge");
    const edge = matches[0];
    for (const result of results) if (!edge.oracleRefs.includes(result.oracleId)) edge.oracleRefs.push(result.oracleId);
    edge.oracleRefs.sort();
  }

  visits(fingerprint: string): number { return this.nodes.get(fingerprint)?.visits ?? 0; }

  transitionVisits(from: string, candidateId: string): number {
    return [...this.edges.values()]
      .filter(edge => edge.from === from && edge.candidateId === candidateId)
      .reduce((sum, edge) => sum + edge.count, 0);
  }

  uncovered(candidates: ActionCandidate[]): ActionCandidate[] {
    return candidates.filter(candidate => !this.executedActions.has(actionKey(candidate.sourceFingerprint, candidate.candidateId)));
  }

  coverage(): Coverage {
    const edges = [...this.edges.entries()];
    const obligations = [...this.nodes.values()].flatMap(node => Object.values(node.obligations));
    const possiblePairs = new Set<string>();
    for (const [leftKey, left] of edges) {
      if (!left.to) continue;
      for (const [rightKey, right] of edges) if (right.from === left.to) possiblePairs.add(pairKey(leftKey, rightKey));
    }
    const observedPairs = [...this.transitionPairs].filter(value => possiblePairs.has(value)).length;
    const roundTrips = edges.filter(([, edge]) => edge.to && edges.some(([, reverse]) => reverse.from === edge.to && reverse.to === edge.from)).length;
    const state = metric(this.nodes.size, this.nodes.size);
    const action = metric(this.executedActions.size, this.offeredActions.size);
    const transition = metric(this.executedActions.size, this.offeredActions.size);
    const transitionPair = metric(observedPairs, possiblePairs.size);
    const roundTrip = metric(roundTrips, this.edges.size);
    const obligation = metric(obligations.filter(value => value === "met").length, obligations.length);
    const novelStateRate = this.nodes.size / Math.max(1, this.actionCount + 1);
    return {
      model: "discovered-model",
      openWorld: true,
      graphRevision: this.revision,
      discoveredStateCount: this.nodes.size,
      newStateCount: this.nodes.size,
      novelStateRate,
      state,
      action,
      transition,
      transitionPair,
      roundTrip,
      obligation,
      stateCoverage: state.ratio,
      actionCoverage: action.ratio,
      transitionCoverage: transition.ratio,
      transitionPairCoverage: transitionPair.ratio,
      roundTripCoverage: roundTrip.ratio,
      obligationCoverage: obligation.denominator ? obligation.ratio : 1,
      stateCount: this.nodes.size,
      transitionCount: this.edges.size,
      transitionPairCount: observedPairs,
      roundTripCount: roundTrips,
    };
  }

  coverageTimeline(): CoveragePoint[] {
    return this.history.map(point => ({ actionIndex: point.actionIndex, graphRevision: point.graphRevision, coverage: { ...point.coverage } }));
  }

  choose(candidates: ActionCandidate[], strategy: AdaptiveGeneratorStrategy, random: () => number): ActionCandidate | undefined {
    if (!candidates.length) return undefined;
    const ordered = [...candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    if (strategy === "random" || strategy === "llm-select") return ordered[Math.floor(random() * ordered.length)];
    if (strategy === "weighted-random") {
      const weights = ordered.map(candidate => Number.isFinite(candidate.risk.weight) ? Math.max(0, candidate.risk.weight) : 0);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      if (total === 0) return ordered[Math.floor(random() * ordered.length)];
      const draw = random() * total;
      let cumulative = 0;
      for (let index = 0; index < ordered.length; index += 1) {
        cumulative += weights[index];
        if (draw < cumulative) return ordered[index];
      }
      return ordered.at(-1);
    }
    const scored = ordered.map(candidate => {
      const transitionVisits = this.transitionVisits(candidate.sourceFingerprint, candidate.candidateId);
      const stateVisits = this.visits(candidate.sourceFingerprint);
      const unseen = this.executedActions.has(actionKey(candidate.sourceFingerprint, candidate.candidateId)) ? 0 : 1;
      const score = strategy === "least-visited-transition" ? -transitionVisits
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
    const anyMatches = (conditions.any ?? []).filter(matches).map(condition => condition.type);
    if (anyMatches.length) return { stop: true, reason: `any:${anyMatches.join("+")}`, matchedConditions: anyMatches, coverage };
    const all = conditions.all ?? [];
    if (all.length && all.every(matches)) {
      const allMatches = all.map(condition => condition.type);
      return { stop: true, reason: `all:${allMatches.join("+")}`, matchedConditions: allMatches, coverage };
    }
    return { stop: false, matchedConditions: [], coverage };
  }

  snapshot(): GraphSnapshot {
    return {
      schemaVersion: "lakda/state-graph/v1",
      model: "discovered-model",
      revision: this.revision,
      nodes: [...this.nodes.values()].map(node => ({
        ...node,
        knownCandidateIds: [...node.knownCandidateIds],
        obligations: { ...node.obligations },
        ...(node.componentSummary ? { componentSummary: { ...node.componentSummary } } : {}),
      })).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
      edges: [...this.edges.values()].map(edge => ({
        ...edge,
        statuses: { ...edge.statuses },
        failureSignatures: [...edge.failureSignatures],
        oracleRefs: [...edge.oracleRefs],
        evidenceArtifactIds: [...edge.evidenceArtifactIds],
        latencyMs: { ...edge.latencyMs },
      })).sort((left, right) => edgeKey(left.from, left.candidateId, left.to, left.edgeKind).localeCompare(edgeKey(right.from, right.candidateId, right.to, right.edgeKind))),
      transitionPairs: [...this.transitionPairs].sort(),
      offeredCandidateIds: [...this.offeredCandidateIds].sort(),
      executedCandidateIds: [...this.executedCandidateIds].sort(),
    };
  }
}
