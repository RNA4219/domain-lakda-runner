import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { URL } from "node:url";

import {
  AcceptanceInputError,
  acceptanceFailureExitCode,
  applyTargetManifest,
  assertAcceptanceReportSemantics,
  assertCaseId,
  assertManifestIdentity,
  assertReportBound,
  assertSchema,
  assertTargetManifestBinding,
  loadReadyTargetManifest,
  readJsonRecord,
  requiredEnvironment,
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

function loadInputs() {
  if (process.env.LAKDA_EXTENSION_REAL_CONFIRM !== "I_UNDERSTAND") {
    throw new AcceptanceInputError("LAKDA_EXTENSION_REAL_CONFIRM=I_UNDERSTAND is required");
  }
  const caseId = requiredEnvironment("LAKDA_EXTENSION_REAL_CASE_ID");
  assertCaseId(caseId);
  const configPath = resolve(requiredEnvironment("LAKDA_EXTENSION_REAL_CONFIG", ["LAKDA_EXTENSION_REAL_CONFIG_PATH"]));
  const corpusPath = resolve(requiredEnvironment("LAKDA_EXTENSION_REAL_CORPUS", ["LAKDA_EXTENSION_REAL_CORPUS_PATH"]));
  const targetManifestPath = resolve(requiredEnvironment("LAKDA_EXTENSION_REAL_TARGET_MANIFEST"));
  if (!existsSync(configPath) || !existsSync(corpusPath)) throw new AcceptanceInputError("real extension environment input is unavailable");
  return {
    configPath,
    corpusPath,
    targetManifestPath,
    caseId,
    environment: requiredEnvironment("LAKDA_EXTENSION_REAL_ENVIRONMENT"),
    targetRevision: requiredEnvironment("LAKDA_EXTENSION_REAL_TARGET_REVISION"),
  };
}

async function readCandidateSnapshots(verified) {
  const ref = verified.refs.filter(value => value.path === "adaptive/candidate-snapshots.jsonl");
  if (ref.length !== 1) throw new Error("real extension acceptance requires exactly one candidate snapshot artifact");
  const text = (await readFile(resolve(verified.runDir, ref[0].path), "utf8")).trim();
  if (!text) return [];
  try { return text.split(/\r?\n/).map(line => JSON.parse(line)); }
  catch { throw new Error("candidate snapshot artifact is invalid JSONL"); }
}

async function main() {
  const input = loadInputs();
  const corpusRecord = await readJsonRecord(input.corpusPath, "extension acceptance corpus", "lakda-extension-acceptance-corpus-v1.schema.json", true);
  const corpus = corpusRecord.value;
  if (corpus.targetRevision !== input.targetRevision) throw new AcceptanceInputError("target revision does not match immutable corpus");
  const selected = corpus.cases.find(entry => entry.caseId === input.caseId);
  if (!selected) throw new AcceptanceInputError("case is absent from immutable corpus");

  const configRecord = await readJsonRecord(input.configPath, "config");
  if (configRecord.sha256 !== selected.configDigest) throw new AcceptanceInputError("config digest does not match immutable corpus case");

  // Target approval and scope are validated before loading the browser runner.
  const targetManifest = await loadReadyTargetManifest(input.targetManifestPath);
  assertTargetManifestBinding(targetManifest.value, input.targetRevision, selected.configDigest);
  const [{ loadConfig }, { runLakda }, { exportHate }, { writeJsonAtomic }, { auditTargetCandidateCoverage }] = await Promise.all([
    import("../dist/core/config.js"),
    import("../dist/core/runner.js"),
    import("../dist/core/hate.js"),
    import("../dist/core/artifact-store.js"),
    import("../dist/adaptive/target-candidate-audit.js"),
  ]);

  let config;
  try { config = loadConfig(input.configPath); }
  catch (error) { throw new AcceptanceInputError("real extension acceptance config is invalid: " + (error instanceof Error ? error.message : "unknown config error")); }
  if (config.mode !== "adaptive-explore") throw new AcceptanceInputError("real extension acceptance requires mode=adaptive-explore");
  applyTargetManifest(config, targetManifest.value);

  const result = await runLakda(config);
  if (!result.artifactManifestPath) throw new Error("real execution did not produce HATE manifest");
  const initial = await verifyHateArtifacts(result.artifactManifestPath, { expectedManifestPath: "exports/artifact-manifest.json" });
  assertManifestIdentity(initial, result.runId, result.attempt);
  const oracleResultRefs = initial.refs.filter(ref => ref.path === "adaptive/oracle-results.jsonl");
  if (oracleResultRefs.length !== 1) throw new Error("exactly one OracleResult artifact is required");

  const candidateAudit = auditTargetCandidateCoverage(await readCandidateSnapshots(initial), targetManifest.value.acceptance);
  const reportPath = resolve(initial.runDir, "adaptive", "extension-acceptance-case-" + input.caseId + ".json");
  const passed = result.outcome === selected.expected.outcome && candidateAudit.eligible;
  const report = {
    schemaVersion: "lakda/extension-acceptance-case/v2",
    acceptanceId: "AC-LX-014",
    caseId: input.caseId,
    runId: result.runId,
    attempt: result.attempt,
    revision: input.targetRevision,
    configDigest: selected.configDigest,
    executionMode: "real",
    environment: { label: input.environment, origin: new URL(config.baseUrl).origin, adapterId: config.adaptive.adapter.id },
    corpus: {
      corpusId: corpus.corpusId,
      version: corpus.version,
      sha256: corpusRecord.sha256,
      targetRevision: corpus.targetRevision,
      caseConfigDigest: selected.configDigest,
    },
    targetManifest: { manifestId: targetManifest.value.manifestId, sha256: targetManifest.sha256 },
    expected: selected.expected,
    actual: { outcome: result.outcome, terminationReason: result.terminationReason, exitCode: result.exitCode },
    oracleResultRefs,
    hateArtifactRefs: initial.refs,
    artifactManifestPath: relative(initial.runDir, initial.manifestPath).replaceAll("\\", "/"),
    candidateAudit,
    verdict: passed ? "passed" : "failed",
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
    generatedAt: new Date().toISOString(),
  };
  await assertSchema(report, "lakda-extension-acceptance-case-v2.schema.json", "extension case report");
  assertAcceptanceReportSemantics(report, {
    requireCandidateAudit: true,
    requireEligibleHandoff: false,
    targetAcceptance: targetManifest.value.acceptance,
    targetOrigin: targetManifest.value.environment.baseUrlOrigin,
  });
  await writeJsonAtomic(reportPath, report);
  await exportHate(initial.runDir, initial.manifestPath);

  const final = await verifyHateArtifacts(initial.manifestPath, { runDir: initial.runDir, expectedManifestPath: "exports/artifact-manifest.json" });
  assertManifestIdentity(final, result.runId, result.attempt);
  await assertReportBound(final, reportPath, [...report.oracleResultRefs, ...report.hateArtifactRefs]);
  console.log(JSON.stringify({
    status: "pending_external",
    caseReportPath: reportPath,
    artifactManifestPath: final.manifestPath,
    caseId: input.caseId,
    verdict: report.verdict,
    candidateAuditEligible: candidateAudit.eligible,
  }));
  process.exitCode = report.verdict === "passed" ? 0 : 2;
}

try {
  await main();
} catch (error) {
  if (acceptanceFailureExitCode(error) === 2) pending(error.message);
  else {
    console.error(error instanceof Error ? error.message : "extension real acceptance failed");
    process.exitCode = 1;
  }
}
