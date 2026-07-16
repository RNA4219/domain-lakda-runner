import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../dist/core/plan.js";
import { assembleReleaseQegInput } from "../scripts/release-gate-evidence.mjs";
import { verifyManualReleaseEvidence } from "../scripts/manual-release-evidence.mjs";
import { fileSha256, sha256 } from "../scripts/real-llm-evidence.mjs";
import { createAcceptanceFixture } from "./helpers/real-llm-acceptance-fixture.js";

async function descriptor(root, path) {
  const target = join(root, path);
  return { path: path.replaceAll("\\", "/"), size: (await stat(target)).size, sha256: await fileSha256(target) };
}

async function createManualFixture(root, revision, mode = "real", authSource = "github-environment") {
  await mkdir(root, { recursive: true });
  const caseSet = JSON.parse(await readFile("docs/release-gate/manual_case_set.json", "utf8"));
  await writeFile(join(root, "manual_case_set.json"), JSON.stringify(caseSet, null, 2) + "\n");
  const executions = [];
  for (const [index, item] of caseSet.manual_cases.entries()) {
    const execution = {
      run_id: "mbb-run-" + (index + 1),
      tc_id: item.tc_id,
      feature_id: caseSet.feature_id,
      build_id: revision,
      timestamp: `2026-07-14T0${index + 1}:00:00.000Z`,
      env: "staging",
      device: "Windows Chromium",
      tester: "release-operator",
      oracle_type: "specified",
      oracle_refs: item.oracle.refs,
      expected: item.expected_results,
      actual: item.expected_results,
      result: "pass",
      attachments: [],
      anomaly_notes: []
    };
    const name = `execution-${index + 1}.json`;
    await writeFile(join(root, name), JSON.stringify(execution, null, 2) + "\n");
    executions.push(await descriptor(root, name));
  }
  const gate = {
    feature_id: caseSet.feature_id,
    build_id: revision,
    status: "go",
    profile: "strict",
    reasons: ["All P0 real staging cases passed"],
    evidence_summary: {
      manual_by_priority: { P0: { pass: caseSet.manual_cases.length, fail: 0, skip: 0, blocked: 0, unknown: 0, untested: 0, total: caseSet.manual_cases.length } },
      mandatory_observation_rate: 100
    },
    blocking_risks: [],
    residual_risks: [],
    unmet_conditions: [],
    required_follow_up: []
  };
  await writeFile(join(root, "gate-decision.json"), JSON.stringify(gate, null, 2) + "\n");
  const record = {
    schemaVersion: "lakda/manual-bb-release/v1",
    subjectRevision: revision,
    testExecutionMode: mode,
    operator: "release-operator",
    startedAt: "2026-07-14T01:00:00.000Z",
    completedAt: "2026-07-14T05:00:00.000Z",
    environment: { name: "staging", baseUrlOrigin: "https://staging.example.invalid", allowHosts: ["staging.example.invalid"], authSource },
    security: { credentialsPersisted: false, sensitiveValuesPersisted: false },
    files: {
      caseSet: await descriptor(root, "manual_case_set.json"),
      gateDecision: await descriptor(root, "gate-decision.json"),
      executions
    }
  };
  record.recordPayloadSha256 = sha256(canonicalJson(record));
  const recordPath = join(root, "manual-release-record.json");
  await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");
  return recordPath;
}

