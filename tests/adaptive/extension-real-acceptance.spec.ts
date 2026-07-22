import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const runner = resolve("scripts/run-lakda-extension-real-acceptance.mjs");
const verifier = resolve("scripts/verify-lakda-extension-real-acceptance.mjs");
const digest = (value: string | Buffer): string => "sha256:" + createHash("sha256").update(value).digest("hex");

function run(script: string, env: NodeJS.ProcessEnv = {}): Promise<{ code: number; output: string }> {
  return new Promise(resolvePromise => execFile(process.execPath, [script], { cwd: process.cwd(), env: { ...process.env, ...env } }, (error, stdout, stderr) => resolvePromise({ code: typeof error?.code === "number" ? error.code : 0, output: stdout + stderr })));
}

function hateArtifact(artifactId: string, kind: "report" | "other", portablePath: string, content: string) {
  return {
    artifact_id: artifactId,
    kind,
    path: portablePath,
    sha256: digest(content),
    size_bytes: Buffer.byteLength(content),
    classification: "internal",
    redaction_status: "not_required",
    redaction_rule_version: "lakda-test/v1",
    safe_for_summary: true,
    public_exposure: "none",
    retention: { policy: "test" },
    security_checks: { status: "pass" },
  };
}

test("P11 runner remains pending_external and non-zero without approved environment", async () => {
  const result = await run(runner);
  expect(result.code).toBe(2);
  expect(result.output).toContain("pending_external");
});

test("P11 runner requires a target manifest before loading config or browser runtime", async () => {
  const result = await run(runner, {
    LAKDA_EXTENSION_REAL_CONFIRM: "I_UNDERSTAND",
    LAKDA_EXTENSION_REAL_CONFIG: "missing-config.json",
    LAKDA_EXTENSION_REAL_CORPUS: "missing-corpus.json",
    LAKDA_EXTENSION_REAL_CASE_ID: "case-1",
    LAKDA_EXTENSION_REAL_ENVIRONMENT: "staging",
    LAKDA_EXTENSION_REAL_TARGET_REVISION: "revision-1",
    LAKDA_EXTENSION_REAL_TARGET_MANIFEST: "",
  });
  expect(result.code).toBe(2);
  expect(result.output).toContain("LAKDA_EXTENSION_REAL_TARGET_MANIFEST is required");
  expect(result.output).not.toContain("real execution failed");
});

test("P11 verifier fails closed without a report and never creates a QEG verdict", async () => {
  const result = await run(verifier, { LAKDA_EXTENSION_REAL_REPORT: "" });
  expect(result.code).toBe(2);
  expect(result.output).toContain("pending_external");
  expect(result.output).not.toMatch(/"verdict"\s*:\s*"go"/);
});

