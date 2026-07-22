import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { compareRuns, listRuns, showRun } from "../src/runs/catalog.js";
import { runsCompareCommand } from "../src/commands/runs.js";
import { runCli } from "../src/cli.js";
import { sha256 } from "../src/core/redaction.js";

type Validator = ((value: unknown) => boolean) & { errors?: unknown[] };
type AjvConstructor = new (options: object) => { compile(schema: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const repositoryRoot = resolve(import.meta.dirname, "..");

type Edge = { from: string; candidateId: string; edgeKind: string; to?: string; count: number };
type RunOptions = {
  runId: string;
  startedAt: string;
  endedAt?: string;
  outcome?: "passed" | "failed" | "partial" | "error";
  terminationReason?: string;
  adaptive?: boolean;
  graphVersion?: string;
  fingerprintAlgorithmVersion?: string;
  fingerprintCanonicalizationVersion?: string;
  nodes?: string[];
  nodeVisits?: Record<string, number>;
  edges?: Edge[];
  pairs?: string[];
};

const edgeKey = (edge: Edge): string => [edge.from, edge.candidateId, edge.to ?? "", edge.edgeKind].join("\u0000");
const pairKey = (left: Edge, right: Edge): string => edgeKey(left) + "\u0001" + edgeKey(right);

async function expectSchema(path: string, value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8")) as object;
  const validator = new Ajv({ allErrors: true, strict: false }).compile(schema);
  expect(validator(value), JSON.stringify(validator.errors)).toBe(true);
}

async function expectSafeRejection(promise: Promise<unknown>, forbidden: string): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toMatch(/sensitive data|absolute path/);
  expect(message).not.toContain(forbidden);
}

function artifactEntry(ref: string, bytes: Buffer, index: number) {
  return {
    artifact_id: "lakda:artifact-" + index,
    kind: "report",
    path: ref,
    sha256: "sha256:" + sha256(bytes),
    size_bytes: bytes.byteLength,
    classification: "internal",
    redaction_status: "not_required",
    redaction_rule_version: "lakda-redact-v1",
    safe_for_summary: true,
    public_exposure: "none",
    retention: {},
    security_checks: { secrets_scan: "pass", pii_scan: "pass" },
  };
}

async function writeRun(root: string, ref: string, options: RunOptions): Promise<string> {
  const runDir = join(root, ref);
  await mkdir(join(runDir, "exports"), { recursive: true });
  const adaptive = options.adaptive ?? true;
  const metadata = {
    schemaVersion: "lakda/run-metadata/v1",
    runId: options.runId,
    attempt: 1,
    startedAt: options.startedAt,
    endedAt: options.endedAt ?? options.startedAt,
    mode: adaptive ? "adaptive-explore" : "smoke",
    seed: 4219,
    producerVersion: "0.4.0-rc.2",
    commitSha: "a".repeat(40),
    outcome: options.outcome ?? "passed",
    terminationReason: options.terminationReason ?? "completed",
  };
  const artifacts = new Map<string, Buffer>();
  artifacts.set("run-metadata.json", Buffer.from(JSON.stringify(metadata)));
  if (adaptive) {
    const nodeIds = options.nodes ?? ["state:a", "state:b"];
    const edges = options.edges ?? [
      { from: "state:a", candidateId: "go", edgeKind: "action", to: "state:b", count: 1 },
      { from: "state:b", candidateId: "back", edgeKind: "action", to: "state:a", count: 1 },
    ];
    const pairs = options.pairs ?? [pairKey(edges[0], edges[1])];
    const graph = {
      schemaVersion: options.graphVersion ?? "lakda/state-graph/v1",
      model: "discovered-model",
      ...(options.fingerprintAlgorithmVersion ? { fingerprintAlgorithmVersion: options.fingerprintAlgorithmVersion } : {}),
      ...(options.fingerprintCanonicalizationVersion ? { fingerprintCanonicalizationVersion: options.fingerprintCanonicalizationVersion } : {}),
      revision: 7,
      nodes: nodeIds.map((fingerprint, index) => ({
        fingerprint,
        firstSeenAction: index,
        lastSeenAction: index,
        visits: options.nodeVisits?.[fingerprint] ?? 1,
        knownCandidateIds: [],
        obligations: {},
      })),
      edges: edges.map(edge => ({
        ...edge,
        statuses: { executed: edge.count },
        failureSignatures: [],
        oracleRefs: [],
        evidenceArtifactIds: [],
        latencyMs: { count: edge.count, total: 1, min: 1, max: 1 },
      })),
      transitionPairs: pairs,
      offeredCandidateIds: [...new Set(edges.map(edge => edge.candidateId))].sort(),
      executedCandidateIds: [...new Set(edges.map(edge => edge.candidateId))].sort(),
    };
    const roundTripCount = edges.filter(edge => edge.to && edges.some(reverse => reverse.from === edge.to && reverse.to === edge.from)).length;
    const coverage = {
      schemaVersion: "lakda/coverage-report/v1",
      actions: edges.reduce((sum, edge) => sum + edge.count, 0),
      model: "discovered-model",
      openWorld: true,
      graphRevision: 7,
      discoveredStateCount: nodeIds.length,
      newStateCount: nodeIds.length,
      novelStateRate: 1,
      state: { numerator: nodeIds.length, denominator: nodeIds.length, ratio: 1 },
      action: { numerator: edges.length, denominator: edges.length, ratio: 1 },
      transition: { numerator: edges.length, denominator: edges.length, ratio: 1 },
      transitionPair: { numerator: pairs.length, denominator: pairs.length, ratio: 1 },
      roundTrip: { numerator: roundTripCount, denominator: edges.length, ratio: edges.length ? roundTripCount / edges.length : 0 },
      obligation: { numerator: 0, denominator: 0, ratio: 0 },
      stateCoverage: 1,
      actionCoverage: 1,
      transitionCoverage: 1,
      transitionPairCoverage: pairs.length ? 1 : 0,
      roundTripCoverage: edges.length ? roundTripCount / edges.length : 0,
      obligationCoverage: 1,
      stateCount: nodeIds.length,
      transitionCount: edges.length,
      transitionPairCount: pairs.length,
      roundTripCount,
      timeline: [],
    };
    artifacts.set("adaptive/transition-graph.json", Buffer.from(JSON.stringify(graph)));
    artifacts.set("adaptive/coverage.json", Buffer.from(JSON.stringify(coverage)));
  }
  for (const [artifactRef, bytes] of artifacts) {
    const path = join(runDir, ...artifactRef.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
  }
  const entries = [...artifacts.entries()].map(([artifactRef, bytes], index) => artifactEntry(artifactRef, bytes, index));
  const manifest = {
    schema_version: "HATE/v1",
    run_id: options.runId,
    run_attempt: 1,
    commit_sha: "a".repeat(40),
    artifacts: entries,
  };
  await writeFile(join(runDir, "exports", "artifact-manifest.json"), JSON.stringify(manifest));
  return runDir;
}

test("run list uses deterministic order and a hard 100 item limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-runs-list-"));
  try {
    await Promise.all(Array.from({ length: 101 }, (_, index) => writeRun(root, "run-" + String(index).padStart(3, "0"), {
      runId: index === 99 ? "run-a" : index === 100 ? "run-b" : "run-" + String(index).padStart(3, "0"),
      startedAt: index >= 99 ? "2026-07-22T12:00:00.000Z" : new Date(Date.UTC(2026, 6, 21, 0, 0, index)).toISOString(),
      adaptive: false,
    })));
    const index = await listRuns(root);
    expect(index.total).toBe(101);
    expect(index.returned).toBe(100);
    expect(index.truncated).toBe(true);
    expect(index.runs).toHaveLength(100);
    expect(index.runs.slice(0, 2).map(run => run.runId)).toEqual(["run-a", "run-b"]);
    await expectSchema("schemas/lakda-run-index-v1.schema.json", index);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run detail and comparison expose verified deterministic graph differences", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-runs-compare-"));
  try {
    const baseEdges: Edge[] = [
      { from: "state:a", candidateId: "go", edgeKind: "action", to: "state:b", count: 1 },
      { from: "state:b", candidateId: "back", edgeKind: "action", to: "state:a", count: 1 },
    ];
    const headEdges: Edge[] = [
      { from: "state:a", candidateId: "go", edgeKind: "action", to: "state:b", count: 2 },
      { from: "state:b", candidateId: "back", edgeKind: "action", to: "state:a", count: 1 },
      { from: "state:b", candidateId: "next", edgeKind: "action", to: "state:c", count: 1 },
      { from: "state:c", candidateId: "return", edgeKind: "action", to: "state:b", count: 1 },
    ];
    const base = await writeRun(root, "base", {
      runId: "base",
      startedAt: "2026-07-21T00:00:00.000Z",
      edges: baseEdges,
      nodeVisits: { "state:a": 1 },
    });
    const head = await writeRun(root, "head", {
      runId: "head",
      startedAt: "2026-07-22T00:00:00.000Z",
      outcome: "failed",
      terminationReason: "machine_failure",
      nodes: ["state:a", "state:b", "state:c"],
      nodeVisits: { "state:a": 2 },
      edges: headEdges,
      pairs: [pairKey(headEdges[0], headEdges[1]), pairKey(headEdges[2], headEdges[3])],
    });
    const detail = await showRun(base);
    expect(detail.integrity.status).toBe("verified");
    expect(detail.graph?.stateCount).toBe(2);
    expect(detail.graph?.fingerprintAlgorithmVersion).toBe("lakda-state-sha256/v1");
    expect(detail.graph?.fingerprintCanonicalizationVersion).toBe("lakda-observation-canonical/v1");
    expect(detail.graph?.coverage.state).toEqual({ numerator: 2, denominator: 2, ratio: 1 });
    await expectSchema("schemas/lakda-run-detail-v1.schema.json", detail);
    const comparison = await compareRuns(base, head);
    expect(comparison.fingerprintAlgorithmVersion).toBe("lakda-state-sha256/v1");
    expect(comparison.fingerprintCanonicalizationVersion).toBe("lakda-observation-canonical/v1");
    expect(comparison.states.added).toEqual(["state:c"]);
    expect(comparison.states.changed).toEqual([{ fingerprint: "state:a", changedFields: ["visits"] }]);
    expect(comparison.transitions.added).toHaveLength(2);
    expect(comparison.transitions.countChanges).toEqual([expect.objectContaining({ base: 1, head: 2, delta: 1 })]);
    expect(comparison.roundTrips.delta).toBe(2);
    expect(comparison.coverage.state.numerator).toEqual({ base: 2, head: 3, delta: 1 });
    expect(comparison.coverage.state.denominator).toEqual({ base: 2, head: 3, delta: 1 });
    expect(comparison.coverage.state.ratio).toEqual({ base: 1, head: 1, delta: 0 });
    expect(comparison.coverage.transition.numerator).toEqual({ base: 2, head: 4, delta: 2 });
    expect(comparison.outcome).toEqual({ base: "passed", head: "failed", changed: true });
    expect(comparison.terminationReason.changed).toBe(true);
    await expectSchema("schemas/lakda-run-comparison-v1.schema.json", comparison);
    const repeated = await compareRuns(base, head);
    expect(repeated).toEqual(comparison);
    const out = join(root, "comparison.json");
    expect(await runCli(["runs", "compare", "--base-run-dir", base, "--head-run-dir", head, "--out", out])).toBe(0);
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual(comparison);
    await expect(runsCompareCommand({ baseRunDir: base, headRunDir: head, out: join(base, "comparison.json") })).rejects.toThrow(/must not modify a run directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run catalog rescans public metadata and graph identifiers without echoing sensitive values", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-runs-sensitive-"));
  try {
    const piiRoot = join(root, "pii");
    await mkdir(piiRoot);
    const piiValue = "person@example.test";
    const piiRun = await writeRun(piiRoot, "pii-run", {
      runId: piiValue,
      startedAt: "2026-07-21T00:00:00.000Z",
      adaptive: false,
    });
    await expectSafeRejection(showRun(piiRun), piiValue);
    await expectSafeRejection(listRuns(piiRoot), piiValue);

    const pathRoot = join(root, "absolute-path");
    await mkdir(pathRoot);
    const absolutePath = "C:\\private\\lakda-run";
    const pathRun = await writeRun(pathRoot, "path-run", {
      runId: absolutePath,
      startedAt: "2026-07-21T00:00:00.000Z",
      adaptive: false,
    });
    await expectSafeRejection(showRun(pathRun), absolutePath);
    await expectSafeRejection(listRuns(pathRoot), absolutePath);

    const candidateRoot = join(root, "candidate");
    await mkdir(candidateRoot);
    const secretCandidate = "token=abc";
    const candidateEdges: Edge[] = [
      { from: "state:a", candidateId: secretCandidate, edgeKind: "action", to: "state:b", count: 1 },
      { from: "state:b", candidateId: "back", edgeKind: "action", to: "state:a", count: 1 },
    ];
    const candidateRun = await writeRun(candidateRoot, "candidate-run", {
      runId: "candidate-run",
      startedAt: "2026-07-21T00:00:00.000Z",
      edges: candidateEdges,
    });
    const safeRun = await writeRun(candidateRoot, "safe-run", {
      runId: "safe-run",
      startedAt: "2026-07-22T00:00:00.000Z",
    });
    await expectSafeRejection(showRun(candidateRun), secretCandidate);
    await expectSafeRejection(listRuns(candidateRoot), secretCandidate);
    await expectSafeRejection(compareRuns(candidateRun, safeRun), secretCandidate);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run inspection fails closed on tampered artifact bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-runs-tamper-"));
  try {
    const missing = await writeRun(root, "missing", { runId: "missing", startedAt: "2026-07-21T00:00:00.000Z" });
    await rm(join(missing, "exports", "artifact-manifest.json"));
    await expect(showRun(missing)).rejects.toThrow(/missing/);
    const runDir = await writeRun(root, "tampered", { runId: "tampered", startedAt: "2026-07-22T00:00:00.000Z" });
    await writeFile(join(runDir, "adaptive", "transition-graph.json"), "{}");
    await expect(showRun(runDir)).rejects.toThrow(/bytes\/hash mismatch/);
    expect(await runCli(["runs", "show", "--run-dir", runDir])).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run inspection rejects HATE path traversal before reading outside bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-runs-traversal-"));
  try {
    const runDir = await writeRun(root, "traversal", { runId: "traversal", startedAt: "2026-07-22T00:00:00.000Z", adaptive: false });
    const manifestPath = join(runDir, "exports", "artifact-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { artifacts: unknown[] };
    manifest.artifacts.push(artifactEntry("../outside.json", Buffer.from("{}"), 99));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(showRun(runDir)).rejects.toThrow(/not portable|escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs compare rejects incompatible fingerprint algorithm or canonicalization versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-runs-fingerprint-version-"));
  try {
    const base = await writeRun(root, "base", {
      runId: "base",
      startedAt: "2026-07-21T00:00:00.000Z",
      fingerprintAlgorithmVersion: "lakda-state-sha256/v1",
      fingerprintCanonicalizationVersion: "lakda-observation-canonical/v1",
    });
    const incompatibleAlgorithm = await writeRun(root, "algorithm", {
      runId: "algorithm",
      startedAt: "2026-07-22T00:00:00.000Z",
      fingerprintAlgorithmVersion: "lakda-state-sha256/v2",
      fingerprintCanonicalizationVersion: "lakda-observation-canonical/v1",
    });
    await expect(compareRuns(base, incompatibleAlgorithm)).rejects.toThrow(/fingerprint algorithm version/);
    const incomplete = await writeRun(root, "incomplete", {
      runId: "incomplete",
      startedAt: "2026-07-22T00:00:00.000Z",
      fingerprintAlgorithmVersion: "lakda-state-sha256/v1",
    });
    await expect(compareRuns(base, incomplete)).rejects.toThrow(/fingerprint contract is incomplete/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs compare rejects an unsupported or mismatched graph version", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-runs-version-"));
  try {
    const base = await writeRun(root, "base", { runId: "base", startedAt: "2026-07-21T00:00:00.000Z" });
    const head = await writeRun(root, "head", { runId: "head", startedAt: "2026-07-22T00:00:00.000Z", graphVersion: "lakda/state-graph/v2" });
    await expect(compareRuns(base, head)).rejects.toThrow(/state graph schemaVersion/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
