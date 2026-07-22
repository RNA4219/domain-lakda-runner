import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  AcceptanceInputError,
  acceptanceFailureExitCode,
  applyTargetManifest,
  assertAcceptanceReportSemantics,
  assertSchema,
  assertTargetManifestBinding,
  loadReadyTargetManifest,
  portableRunPath,
  verifyHateArtifacts,
} from "../../src/acceptance/common.js";
import type { LakdaConfig } from "../../src/core/types.js";

const zeroDigest = "sha256:" + "0".repeat(64);
const sha256 = (value: string | Buffer): string => "sha256:" + createHash("sha256").update(value).digest("hex");
const artifactRef = { path: "adaptive/oracle-results.jsonl", sha256: zeroDigest, size: 1 };
const candidateAudit = {
  schemaVersion: "lakda/target-candidate-audit/v1" as const,
  snapshotCount: 1,
  observedControls: 1,
  classifiedControls: 1,
  unclassifiedControls: 0,
  candidateCount: 1,
  coverageDebtCount: 0,
  debtByReason: {},
  requiredActionIds: ["view-record"],
  observedActionIds: ["view-record"],
  debtActionIds: [],
  eligible: true,
  violations: [],
};

test("acceptance failure classification keeps contract errors at exit 2 and internal errors at exit 1", () => {
  expect(acceptanceFailureExitCode(new AcceptanceInputError("invalid input"))).toBe(2);
  expect(acceptanceFailureExitCode(new Error("internal failure"))).toBe(1);
});

test("shared target-manifest loader rejects pending_external before runtime setup", async () => {
  await expect(loadReadyTargetManifest(resolve("docs/targets/saas-crm.pending-external.json"))).rejects.toThrow(AcceptanceInputError);
});

test("ready target manifest binding is exact and fail-closed", () => {
  const target = { binding: { targetRevision: "rev-1", configDigest: zeroDigest } } as Parameters<typeof assertTargetManifestBinding>[0];
  expect(() => assertTargetManifestBinding(target, "rev-1", zeroDigest)).not.toThrow();
  expect(() => assertTargetManifestBinding(target, "rev-2", zeroDigest)).toThrow(AcceptanceInputError);
  expect(() => assertTargetManifestBinding(target, "rev-1", "sha256:" + "1".repeat(64))).toThrow(AcceptanceInputError);
});

test("shared target-manifest policy applies only matching scope and settle settings", () => {
  const config = {
    baseUrl: "https://staging.example.test/app",
    adaptive: {
      actionContracts: [{ actionId: "view-record", mutationKind: "none" }],
      settlePolicy: { policyVersion: "consensus/v1", maxWaitMs: 1000, stableWindowMs: 10 },
      safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
    },
    safety: { allowHosts: ["staging.example.test"], pathPrefixes: [], denyActionKinds: [], maxActionsPerMinute: 10, requireFixtureResetForMutations: false, fixtureResetConfigured: false },
  } as unknown as LakdaConfig;
  applyTargetManifest(config, {
    schemaVersion: "lakda/target-manifest/v1",
    manifestId: "ready-target",
    status: "ready",
    binding: { targetRevision: "rev-1", configDigest: zeroDigest },
    environment: { name: "staging", baseUrlOrigin: "https://staging.example.test" },
    access: { approved: true, authSource: "none", approvalEvidenceRef: "approval:fixture" },
    scope: { allowHosts: ["staging.example.test"], pathPrefixes: ["/app"] },
    safety: { allowMutationKinds: ["none"], resetProcedureRef: "reset:fixture", killSwitchRef: "kill:fixture" },
    actionContracts: [{ actionId: "view-record", mutationKind: "none" }],
    settleProfile: { policyVersion: "consensus/v1", readiness: null, networkQuietExclusions: ["/poll"] },
    acceptance: { p0ActionIds: ["view-record"], p1ActionIds: [] },
  });
  expect(config.safety.pathPrefixes).toEqual(["/app"]);
  expect(config.adaptive?.settlePolicy.networkQuietExclusions).toEqual(["/poll"]);
});

