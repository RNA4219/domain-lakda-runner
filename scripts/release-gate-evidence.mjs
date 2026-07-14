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

export async function assembleReleaseQegInput(options) {
  const revision = options.revision;
  assert(/^[0-9a-f]{40}$/i.test(revision), "revisionは40桁Git SHAが必要です");
  const full = await verifyAcceptanceReport({ reportPath: options.fullReport, bundlePath: options.fullBundle });
  const smoke = await verifyAcceptanceReport({ reportPath: options.workerReport, bundlePath: options.workerBundle });
  assert(full.profile === "full" && full.overall && full.subjectRevision === revision, "full 90-runが対象revisionで完了していません");
  assert(smoke.profile === "worker-smoke" && smoke.overall && smoke.subjectRevision === revision, "worker-smoke 20-runが対象revisionで完了していません");
  const manual = await verifyManualReleaseEvidence({ recordPath: options.manualRecord, expectedRevision: revision });
  if (options.stagingOrigin) assert(manual.record.environment.baseUrlOrigin === options.stagingOrigin, "workflow staging URLとmanual evidenceが不一致です");
  const ctg = await readJson(options.ctgReadiness);
  const ctgTriage = await readJson(options.ctgTriage);
  const ctgQeg = await readJson(options.ctgQeg);
  const hate = await readJson(options.hateBundle);
  const upstream = await readJson(options.hateUpstream);
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
    full: await writeSummary(outDir, "real-llm-full-summary.json", full),
    smoke: await writeSummary(outDir, "real-llm-worker-smoke-summary.json", smoke),
    manual: await writeSummary(outDir, "manual-summary.json", {
      schemaVersion: "lakda/manual-bb-summary/v1",
      subjectRevision: revision,
      testExecutionMode: "real",
      operator: manual.record.operator,
      environment: { name: "staging", baseUrlOrigin: manual.record.environment.baseUrlOrigin, allowHosts: manual.record.environment.allowHosts },
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

  const createdAt = options.createdAt ?? new Date().toISOString();
  const inputArtifacts = [
    artifact("hate:artifact-real-llm-full", "lakda-v2-verifier", "real-llm-acceptance", summaries.full.path, summaries.full.sha256, revision),
    artifact("hate:artifact-worker-smoke", "lakda-v2-verifier", "worker-smoke", summaries.smoke.path, summaries.smoke.sha256, revision),
    artifact("mbb:artifact-staging", "manual-bb-test-harness", "execution_evidence", summaries.manual.path, summaries.manual.sha256, revision),
    artifact("ctg:artifact-readiness", "code-to-gate", "release-readiness", summaries.ctg.path, summaries.ctg.sha256, revision),
    artifact("hate:artifact-qeg-bundle", "hate", "qeg-bundle", summaries.hate.path, summaries.hate.sha256, revision),
  ];
  const metadata = {
    qegVersion: "0.2",
    runId: "qeg:lakda-rc-" + revision.slice(0, 12),
    createdAt,
    profile: "strict",
    headRef: revision,
    inputArtifacts,
    requiredConnectorStatus: { "manual-bb-test-harness": "success", "code-to-gate": "success" },
    producerChecks: [
      { id: "ctg:check-strict", producer: "code-to-gate", name: "strict-readiness", conclusion: "success", readinessStatus: "passed", headSha: revision, sourceRefs: [{ id: "ctg:sr-readiness", path: summaries.ctg.path, revision }] },
      { id: "hate:check-upstream", producer: "hate", name: "upstream-and-bundle-validation", conclusion: "success", headSha: revision, sourceRefs: [{ id: "hate:sr-summary", path: summaries.hate.path, revision }] },
      { id: "mbb:check-staging", producer: "manual-bb-test-harness", name: "real-staging-manual-bb", conclusion: "success", headSha: revision, sourceRefs: [{ id: "mbb:sr-summary", path: summaries.manual.path, revision }] },
    ],
  };
  const nodes = [
    { id: "qeg:req-lakda-v021-release", kind: "requirement", title: "v0.2.1 release evidence is independently verifiable", priority: "P0", acceptanceCriteriaIds: ["qeg:ac-017", "qeg:ac-018"], traceability: trace("qeg:sr-requirements", "REQUIREMENTS.md"), sourceArtifactIds: inputArtifacts.map(value => value.id) },
    { id: "qeg:ac-017", kind: "acceptance_criteria", title: "AC-017 independent evidence reverification", requirementIds: ["qeg:req-lakda-v021-release"], traceability: trace("qeg:sr-ac017", "EVALUATION.md"), sourceArtifactIds: [inputArtifacts[0].id, inputArtifacts[1].id, inputArtifacts[4].id] },
    { id: "qeg:ac-018", kind: "acceptance_criteria", title: "AC-018 five-tool gate and real staging", requirementIds: ["qeg:req-lakda-v021-release"], traceability: trace("qeg:sr-ac018", "EVALUATION.md"), sourceArtifactIds: inputArtifacts.map(value => value.id) },
    { id: "hate:test-real-llm-full", kind: "test", title: "Real Qwen full 90 child runs", testExecutionMode: "real", evidenceStrength: 1, recentGreenRuns: 90, traceability: trace("hate:sr-full", summaries.full.path), sourceArtifactIds: [inputArtifacts[0].id] },
    { id: "hate:evidence-real-llm-full", kind: "execution_evidence", title: "Verified full acceptance bundle", passed: true, traceability: trace("hate:sr-full-evidence", summaries.full.path), sourceArtifactIds: [inputArtifacts[0].id] },
    { id: "hate:test-worker-smoke", kind: "test", title: "Real Qwen worker smoke 20 child runs", testExecutionMode: "real", evidenceStrength: 1, recentGreenRuns: 20, traceability: trace("hate:sr-smoke", summaries.smoke.path), sourceArtifactIds: [inputArtifacts[1].id] },
    { id: "hate:evidence-worker-smoke", kind: "execution_evidence", title: "Verified worker-smoke bundle", passed: true, traceability: trace("hate:sr-smoke-evidence", summaries.smoke.path), sourceArtifactIds: [inputArtifacts[1].id] },
    { id: "ctg:evidence-strict", kind: "execution_evidence", title: "Code-to-gate strict readiness passed", passed: true, traceability: trace("ctg:sr-strict", summaries.ctg.path), sourceArtifactIds: [inputArtifacts[3].id] },
    { id: "hate:evidence-upstream", kind: "execution_evidence", title: "HATE upstream and QEG export validated", passed: true, traceability: trace("hate:sr-upstream", summaries.hate.path), sourceArtifactIds: [inputArtifacts[4].id] },
  ];
  for (const item of manual.manualEvidence) {
    nodes.push({ id: item.executedCaseId, kind: "test", title: "Real staging manual case " + item.executedCaseId, testExecutionMode: "real", evidenceStrength: 1, recentGreenRuns: 1, traceability: trace("mbb:sr-" + item.executedCaseId.slice(4), summaries.manual.path), sourceArtifactIds: [inputArtifacts[2].id] });
  }
  const edge = (id, kind, from, to, sourceId, path) => ({ id, kind, from, to, traceability: trace(sourceId, path) });
  const edges = [
    edge("qeg:edge-ac017-requirement", "satisfies", "qeg:ac-017", "qeg:req-lakda-v021-release", "qeg:sr-ac017-edge", "EVALUATION.md"),
    edge("qeg:edge-ac018-requirement", "satisfies", "qeg:ac-018", "qeg:req-lakda-v021-release", "qeg:sr-ac018-edge", "EVALUATION.md"),
    edge("hate:edge-full-evidence", "evidenced_by", "hate:test-real-llm-full", "hate:evidence-real-llm-full", "hate:sr-full-edge", summaries.full.path),
    edge("hate:edge-smoke-evidence", "evidenced_by", "hate:test-worker-smoke", "hate:evidence-worker-smoke", "hate:sr-smoke-edge", summaries.smoke.path),
    edge("hate:edge-full-ac017", "supports", "hate:evidence-real-llm-full", "qeg:ac-017", "hate:sr-full-ac017", summaries.full.path),
    edge("hate:edge-smoke-ac017", "supports", "hate:evidence-worker-smoke", "qeg:ac-017", "hate:sr-smoke-ac017", summaries.smoke.path),
    edge("ctg:edge-strict-ac018", "supports", "ctg:evidence-strict", "qeg:ac-018", "ctg:sr-strict-ac018", summaries.ctg.path),
    edge("hate:edge-upstream-ac018", "supports", "hate:evidence-upstream", "qeg:ac-018", "hate:sr-upstream-ac018", summaries.hate.path),
  ];
  for (const item of manual.manualEvidence) edges.push(edge("mbb:edge-" + item.executedCaseId.slice(4) + "-ac018", "supports", item.executedCaseId, "qeg:ac-018", "mbb:sr-edge-" + item.executedCaseId.slice(4), summaries.manual.path));

  const policyHash = shaRef(sha256(canonicalJson({ id: "qeg:policy-lakda-v021-rc", profile: "strict", source: "EVALUATION.md#AC-018" })));
  const policy = { policyId: "qeg:policy-lakda-v021-rc", policyHash, profile: "strict", effectiveDate: "2026-07-14T00:00:00.000Z", approver: options.approver, sourceRefs: [{ id: "qeg:sr-release-policy", path: "EVALUATION.md" }], dqScope: Array.from({ length: 17 }, (_, index) => "DQ-" + String(index + 1).padStart(2, "0")), exitCodePolicy: { go: 0, conditional_go: 2, no_go: 2, disqualified: 2 } };
  const chainEvidenceHash = shaRef(sha256(canonicalJson({ revision, artifacts: inputArtifacts.map(value => value.contentHash), createdAt })));
  const approvalSource = options.workflowUrl || "github-actions://manual-release-environment";
  const optionalEvidence = {
    schemaVersion: "lakda/release-chain-evidence/v1",
    chainOrder: ["code-to-gate", "hate", "manual-bb-test-harness", "qeg"],
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
    retention: {
      period: "90 days plus release attachment",
      storage: "github-actions-artifact-and-release",
      classification: "versioned",
    },
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