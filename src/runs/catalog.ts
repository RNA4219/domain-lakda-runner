import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { assertHateManifest } from "../core/hate.js";
import { findSensitive, sha256 } from "../core/redaction.js";
import type { GraphEdge, GraphSnapshot } from "../adaptive/graph.js";
import {
  FINGERPRINT_ALGORITHM_VERSION,
  FINGERPRINT_CANONICALIZATION_VERSION,
} from "../adaptive/fingerprint.js";
import type {
  CountChange,
  CoverageMetric,
  CoverageValueComparison,
  RunArtifactIntegrity,
  RunComparison,
  RunCoverageSummary,
  RunDetail,
  RunGraphSummary,
  RunIndex,
  RunSummary,
  SetComparison,
  StateComparison,
  TransitionComparison,
} from "./types.js";
import {
  RUN_COMPARISON_SCHEMA_VERSION,
  RUN_DETAIL_SCHEMA_VERSION,
  RUN_INDEX_SCHEMA_VERSION,
} from "./types.js";

const RUN_LIMIT = 100;
const MANIFEST_REF = "exports/artifact-manifest.json";
const METADATA_REF = "run-metadata.json";
const GRAPH_REF = "adaptive/transition-graph.json";
const COVERAGE_REF = "adaptive/coverage.json";
const GRAPH_SCHEMA_VERSION = "lakda/state-graph/v1" as const;
const COVERAGE_SCHEMA_VERSION = "lakda/coverage-report/v1";
const outcomes = new Set(["passed", "failed", "partial", "error"]);
const edgeKinds = new Set(["action", "denied", "timeout", "recovery", "reset", "backtrack"]);
const coverageKeys = [
  "stateCoverage",
  "actionCoverage",
  "transitionCoverage",
  "transitionPairCoverage",
  "roundTripCoverage",
  "obligationCoverage",
] as const;
const coverageMetricKeys = ["state", "action", "transition", "transitionPair", "roundTrip", "obligation"] as const;
const stateFieldNames = [
  "observationDigest",
  "componentSummary",
  "firstSeenAction",
  "lastSeenAction",
  "visits",
  "knownCandidateIds",
  "obligations",
] as const;

type JsonObject = Record<string, unknown>;
type HateArtifact = {
  path: string;
  sha256: string;
  size_bytes: number;
  redaction_status: string;
  public_exposure: string;
  security_checks: { secrets_scan?: unknown; pii_scan?: unknown };
};
type FingerprintContract = { algorithmVersion: string; canonicalizationVersion: string };
type CanonicalState = {
  observationDigest?: string;
  componentSummary?: Record<string, string | number | boolean | null>;
  firstSeenAction: number;
  lastSeenAction: number;
  visits: number;
  knownCandidateIds: string[];
  obligations: Record<string, "met" | "unmet" | "unknown">;
};
type ParsedGraph = {
  snapshot: GraphSnapshot;
  fingerprintContract: FingerprintContract;
  states: Map<string, CanonicalState>;
};
type LoadedGraph = ParsedGraph & { coverage: RunCoverageSummary; roundTrips: string[] };
type InspectedRun = {
  detail: RunDetail;
  graph?: LoadedGraph;
};

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(name + " must be an object");
  return value as JsonObject;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(name + " must be a non-empty string");
  return value;
}

function integerValue(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(name + " must be an integer >= " + minimum);
  return value as number;
}

function dateValue(value: unknown, name: string): string {
  const current = stringValue(value, name);
  if (Number.isNaN(Date.parse(current))) throw new Error(name + " must be an ISO date-time");
  return current;
}

function assertSafePublicValue(value: string, name: string): void {
  if (findSensitive(value).length > 0) throw new Error(name + " contains sensitive data");
  if (isAbsolute(value) || /^file:\/\//i.test(value)) throw new Error(name + " contains an absolute path");
}

function ratioValue(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(name + " must be a ratio from 0 to 1");
  return value;
}

function parseJson(bytes: Buffer, name: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(name + " is not valid JSON");
  }
}

function isContained(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith(".." + sep) && value !== ".." && !isAbsolute(value));
}

