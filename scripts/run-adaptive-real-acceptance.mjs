import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

function loadInputs() {
  if (process.env.LAKDA_ADAPTIVE_REAL_CONFIRM !== "I_UNDERSTAND") {
    throw new AcceptanceInputError("real adaptive acceptance requires LAKDA_ADAPTIVE_REAL_CONFIRM=I_UNDERSTAND");
  }
  const caseId = requiredEnvironment("LAKDA_ADAPTIVE_CASE_ID");
  assertCaseId(caseId);
  const configPath = resolve(requiredEnvironment("LAKDA_ADAPTIVE_REAL_CONFIG"));
  const corpusPath = resolve(requiredEnvironment("LAKDA_ADAPTIVE_CORPUS_PATH"));
  if (!existsSync(configPath)) throw new AcceptanceInputError("real adaptive acceptance config is unavailable");
  if (!existsSync(corpusPath)) throw new AcceptanceInputError("real adaptive acceptance corpus is unavailable");
  return {
    configPath,
    corpusPath,
    caseId,
    environment: requiredEnvironment("LAKDA_ADAPTIVE_ENVIRONMENT"),
    targetRevision: requiredEnvironment("LAKDA_ADAPTIVE_TARGET_REVISION"),
  };
}

async function readCandidateSnapshots(verified) {
  const refs = verified.refs.filter(ref => ref.path === "adaptive/candidate-snapshots.jsonl");
  if (refs.length !== 1) throw new Error("real adaptive acceptance requires exactly one candidate snapshot artifact");
  const source = (await readFile(resolve(verified.runDir, refs[0].path), "utf8")).trim();
  if (!source) return [];
  try { return source.split(/\r?\n/).map(line => JSON.parse(line)); }
  catch { throw new Error("candidate snapshot artifact is invalid JSONL"); }
}

async function readAdaptiveTrace(verified) {
  const refs = verified.refs.filter(ref => ref.path === "adaptive/trace.json");
  if (refs.length !== 1) throw new Error("real adaptive acceptance requires exactly one adaptive trace artifact");
  try {
    const value = JSON.parse(await readFile(resolve(verified.runDir, refs[0].path), "utf8"));
    if (!Array.isArray(value.trace)) throw new Error("missing trace");
    return value.trace;
  } catch {
    throw new Error("adaptive trace artifact is invalid");
  }
}

function buildSecurityAudit(trace, config, target) {
  const authorization = config.adaptive.securityAuthorization;
  const security = target.security;
  if (!authorization || !security) throw new AcceptanceInputError("security acceptance requires bound authorization");
  const policies = trace.filter(entry => entry?.type === "security-policy");
  const allowed = policies.filter(entry => entry.decision === "allowed");
  const denied = policies.filter(entry => entry.decision === "denied");
  const permits = trace.filter(entry => entry?.type === "security-permit");
  const cleanup = trace.filter(entry => entry?.type === "security-cleanup");
  const killSwitch = trace.filter(entry => entry?.type === "security-kill-switch");
  const permitReceiptRefs = [...new Set(permits.map(entry => entry.permitReceiptRef).filter(value => typeof value === "string"))].sort();
  const cleanupRefs = [...new Set(cleanup.map(entry => entry.cleanupRef).filter(value => typeof value === "string"))].sort();
  const violations = [];
  if (policies.length < 1) violations.push("policy_evaluation_missing");
  if (killSwitch.length < 1) violations.push("kill_switch_check_missing");
  if (cleanup.some(entry => entry.completed !== true)) violations.push("cleanup_failed");
  if (policies.some(entry => entry.authorizationId !== authorization.authorizationId || entry.authorizationRef !== authorization.approvalEvidenceRef || entry.securityProfileRef !== config.adaptive.securityProfileRef || entry.targetRevision !== authorization.targets.targetRevision)) violations.push("policy_binding_mismatch");
  if (permits.some(entry => entry.authorizationId !== authorization.authorizationId || entry.targetRevision !== authorization.targets.targetRevision || entry.securityProfileDigest !== authorization.binding.securityProfileDigest || entry.capabilityDigest !== authorization.binding.capabilityDigest || entry.bridgeDigest !== authorization.binding.bridgeDigest)) violations.push("permit_binding_mismatch");
  if (security.acceptanceMode === "deny-all") {
    if (allowed.length || permitReceiptRefs.length || cleanup.length) violations.push("deny_all_started_request");
  } else if (!allowed.length || !permitReceiptRefs.length || !cleanup.length) {
    violations.push("authorized_execution_evidence_missing");
  }
  const normalized = [...new Set(violations)].sort();
  return {
    schemaVersion: "lakda/security-acceptance-audit/v1",
    acceptanceMode: security.acceptanceMode,
    authorizationRef: authorization.approvalEvidenceRef,
    securityProfileRef: config.adaptive.securityProfileRef,
    bindingDigests: authorization.binding,
    policyEvaluationCount: policies.length,
    allowedPolicyCount: allowed.length,
    deniedPolicyCount: denied.length,
    startedRequestCount: permitReceiptRefs.length,
    permitReceiptRefs,
    cleanupRefs,
    cleanupAttempts: cleanup.length,
    cleanupFailures: cleanup.filter(entry => entry.completed !== true).length,
    killSwitchChecks: killSwitch.length,
    eligible: normalized.length === 0,
    violations: normalized,
  };
}

