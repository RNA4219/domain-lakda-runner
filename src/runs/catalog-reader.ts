import { basename } from "node:path";
import { object, integerValue, parseJson, hateArtifact, parseRunSummary } from "./catalog-values.js";
import { readManifestSnapshot } from "./manifest-snapshot.js";
import { parseGraph, parseCoverage, roundTripKeys, type LoadedGraph } from "./catalog-graph.js";
import { RUN_DETAIL_SCHEMA_VERSION, type RunArtifactIntegrity, type RunDetail, type RunGraphSummary } from "./types.js";

export const METADATA_REF = "run-metadata.json";
const GRAPH_REF = "adaptive/transition-graph.json";
const COVERAGE_REF = "adaptive/coverage.json";
export type InspectedRun = {
  detail: RunDetail;
  graph?: LoadedGraph;
};
export async function inspectRun(runDir: string): Promise<InspectedRun> {
  const snapshot = await readManifestSnapshot(runDir, {
    retain: ref => [METADATA_REF, GRAPH_REF, COVERAGE_REF].includes(ref),
    policy: hateArtifact,
  });
  const { root, manifest, artifacts, manifestSha256, verifiedArtifactBytes } = snapshot;
  const runRef = basename(root);
  const bytesByPath = new Map<string, Buffer>();
  for (const [ref, artifact] of snapshot.snapshots) if (artifact.bytes) bytesByPath.set(ref, artifact.bytes);
  const metadataBytes = bytesByPath.get(METADATA_REF);
  if (!metadataBytes) throw new Error("HATE manifest does not cover run metadata");
  const metadataValue = parseJson(metadataBytes, "run metadata");
  const summary = parseRunSummary(metadataValue, runRef);
  const metadata = object(metadataValue, "run metadata");
  if (manifest.run_id !== summary.runId) throw new Error("HATE manifest run_id does not match metadata");
  if (manifest.run_attempt !== integerValue(metadata.attempt, "run metadata attempt", 1)) throw new Error("HATE manifest run_attempt does not match metadata");
  if (manifest.commit_sha !== summary.commitSha) throw new Error("HATE manifest commit_sha does not match metadata");
  const integrity: RunArtifactIntegrity = {
    status: "verified",
    manifestSha256,
    artifactCount: artifacts.length,
    verifiedArtifactBytes,
  };
  const hasGraph = bytesByPath.has(GRAPH_REF);
  const hasCoverage = bytesByPath.has(COVERAGE_REF);
  if (hasGraph !== hasCoverage) throw new Error("state graph and coverage must both be present in the HATE manifest");
  if (summary.mode === "adaptive-explore" && !hasGraph) throw new Error("adaptive run is missing verified state graph artifacts");
  let graph: LoadedGraph | undefined;
  let graphSummary: RunGraphSummary | undefined;
  if (hasGraph && hasCoverage) {
    const parsedGraph = parseGraph(parseJson(bytesByPath.get(GRAPH_REF)!, "state graph"));
    const { snapshot, fingerprintContract, states } = parsedGraph;
    const coverage = parseCoverage(parseJson(bytesByPath.get(COVERAGE_REF)!, "coverage report"), snapshot);
    const roundTrips = roundTripKeys(snapshot.edges);
    graph = { snapshot, fingerprintContract, states, coverage, roundTrips };
    graphSummary = {
      schemaVersion: snapshot.schemaVersion,
      fingerprintAlgorithmVersion: fingerprintContract.algorithmVersion,
      fingerprintCanonicalizationVersion: fingerprintContract.canonicalizationVersion,
      revision: snapshot.revision,
      stateCount: snapshot.nodes.length,
      transitionCount: snapshot.edges.length,
      transitionPairCount: snapshot.transitionPairs.length,
      roundTripCount: roundTrips.length,
      coverage,
    };
  }
  return {
    detail: {
      schemaVersion: RUN_DETAIL_SCHEMA_VERSION,
      run: summary,
      integrity,
      ...(graphSummary ? { graph: graphSummary } : {}),
    },
    ...(graph ? { graph } : {}),
  };
}
