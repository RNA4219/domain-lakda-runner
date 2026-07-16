import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson } from "../dist/core/plan.js";
import { findSensitive } from "../dist/core/redaction.js";
import { fileSha256, verifyAcceptanceReport } from "./real-llm-evidence.mjs";
import { verifyManualReleaseEvidence } from "./manual-release-evidence.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const shaRef = value => "sha256:" + value;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function artifact(id, adapter, kind, path, hash, revision) {
  return { id, adapter, kind, path, contentHash: shaRef(hash), revision };
}

function trace(sourceId, path) {
  return { sourceRefs: [{ id: sourceId, path }], assumptions: [], confidence: "high" };
}

async function writeSummary(outDir, name, value) {
  const dir = join(outDir, "artifacts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  const text = JSON.stringify(value, null, 2) + "\n";
  assert(findSensitive(text).length === 0, "summary security scan失敗: " + name);
  await writeFile(path, text, "utf8");
  return { path: "artifacts/" + name, sha256: await fileSha256(path) };
}

function requireCtg(readiness, triage, revision) {
  assert(readiness.status === "passed" && readiness.completeness === "complete", "Code-to-gate strict readinessがpassしていません");
  assert(readiness.counts?.critical === 0 && readiness.counts?.high === 0, "Code-to-gateにCritical/Highがあります");
  const analyzedRevision = readiness.repo?.revision;
  assert(typeof analyzedRevision === "string" && /^[0-9a-f]{7,40}$/i.test(analyzedRevision) && revision.startsWith(analyzedRevision), "Code-to-gate対象revision不一致");
  assert((readiness.selfAnalysis?.broadSuppressions ?? 0) === 0, "Code-to-gateにblanket suppressionがあります");
  assert(triage.schemaVersion === "lakda/ctg-triage-verification/v1" && triage.status === "passed", "Code-to-gate Medium triage検証がありません");
  assert(triage.subjectRevision === analyzedRevision, "Code-to-gate triage対象revision不一致");
  assert(triage.counts?.critical === 0 && triage.counts?.high === 0 && triage.counts?.unclassified === 0 && triage.counts?.stale === 0, "Code-to-gate triageに未分類またはstaleがあります");
  assert(triage.counts?.medium === readiness.selfAnalysis?.rawMedium && triage.counts?.triaged === triage.counts?.medium, "Code-to-gate Medium件数とtriage件数が一致しません");
  assert(Array.isArray(triage.entries) && triage.entries.length === triage.counts.medium && new Set(triage.entries.map(entry => entry.fingerprint)).size === triage.entries.length, "Code-to-gate triage entryが不足または重複しています");
  assert(/^[0-9a-f]{64}$/.test(triage.inputs?.findings?.sha256 ?? "") && /^[0-9a-f]{64}$/.test(triage.inputs?.triage?.sha256 ?? ""), "Code-to-gate triage入力hashがありません");
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of triage.entries) {
    assert(entry.owner && entry.rationale && /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) && entry.dueDate >= today, "Code-to-gate triageの根拠・担当・期限が不正です");
  }
}

function requireHate(bundle, upstream, revision) {
  assert(bundle.metadata?.qegVersion === "HATE/v1", "HATE qeg-bundleではありません");
  assert(bundle.completeness?.partial === false && bundle.completeness?.parserFailures?.length === 0, "HATE evidenceが不完全です");
  const run = bundle.nodes?.find(node => node.kind === "run" && node.data?.base_sha);
  assert(run?.data?.base_sha === revision, "HATE qeg-bundleの対象revision不一致");
  assert(upstream.schema === "HATE/v1" && upstream.pinnedChecked && upstream.upstreamChecked, "HATE upstream検証が完了していません");
  assert(upstream.upstreamRevision === upstream.commit, "HATE upstream revision不一致");
}

function requireRand(audit, revision) {
  assert(audit.schemaVersion === "lakda/rand-release-summary/v1", "RanD release summaryのschemaが不正です");
  assert(audit.status === "ready" && audit.subjectRevision === revision, "RanD release summaryの対象revisionまたはstatusが不正です");
  assert(/^[0-9a-f]{64}$/i.test(audit.requirementsAuditPacketSha256 ?? "") && /^[0-9a-f]{64}$/i.test(audit.downstreamHandoffSha256 ?? ""), "RanD output hashがありません");
  assert(typeof audit.toolRevision === "string" && /^[0-9a-f]{40}$/i.test(audit.toolRevision), "RanD tool revisionがありません");
}