async function writeInput(root, name, value) {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

test("real evidence chain prepares QEG input without producing a verdict", async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), "lakda-release-gate-"));
  const full = await createAcceptanceFixture(join(root, "full"), "full");
  const smoke = await createAcceptanceFixture(join(root, "smoke"), "worker-smoke");
  const manualRecord = await createManualFixture(join(root, "manual"), full.revision);
  const randAudit = await writeInput(root, "rand-summary.json", {
    schemaVersion: "lakda/rand-release-summary/v1",
    status: "ready",
    subjectRevision: full.revision,
    toolRevision: "b".repeat(40),
    requirementsAuditPacketSha256: "c".repeat(64),
    downstreamHandoffSha256: "d".repeat(64),
  });
  const referenceStaging = await writeInput(root, "reference-staging-summary.json", {
    schemaVersion: "lakda/reference-staging-summary/v1",
    status: "ready",
    subjectRevision: full.revision,
    targetRevision: "reference-target-revision",
    acceptanceId: "AC-LX-014",
    caseId: "case-reference-001",
    configDigest: "sha256:" + "e".repeat(64),
    corpus: { corpusId: "reference-corpus", version: "1", sha256: "sha256:" + "1".repeat(64), targetRevision: "reference-target-revision" },
    reportSha256: "2".repeat(64),
    verificationSha256: "3".repeat(64),
  });
  const ctgReadiness = await writeInput(root, "ctg-readiness.json", {
    status: "passed",
    completeness: "complete",
    repo: { revision: full.revision.slice(0, 12) },
    counts: { findings: 5, critical: 0, high: 0 },
    selfAnalysis: { rawMedium: 5 }
  });
  const ctgTriage = await writeInput(root, "ctg-triage.json", {
    schemaVersion: "lakda/ctg-triage-verification/v1",
    status: "passed",
    subjectRevision: full.revision.slice(0, 12),
    counts: { critical: 0, high: 0, medium: 5, triaged: 5, unclassified: 0, stale: 0 },
    inputs: { findings: { sha256: "f".repeat(64) }, triage: { sha256: "a".repeat(64) } },
    entries: Array.from({ length: 5 }, (_, index) => ({
      fingerprint: "fingerprint-" + index,
      ruleId: "LARGE_MODULE",
      path: "src/file-" + index + ".ts",
      disposition: "planned-refactor",
      owner: "RNA4219",
      dueDate: "2026-08-31",
      rationale: "Scheduled responsibility split",
    })),
  });
  const ctgQeg = await writeInput(root, "ctg-qeg.json", {
    version: "ctg.qeg-input/v1",
    producer: "code-to-gate",
    readiness_status: "passed",
    schema_compliance: [{ artifact: "findings.json", status: "ok" }, { artifact: "release-readiness.json", status: "ok" }],
    artifact_hashes: [
      { artifact: "findings.json", hash: "sha256:" + "f".repeat(64) },
      { artifact: "release-readiness.json", hash: "sha256:" + await fileSha256(ctgReadiness) },
    ],
  });
  const hateBundle = await writeInput(root, "hate-qeg-bundle.json", {
    metadata: { qegVersion: "HATE/v1" },
    nodes: [{ id: "run:fixture", kind: "run", data: { base_sha: full.revision } }],
    edges: [],
    completeness: { score: 1, partial: false, parserFailures: [], unsupportedClaims: [] }
  });
  const hateUpstream = await writeInput(root, "hate-upstream.json", {
    schema: "HATE/v1",
    commit: "3a4b655c2434109e230f8b862a9d5fe14f1c069e",
    pinnedChecked: true,
    upstreamChecked: true,
    upstreamRevision: "3a4b655c2434109e230f8b862a9d5fe14f1c069e"
  });
  const outDir = join(root, "qeg");
  const result = await assembleReleaseQegInput({
    revision: full.revision,
    releaseVersion: "0.3.0-rc.5",
    stagingOrigin: "https://staging.example.invalid",
    fullReport: full.reportPath,
    fullBundle: full.bundle,
    workerReport: smoke.reportPath,
    workerBundle: smoke.bundle,
    manualRecord,
    randAudit,
    referenceStaging,
    ctgReadiness,
    ctgTriage,
    ctgQeg,
    hateBundle,
    hateUpstream,
    approver: "release-reviewer",
    workflowUrl: "github-actions://fixture",
    createdAt: "2026-07-14T06:00:00.000Z",
    outDir
  });
  expect(result.gateInput.metadata.qegVersion).toBe("0.2");
  expect(result.gateInput.optionalEvidence.manualEvidence).toHaveLength(5);
  expect(result.gateInput.graph.nodes.filter(node => node.kind === "test").every(node => node.testExecutionMode === "real")).toBe(true);
  expect(result.gateInput.optionalEvidence.finalVerdictAuthority).toBe("qeg");
  await expect(stat(join(outDir, "gate-verdict.json"))).rejects.toThrow();
  await expect(stat(join(outDir, "quality-evidence-record.json"))).rejects.toThrow();
});

test("mock manual evidence cannot satisfy the RC prerequisite", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-manual-mock-"));
  const acceptance = await createAcceptanceFixture(join(root, "acceptance"), "worker-smoke");
  const recordPath = await createManualFixture(join(root, "manual"), acceptance.revision, "mock");
  await expect(verifyManualReleaseEvidence({ recordPath, expectedRevision: acceptance.revision })).rejects.toThrow(/schema|testExecutionMode=real/);
});

test("public HTTPS staging can declare that authentication is not used", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-manual-public-staging-"));
  const acceptance = await createAcceptanceFixture(join(root, "acceptance"), "worker-smoke");
  const recordPath = await createManualFixture(join(root, "manual"), acceptance.revision, "real", "none");
  await expect(verifyManualReleaseEvidence({ recordPath, expectedRevision: acceptance.revision })).resolves.toMatchObject({ valid: true, eligible: true });
});

test("duplicate manual case cannot satisfy the RC prerequisite", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-manual-duplicate-"));
  const acceptance = await createAcceptanceFixture(join(root, "acceptance"), "worker-smoke");
  const manualRoot = join(root, "manual");
  const recordPath = await createManualFixture(manualRoot, acceptance.revision);
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const first = JSON.parse(await readFile(join(manualRoot, record.files.executions[0].path), "utf8"));
  const secondPath = join(manualRoot, record.files.executions[1].path);
  const second = JSON.parse(await readFile(secondPath, "utf8"));
  second.tc_id = first.tc_id;
  await writeFile(secondPath, JSON.stringify(second, null, 2) + "\n");
  record.files.executions[1] = await descriptor(manualRoot, record.files.executions[1].path);
  delete record.recordPayloadSha256;
  record.recordPayloadSha256 = sha256(canonicalJson(record));
  await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n");
  await expect(verifyManualReleaseEvidence({ recordPath, expectedRevision: acceptance.revision })).rejects.toThrow(/重複/);
});