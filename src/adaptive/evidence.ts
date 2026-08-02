import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileDigest, writeCanonicalJson, writeText } from "../core/artifact-store.js";
import type { ActionCandidate, CandidateClassification, CoverageDebt, EvidenceArtifactRef, Observation, OracleResult } from "./contracts.js";
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

export async function verifyEvidenceArtifactRefs(
  refs: EvidenceArtifactRef[],
  runDir: string,
  options: { requireScreenshot?: boolean; requireVerifiedScreenshot?: boolean } = {},
): Promise<void> {
  const root = resolve(runDir);
  const rootPhysical = await realpath(root);
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const screenshots = refs.filter(ref => /\.(?:png|jpe?g)$/i.test(ref.path));
  if (options.requireScreenshot && screenshots.length === 0) throw new Error("evidence screenshot artifact ref is empty");
  for (const ref of refs) {
    if (seenIds.has(ref.artifactId) || seenPaths.has(ref.path)) throw new Error("evidence artifact ref is duplicated");
    seenIds.add(ref.artifactId);
    seenPaths.add(ref.path);
    if (!ref.path || isAbsolute(ref.path) || ref.path.includes("\\")) throw new Error("evidence artifact path is not portable");
    const absolute = resolve(root, ref.path);
    const lexical = relative(root, absolute);
    if (!lexical || isAbsolute(lexical) || lexical.split(/[\\/]/).some(part => part === ".." || part === ".")) throw new Error("evidence artifact path is outside run directory");
    if (lexical.replaceAll("\\", "/") !== ref.path) throw new Error("evidence artifact path is not canonical");
    let cursor = root;
    for (const part of lexical.split(/[\\/]/)) {
      cursor = resolve(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error("evidence artifact path contains a symlink/reparse point");
    }
    const physical = await realpath(absolute);
    const physicalRelative = relative(rootPhysical, physical);
    if (!physicalRelative || isAbsolute(physicalRelative) || physicalRelative.split(/[\\/]/).some(part => part === "..")) throw new Error("evidence artifact physical path is outside run directory");
    if (!(await lstat(absolute)).isFile()) throw new Error("evidence artifact is not a regular file");
    const digest = await fileDigest(absolute);
    if (digest.size !== ref.size || digest.sha256 !== ref.sha256.replace(/^sha256:/, "")) throw new Error("evidence artifact digest mismatch");
    if (ref.redactionStatus === "failed" || ref.securityStatus === "fail") throw new Error("evidence artifact security failed");
  }
  if (options.requireVerifiedScreenshot && screenshots.some(ref => ref.redactionStatus !== "redacted" || ref.securityStatus !== "pass")) throw new Error("evidence screenshot artifact security status is not verified");
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