test("P11 v2 schema requires target identity and an eligible candidate audit", async () => {
  const report = {
    schemaVersion: "lakda/extension-acceptance-case/v2",
    acceptanceId: "AC-LX-014",
    caseId: "case-1",
    runId: "run-1",
    attempt: 1,
    revision: "rev-1",
    configDigest: zeroDigest,
    executionMode: "real",
    environment: { label: "staging", origin: "https://staging.example.test", adapterId: "playwright" },
    corpus: { corpusId: "corpus-1", version: "1", sha256: zeroDigest, targetRevision: "rev-1", caseConfigDigest: zeroDigest },
    targetManifest: { manifestId: "ready-target", sha256: zeroDigest },
    expected: { outcome: "passed" },
    actual: { outcome: "passed", terminationReason: "completed", exitCode: 0 },
    oracleResultRefs: [artifactRef],
    hateArtifactRefs: [artifactRef],
    artifactManifestPath: "exports/artifact-manifest.json",
    candidateAudit,
    verdict: "passed",
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
    generatedAt: "2026-07-22T00:00:00.000Z",
  };
  await expect(assertSchema(report, "lakda-extension-acceptance-case-v2.schema.json", "report")).resolves.toBeUndefined();
  const incomplete = { ...report } as Record<string, unknown>;
  delete incomplete.candidateAudit;
  await expect(assertSchema(incomplete, "lakda-extension-acceptance-case-v2.schema.json", "report")).rejects.toThrow(/candidateAudit/);
  expect(() => assertAcceptanceReportSemantics(report, {
    requireCandidateAudit: true,
    targetAcceptance: { p0ActionIds: ["view-record"], p1ActionIds: [] },
    targetOrigin: "https://staging.example.test",
  })).not.toThrow();
  expect(() => assertAcceptanceReportSemantics({ ...report, actual: { ...report.actual, exitCode: 2 } }, {
    requireCandidateAudit: true,
    targetAcceptance: { p0ActionIds: ["view-record"], p1ActionIds: [] },
    targetOrigin: "https://staging.example.test",
  })).toThrow(/exit code/);
  expect(() => assertAcceptanceReportSemantics(report, {
    requireCandidateAudit: true,
    targetAcceptance: { p0ActionIds: ["other-action"], p1ActionIds: [] },
    targetOrigin: "https://staging.example.test",
  })).toThrow(/requiredActionIds/);

  const runnerOptions = {
    requireCandidateAudit: true,
    requireEligibleHandoff: false,
    targetAcceptance: { p0ActionIds: ["view-record"], p1ActionIds: [] },
    targetOrigin: "https://staging.example.test",
  };
  const failedOutcomeReport = {
    ...report,
    actual: { outcome: "failed", terminationReason: "oracle_failure", exitCode: 2 },
    verdict: "failed",
  };
  expect(() => assertAcceptanceReportSemantics(failedOutcomeReport, runnerOptions)).not.toThrow();
  expect(() => assertAcceptanceReportSemantics(failedOutcomeReport, {
    ...runnerOptions,
    requireEligibleHandoff: true,
  })).toThrow(/eligible for external handoff/);

  const failedAuditReport = {
    ...report,
    candidateAudit: {
      ...candidateAudit,
      candidateCount: 0,
      coverageDebtCount: 1,
      debtByReason: { unmapped_control: 1 },
      observedActionIds: [],
      debtActionIds: ["view-record"],
      eligible: false,
      violations: ["candidate_coverage_debt_present", "required_action_coverage_debt:view-record"],
    },
    verdict: "failed",
  };
  await expect(assertSchema(failedAuditReport, "lakda-extension-acceptance-case-v2.schema.json", "failed report")).resolves.toBeUndefined();
  expect(() => assertAcceptanceReportSemantics(failedAuditReport, runnerOptions)).not.toThrow();
});

test("portable run paths reject traversal segments before filesystem access", () => {
  expect(() => portableRunPath(resolve("runs/example"), "adaptive/../oracle-results.jsonl")).toThrow(AcceptanceInputError);
  expect(() => portableRunPath(resolve("runs/example"), "adaptive\\oracle-results.jsonl")).toThrow(AcceptanceInputError);
  expect(() => portableRunPath(resolve("runs/example"), "C:/adaptive/oracle-results.jsonl")).toThrow(AcceptanceInputError);
});

test("HATE verification rejects a junction or symlink that resolves outside the run root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "lakda-hate-realpath-"));
  const runDir = join(parent, "run");
  const outside = join(parent, "outside");
  const manifestPath = join(runDir, "exports", "artifact-manifest.json");
  try {
    await Promise.all([
      mkdir(join(runDir, "exports"), { recursive: true }),
      mkdir(outside, { recursive: true }),
    ]);
    const evidenceText = JSON.stringify({ outcome: "passed" });
    await writeFile(join(outside, "outcome.json"), evidenceText, "utf8");
    await symlink(outside, join(runDir, "escaped"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(manifestPath, JSON.stringify({
      schema_version: "HATE/v1",
      run_id: "escape-run",
      run_attempt: 1,
      commit_sha: "abcdef0",
      artifacts: [{
        artifact_id: "escape-evidence",
        kind: "report",
        path: "escaped/outcome.json",
        sha256: sha256(evidenceText),
        size_bytes: Buffer.byteLength(evidenceText),
        classification: "internal",
        redaction_status: "not_required",
        redaction_rule_version: "lakda-test/v1",
        safe_for_summary: true,
        public_exposure: "none",
        retention: { class: "default", days: 14 },
        security_checks: { secrets_scan: "pass", pii_scan: "pass" },
      }],
    }), "utf8");
    await expect(verifyHateArtifacts(manifestPath, {
      runDir,
      expectedManifestPath: "exports/artifact-manifest.json",
    })).rejects.toThrow(/resolves outside run directory/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
