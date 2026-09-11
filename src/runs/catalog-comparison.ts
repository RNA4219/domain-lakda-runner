import type { GraphEdge } from "../adaptive/graph.js";
import type { CountChange, CoverageMetric, CoverageValueComparison, RunComparison, SetComparison, StateComparison, TransitionComparison } from "./types.js";
import { RUN_COMPARISON_SCHEMA_VERSION } from "./types.js";
import { GRAPH_SCHEMA_VERSION, coverageKeys, coverageMetricKeys, stateFieldNames, transitionKey, type CanonicalState } from "./catalog-graph.js";
import type { InspectedRun } from "./catalog-reader.js";

function compareSet(baseValues: Iterable<string>, headValues: Iterable<string>): SetComparison {
  const base = new Set(baseValues);
  const head = new Set(headValues);
  const added = [...head].filter(value => !base.has(value)).sort();
  const removed = [...base].filter(value => !head.has(value)).sort();
  const commonCount = [...base].filter(value => head.has(value)).length;
  return {
    baseCount: base.size,
    headCount: head.size,
    delta: head.size - base.size,
    commonCount,
    added,
    removed,
  };
}

function compareStates(base: Map<string, CanonicalState>, head: Map<string, CanonicalState>): StateComparison {
  const comparison = compareSet(base.keys(), head.keys());
  const changed = [...base.keys()]
    .filter(fingerprint => head.has(fingerprint))
    .sort()
    .flatMap(fingerprint => {
      const baseState = base.get(fingerprint)!;
      const headState = head.get(fingerprint)!;
      const changedFields = stateFieldNames
        .filter(field => JSON.stringify(baseState[field]) !== JSON.stringify(headState[field]))
        .sort();
      return changedFields.length === 0 ? [] : [{ fingerprint, changedFields }];
    });
  return { ...comparison, changed };
}

function compareTransitions(baseEdges: GraphEdge[], headEdges: GraphEdge[]): TransitionComparison {
  const base = new Map(baseEdges.map(edge => [transitionKey(edge), edge.count]));
  const head = new Map(headEdges.map(edge => [transitionKey(edge), edge.count]));
  const comparison = compareSet(base.keys(), head.keys());
  const countChanges: CountChange[] = [...base.keys()]
    .filter(key => head.has(key) && base.get(key) !== head.get(key))
    .sort()
    .map(key => {
      const baseCount = base.get(key)!;
      const headCount = head.get(key)!;
      return { key, base: baseCount, head: headCount, delta: headCount - baseCount };
    });
  return { ...comparison, countChanges };
}

function coverageComparison(base: number, head: number): CoverageValueComparison {
  return { base, head, delta: head - base };
}

function coverageMetricComparison(base: CoverageMetric, head: CoverageMetric): RunComparison["coverage"]["state"] {
  return {
    numerator: coverageComparison(base.numerator, head.numerator),
    denominator: coverageComparison(base.denominator, head.denominator),
    ratio: coverageComparison(base.ratio, head.ratio),
  };
}

export function compareInspectedRuns(base: InspectedRun, head: InspectedRun): RunComparison {
  if (!base.graph || !head.graph) throw new Error("runs compare requires verified adaptive state graph artifacts");
  if (base.graph.snapshot.schemaVersion !== head.graph.snapshot.schemaVersion) throw new Error("state graph schemaVersion mismatch");
  if (base.graph.snapshot.schemaVersion !== GRAPH_SCHEMA_VERSION) throw new Error("unsupported state graph schemaVersion");
  if (base.graph.fingerprintContract.algorithmVersion !== head.graph.fingerprintContract.algorithmVersion) throw new Error("state graph fingerprint algorithm version mismatch");
  if (base.graph.fingerprintContract.canonicalizationVersion !== head.graph.fingerprintContract.canonicalizationVersion) throw new Error("state graph fingerprint canonicalization version mismatch");
  const legacyCoverage = Object.fromEntries(coverageKeys.map(key => [key, coverageComparison(base.graph!.coverage[key], head.graph!.coverage[key])])) as Pick<RunComparison["coverage"], typeof coverageKeys[number]>;
  const metricCoverage = Object.fromEntries(coverageMetricKeys.map(key => [key, coverageMetricComparison(base.graph!.coverage[key], head.graph!.coverage[key])])) as Pick<RunComparison["coverage"], typeof coverageMetricKeys[number]>;
  const coverage: RunComparison["coverage"] = { ...metricCoverage, ...legacyCoverage };
  return {
    schemaVersion: RUN_COMPARISON_SCHEMA_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    fingerprintAlgorithmVersion: base.graph.fingerprintContract.algorithmVersion,
    fingerprintCanonicalizationVersion: base.graph.fingerprintContract.canonicalizationVersion,
    base: { run: base.detail.run, integrity: base.detail.integrity },
    head: { run: head.detail.run, integrity: head.detail.integrity },
    states: compareStates(base.graph.states, head.graph.states),
    transitions: compareTransitions(base.graph.snapshot.edges, head.graph.snapshot.edges),
    transitionPairs: compareSet(base.graph.snapshot.transitionPairs, head.graph.snapshot.transitionPairs),
    roundTrips: compareSet(base.graph.roundTrips, head.graph.roundTrips),
    coverage,
    outcome: { base: base.detail.run.outcome, head: head.detail.run.outcome, changed: base.detail.run.outcome !== head.detail.run.outcome },
    terminationReason: { base: base.detail.run.terminationReason, head: head.detail.run.terminationReason, changed: base.detail.run.terminationReason !== head.detail.run.terminationReason },
  };
}
