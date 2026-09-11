import type { GraphEdge, GraphSnapshot } from "../adaptive/graph.js";
import { FINGERPRINT_ALGORITHM_VERSION, FINGERPRINT_CANONICALIZATION_VERSION } from "../adaptive/fingerprint.js";
import type { CoverageMetric, RunCoverageSummary } from "./types.js";
import { object, stringValue, integerValue, assertSafePublicValue, ratioValue, sortedRecord, type JsonObject } from "./catalog-values.js";

export const GRAPH_SCHEMA_VERSION = "lakda/state-graph/v1" as const;
const COVERAGE_SCHEMA_VERSION = "lakda/coverage-report/v1";
const edgeKinds = new Set(["action", "denied", "timeout", "recovery", "reset", "backtrack"]);
export const coverageKeys = [
  "stateCoverage",
  "actionCoverage",
  "transitionCoverage",
  "transitionPairCoverage",
  "roundTripCoverage",
  "obligationCoverage",
] as const;
export const coverageMetricKeys = ["state", "action", "transition", "transitionPair", "roundTrip", "obligation"] as const;
export const stateFieldNames = [
  "observationDigest",
  "componentSummary",
  "firstSeenAction",
  "lastSeenAction",
  "visits",
  "knownCandidateIds",
  "obligations",
] as const;

export type FingerprintContract = { algorithmVersion: string; canonicalizationVersion: string };
export type CanonicalState = {
  observationDigest?: string;
  componentSummary?: Record<string, string | number | boolean | null>;
  firstSeenAction: number;
  lastSeenAction: number;
  visits: number;
  knownCandidateIds: string[];
  obligations: Record<string, "met" | "unmet" | "unknown">;
};
export type ParsedGraph = {
  snapshot: GraphSnapshot;
  fingerprintContract: FingerprintContract;
  states: Map<string, CanonicalState>;
};
export type LoadedGraph = ParsedGraph & { coverage: RunCoverageSummary; roundTrips: string[] };
export function canonicalState(node: JsonObject, index: number): { fingerprint: string; state: CanonicalState } {
  const allowedKeys = new Set(["fingerprint", ...stateFieldNames]);
  const unknownKeys = Object.keys(node).filter(key => !allowedKeys.has(key));
  if (unknownKeys.length > 0) throw new Error("state graph node contains unsupported fields: " + unknownKeys.sort().join(","));
  const fingerprint = stringValue(node.fingerprint, "state graph node fingerprint");
  assertSafePublicValue(fingerprint, "state graph node fingerprint");
  const firstSeenAction = integerValue(node.firstSeenAction, "state graph node[" + index + "] firstSeenAction");
  const lastSeenAction = integerValue(node.lastSeenAction, "state graph node[" + index + "] lastSeenAction");
  if (lastSeenAction < firstSeenAction) throw new Error("state graph node lastSeenAction precedes firstSeenAction");
  const visits = integerValue(node.visits, "state graph node[" + index + "] visits", 1);
  if (!Array.isArray(node.knownCandidateIds)) throw new Error("state graph node knownCandidateIds must be an array");
  const knownCandidateIds = node.knownCandidateIds.map((value, candidateIndex) => stringValue(value, "state graph node knownCandidateIds[" + candidateIndex + "]")).sort();
  for (const candidateId of knownCandidateIds) assertSafePublicValue(candidateId, "state graph node candidate ID");
  if (new Set(knownCandidateIds).size !== knownCandidateIds.length) throw new Error("state graph node contains duplicate candidate IDs");
  const obligations = sortedRecord<"met" | "unmet" | "unknown">(node.obligations, "state graph node obligations", new Set(["met", "unmet", "unknown"]));
  const observationDigest = node.observationDigest === undefined ? undefined : stringValue(node.observationDigest, "state graph node observationDigest");
  if (observationDigest !== undefined && !/^[a-f0-9]{64}$/i.test(observationDigest)) throw new Error("state graph node observationDigest is invalid");
  const componentSummary = node.componentSummary === undefined
    ? undefined
    : sortedRecord(node.componentSummary, "state graph node componentSummary");
  return {
    fingerprint,
    state: {
      ...(observationDigest ? { observationDigest } : {}),
      ...(componentSummary ? { componentSummary } : {}),
      firstSeenAction,
      lastSeenAction,
      visits,
      knownCandidateIds,
      obligations,
    },
  };
}

