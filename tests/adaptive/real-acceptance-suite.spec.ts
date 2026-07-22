import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const verifier = resolve("scripts/verify-adaptive-real-acceptance.mjs");
const sha256 = (bytes: string | Buffer): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");

function run(indexPath?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env.LAKDA_ADAPTIVE_SUITE_INDEX;
  if (indexPath) env.LAKDA_ADAPTIVE_SUITE_INDEX = indexPath;
  return new Promise(resolvePromise => execFile(process.execPath, [verifier], { cwd: process.cwd(), env }, (error, stdout, stderr) => {
    resolvePromise({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
  }));
}

function artifact(path: string, bytes: Buffer, kind: "report" | "log" = "report") {
  return {
    artifact_id: "lakda:artifact-" + path.replace(/[^a-zA-Z0-9]+/g, "-"),
    kind,
    path,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    classification: "internal",
    redaction_status: "not_required",
    redaction_rule_version: "lakda-redact-v1",
    safe_for_summary: true,
    public_exposure: "none",
    retention: { class: "default", days: 14 },
    security_checks: { secrets_scan: "pass", pii_scan: "pass" },
  };
}

type MutableAcceptanceReport = {
  acceptanceId: string;
  revision: string;
  runnerRevision: string;
  actual: { outcome: string; terminationReason: string; exitCode: number };
  corpus: { corpusId: string; version: string; sha256: string; targetRevision: string; caseConfigDigest: string };
};

async function createSuite(root: string, count: number, mutateReport?: (report: MutableAcceptanceReport, index: number) => void): Promise<string> {
  const reports: Array<{ path: string; sha256: string }> = [];
  const fixedDigest = "sha256:" + "a".repeat(64);
  for (let index = 1; index <= count; index += 1) {
    const acceptanceId = "AC-AE-" + String(index).padStart(3, "0");
    const caseId = "case-" + String(index).padStart(3, "0");
    const runDir = join(root, "run-" + caseId);
    const reportPath = join(runDir, "adaptive", "acceptance-case-" + caseId + ".json");
    const oraclePath = join(runDir, "adaptive", "oracle-results.jsonl");
    const manifestPath = join(runDir, "exports", "artifact-manifest.json");
    await mkdir(dirname(reportPath), { recursive: true });
    await mkdir(dirname(manifestPath), { recursive: true });
    const oracleBytes = Buffer.from('{"oracleId":"fixture"}\n', "utf8");
    await writeFile(oraclePath, oracleBytes);
    const oracleArtifact = artifact("adaptive/oracle-results.jsonl", oracleBytes, "report");
    const report = {
      schemaVersion: "lakda/adaptive-acceptance-case/v1",
      acceptanceId,
      caseId,
      runId: "run-" + caseId,
      attempt: 1,
      revision: "product-revision-1",
      runnerRevision: "abcdef0",
      executionMode: "real",
      environment: { label: "fixture-structure-only", origin: "https://staging.example.test", adapterId: "playwright" },
      runtime: { nodeVersion: process.version, platform: process.platform, arch: process.arch },
      seed: index,
      configDigest: fixedDigest,
      targetManifest: { manifestId: "fixture-target", sha256: fixedDigest },
      corpus: { corpusId: "fixed-corpus", version: "1", sha256: fixedDigest, targetRevision: "product-revision-1", caseConfigDigest: fixedDigest },
      expected: { outcome: "passed" },
      actual: { outcome: "passed", terminationReason: "completed", exitCode: 0 },
      oracleResultRefs: [oracleArtifact],
      artifactRefs: [oracleArtifact],
      candidateAudit: { schemaVersion: "lakda/target-candidate-audit/v1", snapshotCount: 1, observedControls: 1, classifiedControls: 1, unclassifiedControls: 0, candidateCount: 1, coverageDebtCount: 0, debtByReason: {}, requiredActionIds: ["view-record"], observedActionIds: ["view-record"], debtActionIds: [], eligible: true, violations: [] },
      verdict: "passed",
      ineligibilityReason: null,
      qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
      generatedAt: "2026-07-15T00:00:00.000Z",
    };
    mutateReport?.(report, index);
    const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n", "utf8");
    await writeFile(reportPath, reportBytes);
    const reportArtifact = artifact("adaptive/acceptance-case-" + caseId + ".json", reportBytes, "report");
    await writeFile(manifestPath, JSON.stringify({
      schema_version: "HATE/v1",
      run_id: report.runId,
      run_attempt: report.attempt,
      commit_sha: report.runnerRevision,
      artifacts: [oracleArtifact, reportArtifact],
    }, null, 2) + "\n", "utf8");
    reports.push({ path: relative(root, reportPath).replaceAll("\\", "/"), sha256: sha256(reportBytes) });
  }
  const indexPath = join(root, "suite-index.json");
  await writeFile(indexPath, JSON.stringify({
    schemaVersion: "lakda/adaptive-acceptance-suite-index/v1",
    suiteId: "fixture-suite",
    version: "1",
    reports,
  }, null, 2) + "\n", "utf8");
  return indexPath;
}

test("P7 suite verifier fails closed without an explicit index", async () => {
  const result = await run();
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("LAKDA_ADAPTIVE_SUITE_INDEX");
});

test("P7 suite verifier rejects structurally valid but incomplete AC coverage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-p7-suite-incomplete-"));
  try {
    const result = await run(await createSuite(directory, 1));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("exactly 16 case reports");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("P7 suite verifier requires all 16 AC while keeping manual-bb and QEG external", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-p7-suite-complete-"));
  try {
    const result = await run(await createSuite(directory, 16));
    expect(result.code).toBe(0);
    const readiness = JSON.parse(result.stdout) as {
      status: string;
      p7Status: string;
      acceptanceIds: string[];
      qegHandoff: { verdictGeneratedByLakda: boolean };
    };
    expect(readiness.status).toBe("ready_for_manual_bb_qeg");
    expect(readiness.p7Status).toBe("pending_external");
    expect(readiness.acceptanceIds).toHaveLength(16);
    expect(readiness.qegHandoff.verdictGeneratedByLakda).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("P7 suite verifier rejects a hash-consistent report with an impossible outcome exit code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-p7-suite-semantic-"));
  try {
    const indexPath = await createSuite(directory, 16, (report, index) => {
      if (index === 1) report.actual.exitCode = 2;
    });
    const result = await run(indexPath);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('"status":"pending_external"');
    expect(result.stderr).toContain("exit code does not match actual outcome");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("P7 suite verifier rejects hash-consistent reports from a mixed revision cohort", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-p7-suite-mixed-cohort-"));
  try {
    const indexPath = await createSuite(directory, 16, (report, index) => {
      if (index === 1) {
        report.revision = "other-product-revision";
        report.runnerRevision = "fedcba0";
        report.corpus = {
          ...report.corpus,
          corpusId: "other-corpus",
          targetRevision: "other-product-revision",
        };
      }
    });
    const result = await run(indexPath);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("mixed corpus or runner revision cohort");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("P7 suite verifier rejects a duplicate acceptance ID even with 16 reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-p7-suite-duplicate-acceptance-"));
  try {
    const indexPath = await createSuite(directory, 16, (report, index) => {
      if (index === 2) report.acceptanceId = "AC-AE-001";
    });
    const result = await run(indexPath);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("duplicate acceptance ID");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("P7 suite verifier rejects non-canonical traversal in a hash-valid report index", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-p7-suite-traversal-"));
  try {
    const indexPath = await createSuite(directory, 16);
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    const original = index.reports[0].path;
    const firstSegment = original.slice(0, original.indexOf("/"));
    index.reports[0].path = firstSegment + "/../" + original;
    await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
    const result = await run(indexPath);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('"status":"pending_external"');
    expect(result.stderr).toContain("non-portable path segment");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