function assertPortableArtifactRef(ref: string): void {
  if (
    ref.length === 0
    || ref.includes("\\")
    || ref.includes("\0")
    || ref.startsWith("/")
    || /^[A-Za-z]:/.test(ref)
    || ref.split("/").some(segment => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("HATE artifact path is not portable: " + ref);
  }
}

async function secureArtifactFile(root: string, ref: string): Promise<string> {
  assertPortableArtifactRef(ref);
  const candidate = resolve(root, ...ref.split("/"));
  if (!isContained(root, candidate)) throw new Error("HATE artifact path escapes run directory: " + ref);
  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch {
    throw new Error("HATE artifact is missing: " + ref);
  }
  if (!isContained(root, actual)) throw new Error("HATE artifact symlink escapes run directory: " + ref);
  const current = await stat(actual);
  if (!current.isFile()) throw new Error("HATE artifact is not a file: " + ref);
  return actual;
}

function hateArtifact(value: unknown, index: number): HateArtifact {
  const current = object(value, "HATE artifact[" + index + "]");
  const security = object(current.security_checks, "HATE artifact security_checks");
  const artifact: HateArtifact = {
    path: stringValue(current.path, "HATE artifact path"),
    sha256: stringValue(current.sha256, "HATE artifact sha256"),
    size_bytes: integerValue(current.size_bytes, "HATE artifact size_bytes"),
    redaction_status: stringValue(current.redaction_status, "HATE artifact redaction_status"),
    public_exposure: stringValue(current.public_exposure, "HATE artifact public_exposure"),
    security_checks: security,
  };
  if (!/^(sha256:)?[a-fA-F0-9]{64}$/.test(artifact.sha256)) throw new Error("HATE artifact sha256 is invalid: " + artifact.path);
  if (!["not_required", "redacted"].includes(artifact.redaction_status)) throw new Error("HATE artifact redaction is not complete: " + artifact.path);
  if (artifact.public_exposure !== "none") throw new Error("HATE artifact public exposure must be none: " + artifact.path);
  const acceptedScanStatuses = new Set(["pass", "not_applicable"]);
  if (!acceptedScanStatuses.has(String(security.secrets_scan)) || !acceptedScanStatuses.has(String(security.pii_scan))) throw new Error("HATE artifact security checks did not pass: " + artifact.path);
  return artifact;
}

function parseRunSummary(value: unknown, runRef: string): RunSummary {
  if (!/^[A-Za-z0-9._-]+$/.test(runRef)) throw new Error("run directory name is not portable");
  const current = object(value, "run metadata");
  if (current.schemaVersion !== "lakda/run-metadata/v1") throw new Error("unsupported run metadata schemaVersion");
  const runId = stringValue(current.runId, "run metadata runId");
  const mode = stringValue(current.mode, "run metadata mode");
  const outcome = stringValue(current.outcome, "run metadata outcome");
  if (!outcomes.has(outcome)) throw new Error("run metadata outcome is unsupported");
  const terminationReason = stringValue(current.terminationReason, "run metadata terminationReason");
  const producerVersion = stringValue(current.producerVersion, "run metadata producerVersion");
  const commitSha = stringValue(current.commitSha, "run metadata commitSha");
  if (!/^[a-fA-F0-9]{7,64}$/.test(commitSha)) throw new Error("run metadata commitSha is invalid");
  for (const [name, publicValue] of [
    ["run metadata runId", runId],
    ["run metadata mode", mode],
    ["run metadata terminationReason", terminationReason],
    ["run metadata producerVersion", producerVersion],
    ["run metadata commitSha", commitSha],
  ] as const) assertSafePublicValue(publicValue, name);
  const seed = current.seed;
  if (!Number.isSafeInteger(seed)) throw new Error("run metadata seed must be an integer");
  return {
    runId,
    runRef,
    startedAt: dateValue(current.startedAt, "run metadata startedAt"),
    endedAt: dateValue(current.endedAt, "run metadata endedAt"),
    mode,
    outcome: outcome as RunSummary["outcome"],
    terminationReason,
    seed: seed as number,
    producerVersion,
    commitSha,
  };
}

function sortedRecord<T extends string | number | boolean | null>(value: unknown, name: string, allowed?: Set<T>): Record<string, T> {
  const current = object(value, name);
  const result: Record<string, T> = {};
  for (const key of Object.keys(current).sort()) {
    const entry = current[key];
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error(name + " contains a non-finite number");
      if (allowed && !allowed.has(entry as T)) throw new Error(name + " contains an unsupported value");
      result[key] = entry as T;
      continue;
    }
    throw new Error(name + " values must be scalar");
  }
  return result;
}