export function fingerprintContract(graph: JsonObject): FingerprintContract {
  const algorithm = graph.fingerprintAlgorithmVersion;
  const canonicalization = graph.fingerprintCanonicalizationVersion;
  if ((algorithm === undefined) !== (canonicalization === undefined)) throw new Error("state graph fingerprint contract is incomplete");
  const result = algorithm === undefined
    ? { algorithmVersion: FINGERPRINT_ALGORITHM_VERSION, canonicalizationVersion: FINGERPRINT_CANONICALIZATION_VERSION }
    : {
        algorithmVersion: stringValue(algorithm, "state graph fingerprintAlgorithmVersion"),
        canonicalizationVersion: stringValue(canonicalization, "state graph fingerprintCanonicalizationVersion"),
      };
  if (result.algorithmVersion !== FINGERPRINT_ALGORITHM_VERSION) throw new Error("unsupported state graph fingerprint algorithm version");
  if (result.canonicalizationVersion !== FINGERPRINT_CANONICALIZATION_VERSION) throw new Error("unsupported state graph fingerprint canonicalization version");
  return result;
}

export function parseGraph(value: unknown): ParsedGraph {
  const current = object(value, "state graph");
  if (current.schemaVersion !== GRAPH_SCHEMA_VERSION) throw new Error("unsupported state graph schemaVersion: " + String(current.schemaVersion));
  if (current.model !== "discovered-model") throw new Error("state graph model is unsupported");
  integerValue(current.revision, "state graph revision");
  if (!Array.isArray(current.nodes) || !Array.isArray(current.edges) || !Array.isArray(current.transitionPairs)) throw new Error("state graph arrays are missing");
  const states = new Map<string, CanonicalState>();
  for (const [index, value] of current.nodes.entries()) {
    const parsed = canonicalState(object(value, "state graph node[" + index + "]"), index);
    if (states.has(parsed.fingerprint)) throw new Error("state graph contains a duplicate node");
    states.set(parsed.fingerprint, parsed.state);
  }
  const edgesById = new Map<string, { from: string; to?: string }>();
  for (const [index, value] of current.edges.entries()) {
    const edge = object(value, "state graph edge[" + index + "]");
    const from = stringValue(edge.from, "state graph edge from");
    const candidateId = stringValue(edge.candidateId, "state graph edge candidateId");
    assertSafePublicValue(candidateId, "state graph edge candidateId");
    const edgeKind = stringValue(edge.edgeKind, "state graph edge edgeKind");
    const to = edge.to === undefined ? undefined : stringValue(edge.to, "state graph edge to");
    if (!edgeKinds.has(edgeKind)) throw new Error("state graph edge kind is unsupported");
    integerValue(edge.count, "state graph edge count", 1);
    if (!states.has(from) || (to !== undefined && !states.has(to))) throw new Error("state graph edge references an unknown node");
    const key = transitionKey({ from, candidateId, edgeKind, ...(to ? { to } : {}) } as GraphEdge);
    if (edgesById.has(key)) throw new Error("state graph contains a duplicate edge");
    edgesById.set(key, { from, ...(to ? { to } : {}) });
  }
  const pairs = current.transitionPairs.map((entry, index) => stringValue(entry, "state graph transitionPairs[" + index + "]"));
  if (new Set(pairs).size !== pairs.length) throw new Error("state graph contains duplicate transition pairs");
  for (const pair of pairs) {
    const parts = pair.split("\u0001");
    if (parts.length !== 2) throw new Error("state graph transition pair format is invalid");
    const left = edgesById.get(parts[0]);
    const right = edgesById.get(parts[1]);
    if (!left || !right || !left.to || left.to !== right.from) throw new Error("state graph transition pair references disconnected or unknown edges");
  }
  return {
    snapshot: current as unknown as GraphSnapshot & { revision: number },
    fingerprintContract: fingerprintContract(current),
    states,
  };
}