async function main() {
  const input = loadInputs();
  let corpusRecord;
  try {
    corpusRecord = await readJsonRecord(input.corpusPath, "adaptive acceptance corpus", "adaptive-acceptance-corpus-v1.schema.json", true);
  } catch (error) {
    if (error instanceof AcceptanceInputError && /cases\//.test(error.message)) throw new AcceptanceInputError("adaptive acceptance case contract is invalid");
    throw error;
  }
  const corpus = corpusRecord.value;
  if (corpus.targetRevision !== input.targetRevision) throw new AcceptanceInputError("target revision does not match immutable corpus");
  const selected = corpus.cases.find(entry => entry.caseId === input.caseId);
  if (!selected) throw new AcceptanceInputError("requested case is absent from adaptive acceptance corpus");
  const securityAcceptance = selected.acceptanceId === "AC-AE-016";

  const configRecord = await readJsonRecord(input.configPath, "config");
  if (configRecord.sha256 !== selected.configDigest) throw new AcceptanceInputError("config digest does not match immutable corpus case");
  const targetManifest = await loadReadyTargetManifest(resolve(requiredEnvironment("LAKDA_ADAPTIVE_TARGET_MANIFEST")));
  assertTargetManifestBinding(targetManifest.value, input.targetRevision, selected.configDigest);
  if (securityAcceptance && targetManifest.value.schemaVersion !== "lakda/target-manifest/v2") {
    throw new AcceptanceInputError("AC-AE-016 requires a signed target manifest v2");
  }

  const [{ loadConfig }, { runLakda }, { exportHate }, { writeJsonAtomic }, { auditTargetCandidateCoverage }] = await Promise.all([
    import("../dist/core/config.js"),
    import("../dist/core/runner.js"),
    import("../dist/core/hate.js"),
    import("../dist/core/artifact-store.js"),
    import("../dist/adaptive/target-candidate-audit.js"),
  ]);
  let config;
  try { config = loadConfig(input.configPath); }
  catch (error) { throw new AcceptanceInputError("real adaptive acceptance config is invalid: " + (error instanceof Error ? error.message : "unknown config error")); }
  if (config.mode !== "adaptive-explore") throw new AcceptanceInputError("real adaptive acceptance requires mode=adaptive-explore");
  applyTargetManifest(config, targetManifest.value);
  if (securityAcceptance && (config.adaptive.adapter.id !== "security" || config.adaptive.securityEnvironment !== input.environment)) {
    throw new AcceptanceInputError("AC-AE-016 requires the security adapter and a matching independent environment");
  }

  const result = await runLakda(config);
  if (!result.artifactManifestPath) throw new Error("real adaptive acceptance requires a HATE manifest");
  const initial = await verifyHateArtifacts(result.artifactManifestPath, { expectedManifestPath: "exports/artifact-manifest.json" });
  assertManifestIdentity(initial, result.runId, result.attempt);
  const oracleResultRefs = initial.manifest.artifacts.filter(artifact => artifact.path === "adaptive/oracle-results.jsonl");
  if (oracleResultRefs.length !== 1) throw new Error("real adaptive acceptance requires exactly one OracleResult artifact");

  const candidateAudit = auditTargetCandidateCoverage(await readCandidateSnapshots(initial), targetManifest.value.acceptance);
  const securityAudit = securityAcceptance ? buildSecurityAudit(await readAdaptiveTrace(initial), config, targetManifest.value) : undefined;
  const passed = result.outcome === selected.expected.outcome && candidateAudit.eligible && (securityAudit?.eligible ?? true);
  const ineligibilityReason = !candidateAudit.eligible
    ? "target_candidate_audit:" + candidateAudit.violations.join(",")
    : securityAudit && !securityAudit.eligible
      ? "security_audit:" + securityAudit.violations.join(",")
      : passed ? null : "outcome_mismatch";
  const reportPath = resolve(initial.runDir, "adaptive", "acceptance-case-" + input.caseId + ".json");
  const report = {
    schemaVersion: securityAcceptance ? "lakda/adaptive-acceptance-case/v2" : "lakda/adaptive-acceptance-case/v1",
    acceptanceId: selected.acceptanceId,
    caseId: input.caseId,
    runId: result.runId,
    attempt: result.attempt,
    revision: corpus.targetRevision,
    runnerRevision: initial.manifest.commit_sha,
    executionMode: "real",
    environment: { label: input.environment, origin: new URL(config.baseUrl).origin, adapterId: config.adaptive.adapter.id },
    runtime: { nodeVersion: process.version, platform: process.platform, arch: process.arch },
    seed: config.seed,
    configDigest: configRecord.sha256,
    targetManifest: {
      manifestId: targetManifest.value.manifestId,
      sha256: targetManifest.sha256,
      ...(securityAcceptance ? { schemaVersion: targetManifest.value.schemaVersion } : {}),
    },
    corpus: {
      corpusId: corpus.corpusId,
      version: corpus.version,
      sha256: corpusRecord.sha256,
      targetRevision: corpus.targetRevision,
      caseConfigDigest: selected.configDigest,
    },
    expected: selected.expected,
    actual: { outcome: result.outcome, terminationReason: result.terminationReason, exitCode: result.exitCode },
    oracleResultRefs,
    artifactRefs: initial.manifest.artifacts,
    candidateAudit,
    ...(securityAudit ? { securityAudit } : {}),
    verdict: passed ? "passed" : "failed",
    ineligibilityReason,
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
    generatedAt: new Date().toISOString(),
  };
  await assertSchema(report, securityAcceptance ? "adaptive-acceptance-case-v2.schema.json" : "adaptive-acceptance-case-v1.schema.json", "adaptive acceptance case report");
  assertAcceptanceReportSemantics(report, {
    requireCandidateAudit: true,
    requireSecurityAudit: securityAcceptance,
    requireEligibleHandoff: false,
    targetAcceptance: targetManifest.value.acceptance,
    targetOrigin: targetManifest.value.environment.baseUrlOrigin,
  });
  await writeJsonAtomic(reportPath, report);
  await exportHate(initial.runDir, initial.manifestPath);

  const final = await verifyHateArtifacts(initial.manifestPath, { runDir: initial.runDir, expectedManifestPath: "exports/artifact-manifest.json" });
  assertManifestIdentity(final, result.runId, result.attempt);
  await assertReportBound(final, reportPath, [...report.oracleResultRefs, ...report.artifactRefs]);
  console.log(JSON.stringify({
    caseReportPath: reportPath,
    artifactManifestPath: final.manifestPath,
    acceptanceId: report.acceptanceId,
    caseId: report.caseId,
    verdict: report.verdict,
  }));
  process.exitCode = passed ? 0 : 2;
}

try {
  await main();
} catch (error) {
  if (acceptanceFailureExitCode(error) === 2) {
    console.error(JSON.stringify({
      schemaVersion: "lakda/adaptive-acceptance-pending/v1",
      status: "pending_external",
      reason: error.message,
      qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
    }));
    process.exitCode = 2;
  } else {
    console.error(error instanceof Error ? error.message : "real adaptive acceptance failed");
    process.exitCode = 1;
  }
}