function requireReferenceStaging(summary, revision) {
  assert(summary.schemaVersion === "lakda/reference-staging-summary/v1", "reference staging summaryのschemaが不正です");
  assert(summary.status === "ready" && summary.subjectRevision === revision, "reference staging summaryの対象revisionまたはstatusが不正です");
  assert(typeof summary.targetRevision === "string" && summary.targetRevision.length > 0, "reference staging target revisionがありません");
  assert(/^sha256:[0-9a-f]{64}$/i.test(summary.configDigest ?? "") && /^sha256:[0-9a-f]{64}$/i.test(summary.corpus?.sha256 ?? ""), "reference staging configまたはcorpus digestが不正です");
  assert(/^sha256:[0-9a-f]{64}$/i.test("sha256:" + (summary.reportSha256 ?? "")) && /^sha256:[0-9a-f]{64}$/i.test("sha256:" + (summary.verificationSha256 ?? "")), "reference staging report hashがありません");
}
export async function assembleReleaseQegInput(options) {
  const revision = options.revision;
  const releaseVersion = options.releaseVersion;
  assert(/^[0-9a-f]{40}$/i.test(revision), "revisionは40桁Git SHAが必要です");
  assert(/^\d+\.\d+\.\d+-rc\.\d+$/.test(releaseVersion ?? ""), "releaseVersionはrc semverが必要です");
  const full = await verifyAcceptanceReport({ reportPath: options.fullReport, bundlePath: options.fullBundle });
  const smoke = await verifyAcceptanceReport({ reportPath: options.workerReport, bundlePath: options.workerBundle });
  assert(full.profile === "full" && full.overall && full.subjectRevision === revision, "full 90-runが対象revisionで完了していません");
  assert(smoke.profile === "worker-smoke" && smoke.overall && smoke.subjectRevision === revision, "worker-smoke 20-runが対象revisionで完了していません");
  const manual = await verifyManualReleaseEvidence({ recordPath: options.manualRecord, expectedRevision: revision });
  if (options.stagingOrigin) assert(manual.record.environment.baseUrlOrigin === options.stagingOrigin, "workflow staging URLとmanual evidenceが不一致です");
  const referenceStaging = await readJson(options.referenceStaging);
  requireReferenceStaging(referenceStaging, revision);
  const rand = await readJson(options.randAudit);
  const ctg = await readJson(options.ctgReadiness);
  const ctgTriage = await readJson(options.ctgTriage);
  const ctgQeg = await readJson(options.ctgQeg);
  const hate = await readJson(options.hateBundle);
  const upstream = await readJson(options.hateUpstream);
  requireRand(rand, revision);
  requireCtg(ctg, ctgTriage, revision);
  requireHate(hate, upstream, revision);
  assert(ctgQeg.version === "ctg.qeg-input/v1" && ctgQeg.producer === "code-to-gate" && ctgQeg.readiness_status === "passed", "Code-to-gate QEG handoff schema/status不一致");
  assert(Array.isArray(ctgQeg.schema_compliance) && ctgQeg.schema_compliance.every(entry => entry.status === "ok"), "Code-to-gate QEG handoff schema compliance不一致");
  const ctgHashes = new Map((ctgQeg.artifact_hashes ?? []).map(entry => [entry.artifact, String(entry.hash).replace(/^sha256:/, "")]));
  assert(ctgHashes.get("release-readiness.json") === await fileSha256(options.ctgReadiness), "Code-to-gate readiness hashがhandoffと一致しません");
  assert(ctgHashes.get("findings.json") === ctgTriage.inputs.findings.sha256, "Code-to-gate findings hashがtriageとhandoffで一致しません");

  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const summaries = {
    rand: await writeSummary(outDir, "rand-summary.json", rand),
    referenceStaging: await writeSummary(outDir, "reference-staging-summary.json", referenceStaging),
    full: await writeSummary(outDir, "real-llm-full-summary.json", full),
    smoke: await writeSummary(outDir, "real-llm-worker-smoke-summary.json", smoke),
    manual: await writeSummary(outDir, "manual-summary.json", {
      schemaVersion: "lakda/manual-bb-summary/v1",
      subjectRevision: revision,
      testExecutionMode: "real",
      operator: manual.record.operator,
      environment: { name: "reference-staging", baseUrlOrigin: manual.record.environment.baseUrlOrigin, allowHosts: manual.record.environment.allowHosts },
      executionCount: manual.executionCount,
      recordSha256: manual.recordSha256,
      cases: manual.manualEvidence.map(value => ({ id: value.executedCaseId, result: value.result, expectedResult: value.expectedResult })),
    }),
    ctg: await writeSummary(outDir, "ctg-summary.json", {
      schemaVersion: "lakda/ctg-summary/v1",
      subjectRevision: revision,
      sourceSha256: await fileSha256(options.ctgReadiness),
      qegHandoffSha256: await fileSha256(options.ctgQeg),
      triageVerificationSha256: await fileSha256(options.ctgTriage),
      status: ctg.status,
      completeness: ctg.completeness,
      counts: ctg.counts,
      triagedMedium: ctgTriage.counts.medium,
      triageEntries: ctgTriage.entries,
    }),
    hate: await writeSummary(outDir, "hate-summary.json", {
      schemaVersion: "lakda/hate-summary/v1",
      subjectRevision: revision,
      qegBundleSha256: await fileSha256(options.hateBundle),
      upstream,
      completeness: hate.completeness,
      nodeCount: hate.nodes.length,
      edgeCount: hate.edges.length,
    }),
  };

  const inputArtifacts = [
    artifact("rand:artifact-requirements-audit", "rand", "requirements-audit", summaries.rand.path, summaries.rand.sha256, revision),
    artifact("hate:artifact-real-llm-full", "lakda-v2-verifier", "real-llm-acceptance", summaries.full.path, summaries.full.sha256, revision),
    artifact("hate:artifact-worker-smoke", "lakda-v2-verifier", "worker-smoke", summaries.smoke.path, summaries.smoke.sha256, revision),
    artifact("mbb:artifact-reference-staging", "manual-bb-test-harness", "execution_evidence", summaries.manual.path, summaries.manual.sha256, revision),
    artifact("ctg:artifact-readiness", "code-to-gate", "release-readiness", summaries.ctg.path, summaries.ctg.sha256, revision),
    artifact("hate:artifact-qeg-bundle", "hate", "qeg-bundle", summaries.hate.path, summaries.hate.sha256, revision),
    artifact("lakda:artifact-reference-staging", "lakda", "reference-staging-real-acceptance", summaries.referenceStaging.path, summaries.referenceStaging.sha256, revision),
  ];
  const releaseId = releaseVersion.replace(/[^A-Za-z0-9]+/g, "-");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const metadata = {
    qegVersion: "0.2",
    runId: "qeg:lakda-" + releaseId + "-" + revision.slice(0, 12),
    createdAt,
    profile: "strict",
    headRef: revision,
    inputArtifacts,
    requiredConnectorStatus: { "manual-bb-test-harness": "success", "code-to-gate": "success" },
    producerChecks: [
      { id: "rand:check-requirements-audit", producer: "rand", name: "requirements-audit", conclusion: "success", headSha: revision, sourceRefs: [{ id: "rand:sr-summary", path: summaries.rand.path, revision }] },
      { id: "ctg:check-strict", producer: "code-to-gate", name: "strict-readiness", conclusion: "success", readinessStatus: "passed", headSha: revision, sourceRefs: [{ id: "ctg:sr-readiness", path: summaries.ctg.path, revision }] },
      { id: "hate:check-upstream", producer: "hate", name: "upstream-and-bundle-validation", conclusion: "success", headSha: revision, sourceRefs: [{ id: "hate:sr-summary", path: summaries.hate.path, revision }] },
      { id: "mbb:check-reference-staging", producer: "manual-bb-test-harness", name: "real-reference-staging-manual-bb", conclusion: "success", headSha: revision, sourceRefs: [{ id: "mbb:sr-summary", path: summaries.manual.path, revision }] },
    ],
  };
  const requirementId = "qeg:req-lakda-" + releaseId + "-release";
  const acEvidenceId = "qeg:ac-rc5-evidence";
  const acGateId = "qeg:ac-rc5-gate";
  const nodes = [
    { id: requirementId, kind: "requirement", title: releaseVersion + " release evidence is revision-bound and independently verifiable", priority: "P0", acceptanceCriteriaIds: [acEvidenceId, acGateId], traceability: trace("qeg:sr-feature-spec", "docs/release-gate/feature_spec.json"), sourceArtifactIds: inputArtifacts.map(value => value.id) },
    { id: acEvidenceId, kind: "acceptance_criteria", title: "revision-bound deterministic, adaptive, package, and real acceptance evidence", requirementIds: [requirementId], traceability: trace("qeg:sr-ac-evidence", "docs/release-gate/feature_spec.json"), sourceArtifactIds: [inputArtifacts[0].id, inputArtifacts[1].id, inputArtifacts[2].id, inputArtifacts[5].id] },
    { id: acGateId, kind: "acceptance_criteria", title: "five-tool gate and real reference staging manual verification", requirementIds: [requirementId], traceability: trace("qeg:sr-ac-gate", "docs/release-gate/feature_spec.json"), sourceArtifactIds: inputArtifacts.map(value => value.id) },
    { id: "rand:evidence-requirements-audit", kind: "execution_evidence", title: "RanD requirements audit packet and handoff verified", passed: true, traceability: trace("rand:sr-audit", summaries.rand.path), sourceArtifactIds: [inputArtifacts[0].id] },
    { id: "lakda:evidence-reference-staging", kind: "execution_evidence", title: "Verified real reference staging P11 acceptance", passed: true, traceability: trace("lakda:sr-reference-staging", summaries.referenceStaging.path), sourceArtifactIds: [inputArtifacts[6].id] },
    { id: "hate:test-real-llm-full", kind: "test", title: "Real Qwen full 90 child runs", testExecutionMode: "real", evidenceStrength: 1, recentGreenRuns: 90, traceability: trace("hate:sr-full", summaries.full.path), sourceArtifactIds: [inputArtifacts[1].id] },
    { id: "hate:evidence-real-llm-full", kind: "execution_evidence", title: "Verified full acceptance bundle", passed: true, traceability: trace("hate:sr-full-evidence", summaries.full.path), sourceArtifactIds: [inputArtifacts[1].id] },
    { id: "hate:test-worker-smoke", kind: "test", title: "Real Qwen worker smoke 20 child runs", testExecutionMode: "real", evidenceStrength: 1, recentGreenRuns: 20, traceability: trace("hate:sr-smoke", summaries.smoke.path), sourceArtifactIds: [inputArtifacts[2].id] },
    { id: "hate:evidence-worker-smoke", kind: "execution_evidence", title: "Verified worker-smoke bundle", passed: true, traceability: trace("hate:sr-smoke-evidence", summaries.smoke.path), sourceArtifactIds: [inputArtifacts[2].id] },
    { id: "ctg:evidence-strict", kind: "execution_evidence", title: "Code-to-gate strict readiness passed", passed: true, traceability: trace("ctg:sr-strict", summaries.ctg.path), sourceArtifactIds: [inputArtifacts[4].id] },
    { id: "hate:evidence-upstream", kind: "execution_evidence", title: "HATE upstream and QEG export validated", passed: true, traceability: trace("hate:sr-upstream", summaries.hate.path), sourceArtifactIds: [inputArtifacts[5].id] },
  ];
  for (const item of manual.manualEvidence) {
    nodes.push({ id: item.executedCaseId, kind: "test", title: "Real reference staging manual case " + item.executedCaseId, testExecutionMode: "real", evidenceStrength: 1, recentGreenRuns: 1, traceability: trace("mbb:sr-" + item.executedCaseId.slice(4), summaries.manual.path), sourceArtifactIds: [inputArtifacts[3].id] });
  }
  const edge = (id, kind, from, to, sourceId, path) => ({ id, kind, from, to, traceability: trace(sourceId, path) });
  const edges = [
    edge("qeg:edge-evidence-requirement", "satisfies", acEvidenceId, requirementId, "qeg:sr-evidence-edge", "docs/release-gate/feature_spec.json"),
    edge("qeg:edge-gate-requirement", "satisfies", acGateId, requirementId, "qeg:sr-gate-edge", "docs/release-gate/feature_spec.json"),
    edge("rand:edge-audit-gate", "supports", "rand:evidence-requirements-audit", acGateId, "rand:sr-audit-gate", summaries.rand.path),
    edge("lakda:edge-reference-staging-gate", "supports", "lakda:evidence-reference-staging", acGateId, "lakda:sr-reference-staging-gate", summaries.referenceStaging.path),
    edge("hate:edge-full-evidence", "evidenced_by", "hate:test-real-llm-full", "hate:evidence-real-llm-full", "hate:sr-full-edge", summaries.full.path),
    edge("hate:edge-smoke-evidence", "evidenced_by", "hate:test-worker-smoke", "hate:evidence-worker-smoke", "hate:sr-smoke-edge", summaries.smoke.path),
    edge("hate:edge-full-ac", "supports", "hate:evidence-real-llm-full", acEvidenceId, "hate:sr-full-ac", summaries.full.path),
    edge("hate:edge-smoke-ac", "supports", "hate:evidence-worker-smoke", acEvidenceId, "hate:sr-smoke-ac", summaries.smoke.path),
    edge("ctg:edge-strict-ac", "supports", "ctg:evidence-strict", acGateId, "ctg:sr-strict-ac", summaries.ctg.path),
    edge("hate:edge-upstream-ac", "supports", "hate:evidence-upstream", acGateId, "hate:sr-upstream-ac", summaries.hate.path),
  ];
  for (const item of manual.manualEvidence) edges.push(edge("mbb:edge-" + item.executedCaseId.slice(4) + "-gate", "supports", item.executedCaseId, acGateId, "mbb:sr-edge-" + item.executedCaseId.slice(4), summaries.manual.path));

  const policyHash = shaRef(sha256(canonicalJson({ id: "qeg:policy-lakda-rc5", profile: "strict", source: "docs/release-gate/feature_spec.json#AC-RC5-003", releaseVersion })));
  const policy = { policyId: "qeg:policy-lakda-rc5", policyHash, profile: "strict", effectiveDate: createdAt, approver: options.approver, sourceRefs: [{ id: "qeg:sr-release-policy", path: "docs/release-gate/feature_spec.json" }], dqScope: Array.from({ length: 17 }, (_, index) => "DQ-" + String(index + 1).padStart(2, "0")), exitCodePolicy: { go: 0, conditional_go: 2, no_go: 2, disqualified: 2 } };
  const chainEvidenceHash = shaRef(sha256(canonicalJson({ revision, releaseVersion, artifacts: inputArtifacts.map(value => value.contentHash), createdAt })));
  const approvalSource = options.workflowUrl || "github-actions://manual-release-environment";
  const optionalEvidence = {
    schemaVersion: "lakda/release-chain-evidence/v2",
    chainOrder: ["rand", "code-to-gate", "hate", "manual-bb-test-harness", "qeg"],
    chainEvidenceHash,
    inputArtifacts,
    manualEvidence: manual.manualEvidence,
    approval: {
      approver: options.approver,
      roleOrAuthority: "github-environment-release-reviewer",
      approvedAction: "submit-evidence-to-qeg",
      approvedAt: createdAt,
      source: approvalSource,
    },
    retention: { period: "90 days plus release attachment", storage: "github-actions-artifact-and-release", classification: "versioned" },
    lakdaAuthority: "run-outcome-and-evidence-only",
    finalVerdictAuthority: "qeg",
  };
  const gateInput = {
    metadata,
    graph: { metadata, nodes, edges, completeness: { score: 1, partial: false, parserFailures: [], unsupportedClaims: [] } },
    policy,
    waivers: [],
    placementPlan: { metadata, obligations: [], placements: [] },
    optionalEvidence,
  };
  const output = join(outDir, "gate-input.json");
  await writeFile(output, JSON.stringify(gateInput, null, 2) + "\n", "utf8");
  return { output, gateInput, chainEvidenceHash, summaries };
}