export function coverageMetric(value: unknown, name: string): CoverageMetric {
  const current = object(value, name);
  const numerator = integerValue(current.numerator, name + " numerator");
  const denominator = integerValue(current.denominator, name + " denominator");
  if (numerator > denominator) throw new Error(name + " numerator exceeds denominator");
  const ratio = ratioValue(current.ratio, name + " ratio");
  const expectedRatio = denominator === 0 ? 0 : numerator / denominator;
  if (Math.abs(ratio - expectedRatio) > Number.EPSILON * 8) throw new Error(name + " ratio does not match numerator/denominator");
  return { numerator, denominator, ratio };
}

export function matchingRatio(value: unknown, expected: number, name: string): number {
  const ratio = ratioValue(value, name);
  if (Math.abs(ratio - expected) > Number.EPSILON * 8) throw new Error(name + " does not match detailed coverage metric");
  return ratio;
}

export function parseCoverage(value: unknown, graph: GraphSnapshot): RunCoverageSummary {
  const current = object(value, "coverage report");
  if (current.schemaVersion !== COVERAGE_SCHEMA_VERSION) throw new Error("unsupported coverage schemaVersion");
  if (integerValue(current.graphRevision, "coverage graphRevision") !== graph.revision) throw new Error("coverage graphRevision does not match state graph");
  if (integerValue(current.stateCount, "coverage stateCount") !== graph.nodes.length) throw new Error("coverage stateCount does not match state graph");
  if (integerValue(current.transitionCount, "coverage transitionCount") !== graph.edges.length) throw new Error("coverage transitionCount does not match state graph");
  if (integerValue(current.transitionPairCount, "coverage transitionPairCount") !== graph.transitionPairs.length) throw new Error("coverage transitionPairCount does not match state graph");
  const roundTrips = roundTripKeys(graph.edges);
  if (integerValue(current.roundTripCount, "coverage roundTripCount") !== roundTrips.length) throw new Error("coverage roundTripCount does not match state graph");
  const state = coverageMetric(current.state, "coverage state");
  const action = coverageMetric(current.action, "coverage action");
  const transition = coverageMetric(current.transition, "coverage transition");
  const transitionPair = coverageMetric(current.transitionPair, "coverage transitionPair");
  const roundTrip = coverageMetric(current.roundTrip, "coverage roundTrip");
  const obligation = coverageMetric(current.obligation, "coverage obligation");
  return {
    state,
    action,
    transition,
    transitionPair,
    roundTrip,
    obligation,
    stateCoverage: matchingRatio(current.stateCoverage, state.ratio, "coverage stateCoverage"),
    actionCoverage: matchingRatio(current.actionCoverage, action.ratio, "coverage actionCoverage"),
    transitionCoverage: matchingRatio(current.transitionCoverage, transition.ratio, "coverage transitionCoverage"),
    transitionPairCoverage: matchingRatio(current.transitionPairCoverage, transitionPair.ratio, "coverage transitionPairCoverage"),
    roundTripCoverage: matchingRatio(current.roundTripCoverage, roundTrip.ratio, "coverage roundTripCoverage"),
    obligationCoverage: matchingRatio(current.obligationCoverage, obligation.denominator === 0 ? 1 : obligation.ratio, "coverage obligationCoverage"),
  };
}

export function transitionKey(edge: Pick<GraphEdge, "from" | "candidateId" | "to" | "edgeKind">): string {
  return [edge.from, edge.candidateId, edge.to ?? "", edge.edgeKind].join("\u0000");
}

export function roundTripKeys(edges: GraphEdge[]): string[] {
  return edges
    .filter(edge => edge.to !== undefined && edges.some(reverse => reverse.from === edge.to && reverse.to === edge.from))
    .map(transitionKey)
    .sort();
}