function canonicalState(node: JsonObject, index: number): { fingerprint: string; state: CanonicalState } {
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

function fingerprintContract(graph: JsonObject): FingerprintContract {
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

function parseGraph(value: unknown): ParsedGraph {
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

function coverageMetric(value: unknown, name: string): CoverageMetric {
  const current = object(value, name);
  const numerator = integerValue(current.numerator, name + " numerator");
  const denominator = integerValue(current.denominator, name + " denominator");
  if (numerator > denominator) throw new Error(name + " numerator exceeds denominator");
  const ratio = ratioValue(current.ratio, name + " ratio");
  const expectedRatio = denominator === 0 ? 0 : numerator / denominator;
  if (Math.abs(ratio - expectedRatio) > Number.EPSILON * 8) throw new Error(name + " ratio does not match numerator/denominator");
  return { numerator, denominator, ratio };
}

function matchingRatio(value: unknown, expected: number, name: string): number {
  const ratio = ratioValue(value, name);
  if (Math.abs(ratio - expected) > Number.EPSILON * 8) throw new Error(name + " does not match detailed coverage metric");
  return ratio;
}

function parseCoverage(value: unknown, graph: GraphSnapshot): RunCoverageSummary {
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

function transitionKey(edge: Pick<GraphEdge, "from" | "candidateId" | "to" | "edgeKind">): string {
  return [edge.from, edge.candidateId, edge.to ?? "", edge.edgeKind].join("\u0000");
}

function roundTripKeys(edges: GraphEdge[]): string[] {
  return edges
    .filter(edge => edge.to !== undefined && edges.some(reverse => reverse.from === edge.to && reverse.to === edge.from))
    .map(transitionKey)
    .sort();
}

async function inspectRun(runDir: string): Promise<InspectedRun> {
  const requestedRoot = resolve(runDir);
  let root: string;
  try {
    root = await realpath(requestedRoot);
  } catch {
    throw new Error("run directory does not exist");
  }
  if (!(await stat(root)).isDirectory()) throw new Error("run directory is not a directory");
  const runRef = basename(root);
  const manifestPath = await secureArtifactFile(root, MANIFEST_REF);
  const manifestBytes = await readFile(manifestPath);
  const manifestValue = parseJson(manifestBytes, "HATE manifest");
  assertHateManifest(manifestValue);
  const manifest = object(manifestValue, "HATE manifest");
  const artifactValues = manifest.artifacts;
  if (!Array.isArray(artifactValues) || artifactValues.length === 0) throw new Error("HATE manifest has no artifacts");
  const artifacts = artifactValues.map(hateArtifact);
  const pathSet = new Set<string>();
  const bytesByPath = new Map<string, Buffer>();
  let verifiedArtifactBytes = 0;
  for (const artifact of artifacts) {
    assertPortableArtifactRef(artifact.path);
    if (artifact.path === MANIFEST_REF || pathSet.has(artifact.path)) throw new Error("HATE manifest contains a duplicate or self reference");
    pathSet.add(artifact.path);
    const path = await secureArtifactFile(root, artifact.path);
    const bytes = await readFile(path);
    const expected = artifact.sha256.replace(/^sha256:/, "").toLowerCase();
    if (bytes.byteLength !== artifact.size_bytes || sha256(bytes) !== expected) throw new Error("HATE artifact bytes/hash mismatch: " + artifact.path);
    bytesByPath.set(artifact.path, bytes);
    verifiedArtifactBytes += bytes.byteLength;
  }
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
    manifestSha256: "sha256:" + sha256(manifestBytes),
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

async function hasRunMetadata(path: string): Promise<boolean> {
  try {
    return (await stat(resolve(path, METADATA_REF))).isFile();
  } catch {
    return false;
  }
}

export async function listRuns(outputDir: string): Promise<RunIndex> {
  const root = await realpath(resolve(outputDir)).catch(() => { throw new Error("output directory does not exist"); });
  if (!(await stat(root)).isDirectory()) throw new Error("output directory is not a directory");
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const inspected: InspectedRun[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (await hasRunMetadata(path)) inspected.push(await inspectRun(path));
  }
  inspected.sort((left, right) => {
    const byStart = Date.parse(right.detail.run.startedAt) - Date.parse(left.detail.run.startedAt);
    return byStart || left.detail.run.runId.localeCompare(right.detail.run.runId) || left.detail.run.runRef.localeCompare(right.detail.run.runRef);
  });
  const runs = inspected.slice(0, RUN_LIMIT).map(value => value.detail.run);
  return {
    schemaVersion: RUN_INDEX_SCHEMA_VERSION,
    total: inspected.length,
    returned: runs.length,
    truncated: inspected.length > RUN_LIMIT,
    runs,
  };
}

export async function showRun(runDir: string): Promise<RunDetail> {
  return (await inspectRun(runDir)).detail;
}

export async function compareRuns(baseRunDir: string, headRunDir: string): Promise<RunComparison> {
  const base = await inspectRun(baseRunDir);
  const head = await inspectRun(headRunDir);
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
