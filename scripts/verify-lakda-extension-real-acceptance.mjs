import { dirname, resolve } from "node:path";

import {
  AcceptanceInputError,
  assertAcceptanceReportSemantics,
  assertManifestIdentity,
  assertReportBound,
  assertTargetManifestBinding,
  loadReadyTargetManifest,
  readJsonRecord,
  verifyHateArtifacts,
} from "../dist/acceptance/common.js";

function pending(reason) {
  console.error(JSON.stringify({
    schemaVersion: "lakda/extension-acceptance-pending/v1",
    status: "pending_external",
    reason,
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
  }));
  process.exitCode = 2;
}

async function main() {
  const reportPath = (process.env.LAKDA_EXTENSION_REAL_REPORT ?? process.env.LAKDA_EXTENSION_REAL_REPORT_PATH)?.trim();
  if (!reportPath) throw new AcceptanceInputError("LAKDA_EXTENSION_REAL_REPORT is required");

  const unvalidated = await readJsonRecord(resolve(reportPath), "extension case report");
  const version = unvalidated.value?.schemaVersion;
  const schemaName = version === "lakda/extension-acceptance-case/v1"
    ? "lakda-extension-acceptance-case-v1.schema.json"
    : version === "lakda/extension-acceptance-case/v2"
      ? "lakda-extension-acceptance-case-v2.schema.json"
      : undefined;
  if (!schemaName) throw new AcceptanceInputError("extension case report version is unsupported");
  const reportRecord = await readJsonRecord(resolve(reportPath), "extension case report", schemaName, true);
  const report = reportRecord.value;

  if (report.executionMode !== "real" || report.qegHandoff.status !== "pending_external" || report.qegHandoff.verdictGeneratedByLakda !== false) {
    throw new AcceptanceInputError("report is not eligible for external handoff");
  }
  const expectedRevision = process.env.LAKDA_EXTENSION_REAL_TARGET_REVISION?.trim();
  if (expectedRevision && expectedRevision !== report.revision) throw new AcceptanceInputError("target revision mismatch");

  let target;
  if (version === "lakda/extension-acceptance-case/v2") {
    const targetPath = process.env.LAKDA_EXTENSION_REAL_TARGET_MANIFEST?.trim();
    if (!targetPath) throw new AcceptanceInputError("LAKDA_EXTENSION_REAL_TARGET_MANIFEST is required for v2 verification");
    target = await loadReadyTargetManifest(resolve(targetPath));
    if (target.sha256 !== report.targetManifest.sha256 || target.value.manifestId !== report.targetManifest.manifestId) {
      throw new AcceptanceInputError("target manifest identity mismatch");
    }
    assertTargetManifestBinding(target.value, report.revision, report.configDigest);
  }
  assertAcceptanceReportSemantics(report, target ? {
    requireCandidateAudit: true,
    targetAcceptance: target.value.acceptance,
    targetOrigin: target.value.environment.baseUrlOrigin,
  } : {});

  const runDir = dirname(dirname(reportRecord.path));
  if (report.artifactManifestPath !== "exports/artifact-manifest.json") {
    throw new AcceptanceInputError("HATE manifest is not at the expected run location");
  }
  const manifestPath = resolve(runDir, report.artifactManifestPath);
  const verified = await verifyHateArtifacts(manifestPath, {
    runDir,
    expectedManifestPath: "exports/artifact-manifest.json",
  });
  assertManifestIdentity(verified, report.runId, report.attempt);
  await assertReportBound(verified, reportRecord.path, [...report.oracleResultRefs, ...report.hateArtifactRefs]);

  console.log(JSON.stringify({
    status: "pending_external",
    readiness: "ready_for_manual_bb_qeg",
    schemaVersion: report.schemaVersion,
    caseId: report.caseId,
    acceptanceId: report.acceptanceId,
    qegHandoff: report.qegHandoff,
  }));
  process.exitCode = 0;
}

try {
  await main();
} catch (error) {
  if (error instanceof AcceptanceInputError) pending(error.message);
  else {
    console.error(error instanceof Error ? error.message : "extension acceptance verification failed");
    process.exitCode = 1;
  }
}