test("P11 verifier accepts genuine v1 layout and rejects hash-consistent semantic or manifest-path tampering", async ({ browserName }, testInfo) => {
  void browserName;
  const runDir = testInfo.outputPath("v1-run");
  const reportPath = resolve(runDir, "acceptance", "case.json");
  const manifestPath = resolve(runDir, "exports", "artifact-manifest.json");
  const evidencePath = resolve(runDir, "evidence", "outcome.json");
  const oraclePath = resolve(runDir, "adaptive", "oracle-results.jsonl");
  await Promise.all([
    mkdir(resolve(runDir, "acceptance"), { recursive: true }),
    mkdir(resolve(runDir, "exports"), { recursive: true }),
    mkdir(resolve(runDir, "evidence"), { recursive: true }),
    mkdir(resolve(runDir, "adaptive"), { recursive: true }),
  ]);
  const evidenceText = JSON.stringify({ outcome: "passed" });
  const oracleText = JSON.stringify({ oracleId: "fixture", status: "pass" }) + "\n";
  await Promise.all([
    writeFile(evidencePath, evidenceText, "utf8"),
    writeFile(oraclePath, oracleText, "utf8"),
  ]);
  const evidenceRef = { path: "evidence/outcome.json", sha256: digest(evidenceText), size: Buffer.byteLength(evidenceText) };
  const oracleRef = { path: "adaptive/oracle-results.jsonl", sha256: digest(oracleText), size: Buffer.byteLength(oracleText) };
  const report = {
    schemaVersion: "lakda/extension-acceptance-case/v1",
    acceptanceId: "AC-LX-014",
    caseId: "v1-compatibility",
    runId: "p11-v1-compatibility",
    attempt: 1,
    revision: "revision-v1",
    configDigest: "sha256:" + "1".repeat(64),
    executionMode: "real",
    environment: { label: "staging", origin: "https://example.invalid/", adapterId: "playwright" },
    corpus: {
      corpusId: "p11-v1-corpus",
      version: "1",
      sha256: "sha256:" + "2".repeat(64),
      targetRevision: "revision-v1",
      caseConfigDigest: "sha256:" + "1".repeat(64),
    },
    expected: { outcome: "passed" },
    actual: { outcome: "passed", terminationReason: "completed", exitCode: 0 },
    oracleResultRefs: [oracleRef],
    hateArtifactRefs: [oracleRef, evidenceRef],
    artifactManifestPath: "exports/artifact-manifest.json",
    verdict: "passed",
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
    generatedAt: "2026-07-22T00:00:00.000Z",
  };

  async function writeBoundBundle(): Promise<void> {
    const reportText = JSON.stringify(report);
    await writeFile(reportPath, reportText, "utf8");
    await writeFile(manifestPath, JSON.stringify({
      schema_version: "HATE/v1",
      run_id: report.runId,
      run_attempt: report.attempt,
      commit_sha: "1234567",
      artifacts: [
        hateArtifact("acceptance-report", "report", "acceptance/case.json", reportText),
        hateArtifact("oracle", "report", oracleRef.path, oracleText),
        hateArtifact("outcome", "other", evidenceRef.path, evidenceText),
      ],
    }), "utf8");
  }

  await writeBoundBundle();
  const env = {
    LAKDA_EXTENSION_REAL_REPORT: reportPath,
    LAKDA_EXTENSION_REAL_TARGET_REVISION: report.revision,
    LAKDA_EXTENSION_REAL_TARGET_MANIFEST: "",
  };
  const accepted = await run(verifier, env);
  expect(accepted.code).toBe(0);
  expect(accepted.output).toContain('"readiness":"ready_for_manual_bb_qeg"');
  expect(accepted.output).toContain('"schemaVersion":"lakda/extension-acceptance-case/v1"');

  report.actual.exitCode = 2;
  await writeBoundBundle();
  const semanticTamper = await run(verifier, env);
  expect(semanticTamper.code).toBe(2);
  expect(semanticTamper.output).toContain("exit code does not match actual outcome");

  report.actual.exitCode = 0;
  report.artifactManifestPath = "exports/../exports/artifact-manifest.json";
  await writeBoundBundle();
  const pathTamper = await run(verifier, env);
  expect(pathTamper.code).toBe(2);
  expect(pathTamper.output).toContain("not at the expected run location");
});

test("P11 runner classifies an invalid bound config as structured pending_external", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-p11-invalid-config-"));
  const configPath = join(directory, "config.json");
  const corpusPath = join(directory, "corpus.json");
  const targetPath = join(directory, "target.json");
  const configText = "[]";
  try {
    await writeFile(configPath, configText, "utf8");
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: "lakda/extension-acceptance-corpus/v1",
      corpusId: "fixed-corpus",
      version: "1",
      targetRevision: "revision-1",
      cases: [{ caseId: "case-1", acceptanceId: "AC-LX-014", configDigest: digest(configText), expected: { outcome: "passed" } }],
    }), "utf8");
    await writeFile(targetPath, JSON.stringify({
      schemaVersion: "lakda/target-manifest/v1",
      manifestId: "ready-target",
      targetClass: "crm-list",
      status: "ready",
      binding: { targetRevision: "revision-1", configDigest: digest(configText) },
      owner: "owner@example.test",
      environment: { name: "staging", baseUrlOrigin: "https://staging.example.test" },
      access: { approved: true, authSource: "github-environment", approvalEvidenceRef: "approval-ref" },
      scope: { allowHosts: ["staging.example.test"], pathPrefixes: ["/app"] },
      safety: { allowMutationKinds: ["none"], resetProcedureRef: "reset-ref", killSwitchRef: "kill-ref" },
      privacy: { piiPolicyRef: "pii-ref", sensitiveValuesPersisted: false },
      actionContracts: [{ actionId: "view-record", mutationKind: "none" }],
      settleProfile: { policyVersion: "consensus/v1", readiness: null, networkQuietExclusions: [] },
      acceptance: { p0ActionIds: ["view-record"], p1ActionIds: [] },
    }), "utf8");
    const result = await run(runner, {
      LAKDA_EXTENSION_REAL_CONFIRM: "I_UNDERSTAND",
      LAKDA_EXTENSION_REAL_CONFIG: configPath,
      LAKDA_EXTENSION_REAL_CORPUS: corpusPath,
      LAKDA_EXTENSION_REAL_CASE_ID: "case-1",
      LAKDA_EXTENSION_REAL_ENVIRONMENT: "staging",
      LAKDA_EXTENSION_REAL_TARGET_REVISION: "revision-1",
      LAKDA_EXTENSION_REAL_TARGET_MANIFEST: targetPath,
    });
    expect(result.code).toBe(2);
    expect(result.output).toContain('"status":"pending_external"');
    expect(result.output).toContain("real extension acceptance config is invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
