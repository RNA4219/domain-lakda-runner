import { dirname, resolve } from "node:path";

import {
  AcceptanceInputError,
  assertAcceptanceReportSemantics,
  assertManifestIdentity,
  assertReportBound,
  assertSchema,
  digest,
  readJsonRecord,
  requiredEnvironment,
  resolveRunFile,
  verifyHateArtifacts,
} from "../dist/acceptance/common.js";

const expectedAcceptanceIds = [
  "AC-AE-001", "AC-AE-002", "AC-AE-003", "AC-AE-004",
  "AC-AE-005", "AC-AE-006", "AC-AE-007", "AC-AE-008",
  "AC-AE-009", "AC-AE-010", "AC-AE-011", "AC-AE-012",
  "AC-AE-013", "AC-AE-014", "AC-AE-015", "AC-AE-016",
];

function pending(reason) {
  console.error(JSON.stringify({
    schemaVersion: "lakda/adaptive-acceptance-pending/v1",
    status: "pending_external",
    reason,
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
  }));
  process.exitCode = 2;
}

async function main() {
  const indexPath = resolve(requiredEnvironment("LAKDA_ADAPTIVE_SUITE_INDEX"));
  const indexRoot = dirname(indexPath);
  const indexRecord = await readJsonRecord(indexPath, "P7 suite index", "adaptive-acceptance-suite-index-v1.schema.json", true);

  const acceptanceIds = new Set();
  const caseIds = new Set();
  const reportPaths = new Set();
  if (indexRecord.value.reports.length !== expectedAcceptanceIds.length) {
    throw new AcceptanceInputError("P7 suite must contain exactly 16 case reports");
  }
  let cohortKey;
  for (const entry of indexRecord.value.reports) {
    const resolvedReport = await resolveRunFile(indexRoot, entry.path, "case report");
    const canonicalReportPath = process.platform === "win32" ? resolvedReport.portable.toLowerCase() : resolvedReport.portable;
    if (reportPaths.has(canonicalReportPath)) throw new AcceptanceInputError("P7 suite index contains a duplicate report path");
    reportPaths.add(canonicalReportPath);

    const reportRecord = await readJsonRecord(resolvedReport.path, "case report", "adaptive-acceptance-case-v1.schema.json", true);
    if (reportRecord.sha256 !== entry.sha256) throw new AcceptanceInputError("case report digest mismatch: " + entry.path);
    const report = reportRecord.value;
    if (caseIds.has(report.caseId)) throw new AcceptanceInputError("P7 suite contains a duplicate case ID: " + report.caseId);
    caseIds.add(report.caseId);
    if (acceptanceIds.has(report.acceptanceId)) throw new AcceptanceInputError("P7 suite contains a duplicate acceptance ID: " + report.acceptanceId);
    const currentCohortKey = JSON.stringify([
      report.corpus.corpusId, report.corpus.version, report.corpus.sha256,
      report.corpus.targetRevision, report.runnerRevision,
    ]);
    if (cohortKey === undefined) cohortKey = currentCohortKey;
    else if (cohortKey !== currentCohortKey) throw new AcceptanceInputError("P7 suite contains a mixed corpus or runner revision cohort");
    if (report.ineligibilityReason !== null) throw new AcceptanceInputError("P7 suite contains an ineligible case: " + report.caseId);
    assertAcceptanceReportSemantics(report, { requireCandidateAudit: true });

    const runDir = dirname(dirname(reportRecord.path));
    const verified = await verifyHateArtifacts(resolve(runDir, "exports", "artifact-manifest.json"), {
      runDir,
      expectedManifestPath: "exports/artifact-manifest.json",
    });
    assertManifestIdentity(verified, report.runId, report.attempt);
    if (verified.manifest.commit_sha !== report.runnerRevision) throw new AcceptanceInputError("HATE manifest commit does not match case report");
    await assertReportBound(verified, reportRecord.path, [...report.artifactRefs, ...report.oracleResultRefs]);
    acceptanceIds.add(report.acceptanceId);
  }

  const missing = expectedAcceptanceIds.filter(id => !acceptanceIds.has(id));
  if (missing.length) throw new AcceptanceInputError("suite is missing acceptance IDs: " + missing.join(", "));

  const readiness = {
    schemaVersion: "lakda/adaptive-acceptance-suite-readiness/v1",
    suiteId: indexRecord.value.suiteId,
    version: indexRecord.value.version,
    indexDigest: digest(indexRecord.bytes),
    reportCount: indexRecord.value.reports.length,
    acceptanceIds: [...acceptanceIds].sort(),
    status: "ready_for_manual_bb_qeg",
    p7Status: "pending_external",
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
  };
  await assertSchema(readiness, "adaptive-acceptance-suite-readiness-v1.schema.json", "suite readiness");
  console.log(JSON.stringify(readiness));
}

try {
  await main();
} catch (error) {
  if (error instanceof AcceptanceInputError) pending(error.message);
  else {
    console.error(error instanceof Error ? error.message : "P7 suite verification failed");
    process.exitCode = 1;
  }
}
