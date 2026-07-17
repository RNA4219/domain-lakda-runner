import { join } from "node:path";
import { writeCanonicalJson, writeText } from "../core/artifact-store.js";
import type { ActionCandidate, CandidateClassification, CoverageDebt, Observation, OracleResult } from "./contracts.js";
import type { Coverage, CoveragePoint, GraphSnapshot } from "./graph.js";

export type AdaptiveTraceEntry = Record<string, unknown>;
export type AdaptiveEvidence = {
  seed: number;
  actions: number;
  outcome: string;
  terminationReason: string;
  observations: Observation[];
  candidateSnapshots: Array<{ observationId: string; candidates: ActionCandidate[]; coverageDebt: CoverageDebt[]; coverageDebtSummary: Record<string, number>; classification?: CandidateClassification }>;
  oracleResults: OracleResult[];
  trace: AdaptiveTraceEntry[];
  graph: GraphSnapshot;
  coverage: Coverage;
  coverageTimeline: CoveragePoint[];
  shrink: Record<string, unknown>;
};

function jsonLines(values: unknown[]): string {
  return values.map(value => JSON.stringify(value)).join("\n");
}

export async function writeAdaptiveEvidence(runDir: string, evidence: AdaptiveEvidence): Promise<void> {
  const root = join(runDir, "adaptive");
  const trace = {
    schemaVersion: "lakda/adaptive-trace/v1",
    seed: evidence.seed,
    actions: evidence.actions,
    outcome: evidence.outcome,
    terminationReason: evidence.terminationReason,
    trace: evidence.trace,
  };
  await Promise.all([
    writeText(join(root, "observations.jsonl"), jsonLines(evidence.observations)),
    writeText(join(root, "candidate-snapshots.jsonl"), jsonLines(evidence.candidateSnapshots.map(snapshot => ({
      schemaVersion: "lakda/candidate-snapshots/v1",
      ...snapshot,
    })))),
    writeText(join(root, "oracle-results.jsonl"), jsonLines(evidence.oracleResults)),
    writeCanonicalJson(join(root, "trace.json"), trace),
    // Kept for v0.2.x consumers. The payload is the canonical adaptive-trace/v1 document.
    writeCanonicalJson(join(root, "replay-trace.json"), trace),
    writeCanonicalJson(join(root, "transition-graph.json"), evidence.graph),
    writeCanonicalJson(join(root, "coverage.json"), {
      schemaVersion: "lakda/coverage-report/v1",
      actions: evidence.actions,
      ...evidence.coverage,
      timeline: evidence.coverageTimeline,
    }),
    writeCanonicalJson(join(root, "shrink-report.json"), {
      schemaVersion: "lakda/shrink-report/v1",
      ...evidence.shrink,
    }),
  ]);
}
