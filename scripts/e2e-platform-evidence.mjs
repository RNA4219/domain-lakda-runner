import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { discover } from "./e2e-ci-results.mjs";
import { inspectPlatformRecording } from "./e2e-platform-recording-evidence.mjs";
import { readManifestSnapshot } from "../dist/runs/manifest-snapshot.js";
import { readArtifactSnapshot } from "../dist/runs/artifact-snapshot.js";

const same = isDeepStrictEqual;
function requireValue(condition, code) { if (!condition) throw new Error(code); }
async function json(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("missing_or_invalid_input"); } }

export async function inspectRun(options, { allowMissingRecording = false } = {}) {
  const plan = await discover(options.workspace ?? process.cwd(), options.scenarioDir, options.baseUrl, "platform");
  const planned = plan.cases.find(item => item.id === options.caseId);
  requireValue(planned, "case_mismatch");
  const index = await json(options.index);
  requireValue(index.schemaVersion === "lakda/e2e-case-index/v1" && Array.isArray(index.cases), "invalid_index");
  requireValue(typeof index.callerSha === "string" && /^[a-f0-9]{40}$/.test(index.callerSha) &&
    !/^0+$/.test(index.callerSha), "revision_mismatch");
  const matches = index.cases.filter(item => item.id === options.caseId);
  requireValue(matches.length === 1, "case_mismatch");
  const entry = matches[0];
  for (const key of ["caseRevision", "oracleRevision", "reviewSha256", "actionSha256", "configSha256"]) {
    requireValue(entry[key] === planned[key], "case_mismatch");
  }
  // Older v1 indexes may omit these fields; if present they must match the reviewed export.
  for (const key of ["featureId", "specRevision", "traceTo", "oracleRefs", "reviewedObligationsSha256"]) {
    requireValue(entry[key] === undefined || same(entry[key], planned[key]), "case_mismatch");
  }
  if (entry.outcome === "unreported" || entry.outcome === "not_run") {
    requireValue(!entry.runId && !entry.runRef && !entry.attempt && !entry.manifestSha256, "run_mismatch");
    return { index, entry, unreported: { schemaVersion: "lakda/platform-evidence/v1", caseId: entry.id, status: entry.outcome, media: [] } };
  }
  requireValue(entry.runId && entry.runRef && entry.attempt && entry.manifestSha256, "missing_evidence");
  const snapshot = await readManifestSnapshot(options.runDir, { retain: path => ["run-metadata.json", "platform-recording.json", "action-execution.json"].includes(path) });
  const hash = String(entry.manifestSha256).replace(/^sha256:/, "");
  requireValue(hash === snapshot.manifestSha256.replace(/^sha256:/, ""), "manifest_mismatch");
  const manifest = snapshot.manifest;
  requireValue(manifest.commit_sha === index.callerSha, "revision_mismatch");
  requireValue(manifest.run_id === entry.runId && manifest.run_attempt === entry.attempt &&
    entry.runId.replaceAll(":", "-") === entry.runRef && basename(snapshot.root) === entry.runRef, "run_mismatch");
  const readRetained = key => {
    const value = snapshot.snapshots.get(key);
    requireValue(value?.bytes, "missing_evidence");
    try { return JSON.parse(value.bytes.toString("utf8")); } catch { throw new Error("invalid_evidence"); }
  };
  const meta = readRetained("run-metadata.json");
  requireValue(meta.runId === entry.runId && meta.attempt === entry.attempt && meta.commitSha === manifest.commit_sha &&
    meta.mode === "regression-replay" && meta.outcome === entry.outcome &&
    meta.replayInputSha256 === planned.actionSha256 && meta.reviewedObligationsSha256 === planned.reviewedObligationsSha256, "run_mismatch");
  if (allowMissingRecording && ["error","partial"].includes(meta.outcome) && !snapshot.snapshots.has("platform-recording.json")) {
    return { index, planned, entry, snapshot, manifest, meta };
  }
  const { recording, actions, video } = inspectPlatformRecording(snapshot, planned, entry.runId, entry.attempt);
  return { index, planned, entry, snapshot, manifest, meta, recording, actions, video };
}

// Produce a separate, provenance-recorded P0a derivative for HATE's existing P0b CLI.
// Only pre-existing safe text artifacts are linked; the private video is never reclassified.
export async function prepareHateInput(options) {
  const checked = await inspectRun(options);
  requireValue(!checked.unreported, "missing_evidence");
  const { entry, snapshot, manifest } = checked;
  const source = resolve(options.hateInput);
  const target = resolve(options.out);
  const files = ["HATE-run.json", "HATE-test-results.ndjson", "HATE-coverage.ndjson", "artifact-manifest.json", "precheck-decision.json", "record.json"];
  const loaded = new Map();
  for (const name of files) loaded.set(name, await readArtifactSnapshot(source, "p0a/" + name, { retain: true }));
  const parse = name => JSON.parse(loaded.get(name).bytes.toString("utf8"));
  const identity = value => value.run_id === entry.runId && value.run_attempt === entry.attempt && value.commit_sha === manifest.commit_sha;
  for (const name of ["HATE-run.json", "artifact-manifest.json", "precheck-decision.json", "record.json"]) {
    requireValue(identity(parse(name)), "run_mismatch");
  }
  const artifactManifest = parse("artifact-manifest.json");
  requireValue(Array.isArray(artifactManifest.artifacts), "invalid_hate_input");
  const safe = ["platform-recording.json", "action-execution.json"].map(path => {
    const item = snapshot.artifacts.find(value => value.path === path);
    requireValue(item && item.safe_for_summary === true && ["redacted", "not_required"].includes(item.redaction_status) &&
      item.public_exposure === "none" && item.security_checks?.secrets_scan === "pass" && item.security_checks?.pii_scan === "pass", "unsafe_evidence");
    requireValue(!artifactManifest.artifacts.some(value => value.artifact_id === item.artifact_id), "duplicate_evidence");
    return item;
  });
  const rawLines = loaded.get("HATE-test-results.ndjson").bytes.toString("utf8").split(/\r?\n/).filter(Boolean);
  const records = rawLines.map(line => JSON.parse(line));
  const selected = records.filter(value => value.record_id === options.testRecordId);
  const canonical = selected[0]?.payload?.canonical_test_id;
  requireValue(selected.length === 1 && identity(selected[0]) &&
    typeof canonical === "string" && canonical.startsWith("junit:") &&
    canonical.split("::").at(-1) === entry.id &&
    selected[0].payload?.status === entry.outcome && Array.isArray(selected[0].payload.artifacts), "test_mismatch");
  requireValue(safe.every(item => !selected[0].payload.artifacts.includes(item.artifact_id)), "duplicate_evidence");
  selected[0].payload.artifacts.push(...safe.map(item => item.artifact_id));
  artifactManifest.artifacts.push(...safe);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, ".platform-hate-"));
  try {
    await mkdir(join(stage, "p0a"));
    for (const name of files) await writeFile(join(stage, "p0a", name), loaded.get(name).bytes, { flag: "wx" });
    await writeFile(join(stage, "p0a", "artifact-manifest.json"), JSON.stringify(artifactManifest, null, 2) + "\n");
    await writeFile(join(stage, "p0a", "HATE-test-results.ndjson"), records.map(value => JSON.stringify(value)).join("\n") + "\n");
    for (const optional of ["diff-risk-test.json", "risk-debt-lifecycle.json"]) {
      try { const item = await readArtifactSnapshot(source, optional, { retain: true }); await writeFile(join(stage, optional), item.bytes, { flag: "wx" }); }
      catch (error) { if (!String(error.message).includes("is missing")) throw error; }
    }
    const audit = { schemaVersion: "lakda/platform-hate-adapter/v1", caseId: entry.id, runId: entry.runId,
      attempt: entry.attempt, manifestSha256: snapshot.manifestSha256, testRecordId: options.testRecordId,
      sourceSha256: Object.fromEntries([...loaded].map(([name, value]) => [name, value.sha256])),
      artifactIds: safe.map(item => item.artifact_id), videoIncluded: false };
    await writeFile(join(stage, "platform-adapter.json"), JSON.stringify(audit, null, 2) + "\n", { flag: "wx" });
    await rename(stage, target);
    return audit;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

async function inspectHateLink(checked, qegRoot, ref) {
  const { entry, snapshot, manifest } = checked;
  const bundleBytes = await readArtifactSnapshot(qegRoot, ref.path, { retain: true });
  requireValue(bundleBytes.sha256 === ref.contentHash, "integrity_mismatch");
  let bundle;
  try { bundle = JSON.parse(bundleBytes.bytes.toString("utf8")); } catch { throw new Error("invalid_hate_bundle"); }
  requireValue(bundle.metadata?.runId === entry.runId && bundle.metadata?.runAttempt === entry.attempt &&
    bundle.metadata?.commitSha === manifest.commit_sha && Array.isArray(bundle.nodes) && Array.isArray(bundle.edges), "run_mismatch");
  const artifactNode = path => {
    const artifact = snapshot.artifacts.find(item => item.path === path);
    requireValue(artifact, "missing_evidence");
    const nodes = bundle.nodes.filter(node => node.kind === "evidence_artifact" &&
      String(node.data?.sha256).replace(/^sha256:/, "") === String(artifact.sha256).replace(/^sha256:/, ""));
    requireValue(nodes.length === 1, "hate_link_missing");
    return nodes[0];
  };
  const recordingNode = artifactNode("platform-recording.json");
  const actionNode = artifactNode("action-execution.json");
  const executions = bundle.nodes.filter(node => node.kind === "execution_evidence" &&
    node.data?.run_id === entry.runId && node.data?.run_attempt === entry.attempt && node.data?.commit_sha === manifest.commit_sha &&
    node.data?.status === entry.outcome);
  const connected = executions.filter(node => [recordingNode.id, actionNode.id].every(id =>
    bundle.edges.some(edge => edge.kind === "evidenced_by" && edge.from === node.id && edge.to === id)));
  requireValue(connected.length === 1, "hate_link_missing");
  const sourceTests = bundle.nodes.filter(node => node.kind === "test" &&
    typeof node.data?.canonical_test_id === "string" && node.data.canonical_test_id.startsWith("junit:") &&
    node.data.canonical_test_id.split("::").at(-1) === entry.id &&
    bundle.edges.some(edge => edge.kind === "evidenced_by" && edge.from === node.id && edge.to === connected[0].id));
  requireValue(sourceTests.length === 1, "hate_link_missing");
  return { bundleBytes, bundle, connected, sourceTests };
}

async function verifiedJson(root, ref) {
  const artifact = await readArtifactSnapshot(root, ref.path, { retain: true });
  requireValue(artifact.sha256 === ref.contentHash, "integrity_mismatch");
  try { return JSON.parse(artifact.bytes.toString("utf8")); }
  catch { throw new Error("invalid_execution_artifact"); }
}

// A release policy describes the intended target. The producer record describes what ran.
async function executionFromRun(root, template, checked, bundle, testId, mode) {
  const { entry, meta, manifest, planned } = checked;
  requireValue(template.policy.executionPolicy?.target && template.policy.executionPolicy.buildBindingRef,
    "missing_execution_policy");
  const { target, buildBindingRef } = template.policy.executionPolicy;
  const runs = bundle.nodes.filter(node => node.kind === "run" && node.id === `run:${entry.runId}:${entry.attempt}`);
  requireValue(runs.length === 1 && typeof runs[0].data?.repository === "string" && runs[0].data.repository.trim() &&
    runs[0].data.ci?.run_id === entry.runId && runs[0].data.ci.run_attempt === entry.attempt,
    "missing_hate_run");
  requireValue(target?.projectId === runs[0].data.repository && target.revision === manifest.commit_sha &&
    typeof entry.environment === "string" && entry.environment.length > 0 && target.environmentId === entry.environment &&
    typeof target.buildId === "string" && target.buildId.trim() && buildBindingRef?.revision === target.revision,
    "execution_target_mismatch");
  const binding = await verifiedJson(root, buildBindingRef);
  requireValue(same(binding, { bindingVersion: "qeg-build/v1", target }), "execution_target_mismatch");

  const identity = { producer: "domain-lakda-runner", projectId: target.projectId, featureId: planned.featureId, caseId: entry.id };
  requireValue(typeof planned.featureId === "string" && planned.featureId.trim() &&
    typeof meta.producerVersion === "string" && meta.producerVersion.trim() && typeof meta.endedAt === "string" &&
    Number.isFinite(Date.parse(meta.endedAt)) && ["passed", "failed"].includes(entry.outcome), "incomplete_execution");
  return { executionVersion: "qeg-execution/v1", testId, identity, producerVersion: meta.producerVersion,
    runId: "hate:" + runs[0].id, target, completedAt: meta.endedAt, status: entry.outcome === "passed" ? "pass" : "fail", executionMode: mode };
}

async function checkedExecution(root, descriptors, expected) {
  let matched;
  for (const ref of descriptors.filter(item => item.adapter === expected.identity.producer && item.kind === "execution_evidence")) {
    const raw = await verifiedJson(root, ref);
    if (raw?.runId !== expected.runId) continue;
    requireValue(!matched && typeof ref.id === "string" && ref.id.trim() && ref.revision === expected.target.revision &&
      same(raw, expected), "execution_record_mismatch");
    matched = { ...raw, rawArtifactRef: { id: ref.id, path: ref.path, contentHash: ref.contentHash, revision: ref.revision } };
  }
  requireValue(matched, "missing_execution_evidence");
  return matched;
}

// The caller supplies policy, revision and input artifacts; this only projects verified HATE links.
export async function prepareQegInput(options) {
  const checked = await inspectRun(options);
  requireValue(!checked.unreported, "missing_evidence");
  const root = resolve(options.qegDir);
  const template = await json(options.qegTemplate);
  const metadata = template.metadata;
  requireValue(metadata && template.policy && Array.isArray(metadata.inputArtifacts) &&
    metadata.headRef === checked.manifest.commit_sha && same(template.graph?.metadata, metadata) &&
    Array.isArray(template.graph?.nodes) && Array.isArray(template.graph?.edges), "invalid_qeg_template");
  const refs = metadata.inputArtifacts.filter(ref => ref.id === options.hateArtifactId &&
    ref.adapter === "hate" && ref.kind === "qeg-bundle");
  requireValue(refs.length === 1 && refs[0].revision === metadata.headRef, "missing_qeg_input");
  const ref = refs[0];
  const { bundle, connected, sourceTests } = await inspectHateLink(checked, root, ref);
  const source = { id: ref.id, path: ref.path, revision: ref.revision };
  const indexedReal = checked.entry.evidenceKind === "real";
  const recordedReal = checked.meta.executionMode === "real";
  requireValue(indexedReal === recordedReal, "execution_mode_mismatch");
  const qualified = indexedReal && recordedReal;
  const traceability = { sourceRefs: [source], confidence: "high", assumptions: qualified ? [] :
    ["Source evidenceKind is unknown; represented as non-qualifying mock because QEG has no unknown mode."] };
  const testId = "hate:" + sourceTests[0].id, executionId = "hate:" + connected[0].id;
  const mode = qualified ? "real" : "mock";
  const observed = (options.observedBuild || template.policy.executionPolicy !== undefined)
    ? await executionFromRun(root, template, checked, bundle, testId, mode) : undefined;
  if (options.observedBuild) {
    const deployed = await json(options.observedBuild);
    requireValue(same(deployed, { bindingVersion: "qeg-build/v1", target: observed.target }), "observed_build_mismatch");
    return observed;
  }
  const test = { id: testId, kind: "test", title: sourceTests[0].label, layer: "e2e",
    testExecutionMode: mode, existing: true, sourceArtifactIds: [ref.id], traceability };
  const execution = { id: executionId, kind: "execution_evidence", title: connected[0].label,
    passed: connected[0].data.status === "passed", sourceArtifactIds: [ref.id], traceability,
    evidenceRefs: [{ id: "hate:platform-run-evidence", path: ref.path, revision: ref.revision,
      contentHash: ref.contentHash, evidenceKind: "test_result", capturedAt: checked.meta.endedAt }] };
  if (observed) {
    const detail = await checkedExecution(root, metadata.inputArtifacts, observed);
    test.executionIdentity = detail.identity;
    execution.execution = detail;
    execution.sourceArtifactIds.push(detail.rawArtifactRef.id);
  }
  const edgeId = createHash("sha256").update(JSON.stringify([testId, executionId])).digest("hex").slice(0, 24);
  const edge = { id: "hate:platform-edge-" + edgeId, kind: "evidenced_by", from: testId, to: executionId, traceability };
  const lock = join(root, ".platform-qeg-projection.lock");
  try { await mkdir(lock); } catch (error) { if (error.code === "EEXIST") throw new Error("qeg_input_locked", { cause: error }); throw error; }
  try {
  let target = template, existed = false;
  try {
    const existing = await readArtifactSnapshot(root, "gate-input.json", { retain: true });
    target = JSON.parse(existing.bytes.toString("utf8"));
    requireValue(Array.isArray(target.graph?.nodes) && Array.isArray(target.graph.edges) &&
      same({ ...target, graph: { ...target.graph, nodes: [], edges: [] } },
        { ...template, graph: { ...template.graph, nodes: [], edges: [] } }), "qeg_input_conflict");
    for (const [kind, list] of [["nodes", template.graph.nodes], ["edges", template.graph.edges]]) {
      for (const item of list) requireValue(target.graph[kind].some(value => same(value, item)), "qeg_input_conflict");
    }
    existed = true;
  } catch (error) {
    if (!String(error.message).includes("is missing")) throw error;
  }
  let changed = false;
  for (const [kind, raw] of [["nodes", test], ["nodes", execution], ["edges", edge]]) {
    const item = JSON.parse(JSON.stringify(raw));
    const matches = target.graph[kind].filter(value => value.id === item.id);
    requireValue(matches.length <= 1 && (!matches.length || same(matches[0], item)), "qeg_input_conflict");
    if (!matches.length) { target.graph[kind].push(item); changed = true; }
  }
  if (changed && existed) {
    try { await readArtifactSnapshot(root, "output-manifest.json"); throw new Error("qeg_outputs_exist"); }
    catch (error) { if (!String(error.message).includes("is missing")) throw error; }
  }
  if (changed || !existed) {
    const temporary = await mkdtemp(join(root, ".platform-qeg-write-"));
    try {
      const staged = join(temporary, "gate-input.json");
      await writeFile(staged, JSON.stringify(target, null, 2) + "\n", { flag: "wx" });
      await rename(staged, join(root, "gate-input.json"));
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return { schemaVersion: "lakda/platform-qeg-projection/v1", caseId: checked.entry.id,
    runId: checked.entry.runId, attempt: checked.entry.attempt, hateBundleSha256: ref.contentHash,
    qegInput: "gate-input.json", testId, executionId, executionMode: test.testExecutionMode, changed };
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function readPinnedGate(options) {
  const qegRoot = resolve(options.qegDir);
  const outputManifest = await readArtifactSnapshot(qegRoot, "output-manifest.json", { retain: true });
  requireValue(typeof options.qegManifestSha256 === "string" &&
    outputManifest.sha256 === "sha256:" + options.qegManifestSha256.replace(/^sha256:/, ""), "qeg_manifest_mismatch");
  const recordSnapshot = await readArtifactSnapshot(qegRoot, "quality-evidence-record.json", { retain: true });
  const verdictSnapshot = await readArtifactSnapshot(qegRoot, "gate-verdict.json", { retain: true });
  let record, verdict, qegManifest;
  try {
    record = JSON.parse(recordSnapshot.bytes.toString("utf8"));
    verdict = JSON.parse(verdictSnapshot.bytes.toString("utf8"));
    qegManifest = JSON.parse(outputManifest.bytes.toString("utf8"));
  } catch { throw new Error("invalid_qeg_record"); }
  requireValue(qegManifest.manifestVersion === "qeg-output/v1" && qegManifest.runId === record.metadata?.runId &&
    Array.isArray(qegManifest.files), "qeg_manifest_mismatch");
  for (const [path, item] of [["quality-evidence-record.json", recordSnapshot], ["gate-verdict.json", verdictSnapshot]]) {
    const matches = qegManifest.files.filter(value => value.path === path);
    requireValue(matches.length === 1 && matches[0].contentHash === item.sha256, "qeg_manifest_mismatch");
  }
  requireValue(same(record.gate, verdict) && same(record.metadata, verdict.metadata), "qeg_record_mismatch");
  return { record, verdict, recordSnapshot, outputManifest, qegRoot };
}

// Read-only private evidence resolution. This does not determine or alter a Gate verdict.
export async function resolvePlatformEvidence(options) {
  const checked = await inspectRun(options);
  if (checked.unreported) {
    requireValue(!options.decisionRequest, "missing_evidence");
    return checked.unreported;
  }
  return linkEvidence(options, checked, await readPinnedGate(options));
}

async function linkEvidence(options, checked, gate, withSelection = false) {
  const { entry, snapshot, manifest, recording, video } = checked;
  const { record, verdict, recordSnapshot, outputManifest, qegRoot } = gate;
  const refs = record.metadata?.inputArtifacts;
  requireValue(Array.isArray(refs), "missing_qeg_input");
  const found = refs.filter(ref => ref.id === options.hateArtifactId && ref.adapter === "hate" && ref.kind === "qeg-bundle");
  requireValue(found.length === 1, "missing_qeg_input");
  const ref = found[0];
  requireValue(ref.revision === manifest.commit_sha && record.metadata.headRef === manifest.commit_sha, "revision_mismatch");
  const { bundleBytes, bundle, connected, sourceTests } = await inspectHateLink(checked, qegRoot, ref);
  const graph = record.graph;
  requireValue(Array.isArray(graph?.nodes) && Array.isArray(graph.edges), "qeg_graph_mismatch");
  const testId = "hate:" + sourceTests[0].id, executionId = "hate:" + connected[0].id;
  const qegTests = graph.nodes.filter(node => node.kind === "test" && node.id === testId && node.sourceArtifactIds?.includes(ref.id));
  const qegExecutions = graph.nodes.filter(node => node.kind === "execution_evidence" && node.id === executionId &&
    node.sourceArtifactIds?.includes(ref.id) && node.passed === (connected[0].data.status === "passed") &&
    node.evidenceRefs?.some(item => item.path === ref.path && item.contentHash === ref.contentHash && item.revision === ref.revision));
  requireValue(qegTests.length === 1 && qegExecutions.length === 1 &&
    graph.edges.some(edge => edge.kind === "evidenced_by" && edge.from === testId && edge.to === executionId), "qeg_graph_mismatch");
  const test = qegTests[0], execution = qegExecutions[0];
  const real = entry.evidenceKind === "real";
  requireValue(real === (checked.meta.executionMode === "real"), "execution_mode_mismatch");
  const mode = real ? "real" : "mock";
  requireValue(test.testExecutionMode === undefined || test.testExecutionMode === mode, "qeg_graph_mismatch");
  if (test.executionIdentity !== undefined || execution.execution !== undefined) {
    const detail = execution.execution;
    const rawRef = detail?.rawArtifactRef;
    const descriptors = refs.filter(item => item.id === rawRef?.id && item.adapter === "domain-lakda-runner" &&
      item.kind === "execution_evidence");
    requireValue(descriptors.length === 1 && rawRef &&
      same(rawRef, { id: descriptors[0].id, path: descriptors[0].path, contentHash: descriptors[0].contentHash, revision: descriptors[0].revision }) &&
      descriptors[0].revision === manifest.commit_sha && execution.sourceArtifactIds?.includes(rawRef.id), "qeg_graph_mismatch");
    const raw = await verifiedJson(qegRoot, descriptors[0]);
    const runs = bundle.nodes.filter(node => node.kind === "run" && node.id === `run:${entry.runId}:${entry.attempt}`);
    requireValue(runs.length === 1 && runs[0].data?.ci?.run_id === entry.runId && runs[0].data?.ci?.run_attempt === entry.attempt &&
      same(detail, { ...raw, rawArtifactRef: rawRef }) && same(test.executionIdentity, raw.identity) &&
      raw.executionVersion === "qeg-execution/v1" && raw.testId === testId && raw.runId === "hate:" + runs[0].id &&
      raw.identity?.producer === "domain-lakda-runner" && raw.identity?.projectId === runs[0].data.repository &&
      raw.identity?.featureId === checked.planned.featureId && raw.identity?.caseId === entry.id &&
      raw.target?.projectId === runs[0].data.repository && raw.target?.revision === manifest.commit_sha &&
      raw.target?.environmentId === entry.environment && raw.producerVersion === checked.meta.producerVersion &&
      raw.completedAt === checked.meta.endedAt && raw.status === (entry.outcome === "passed" ? "pass" : "fail") &&
      raw.executionMode === mode && test.testExecutionMode === mode, "qeg_graph_mismatch");
  }
  let selection;
  if (withSelection) {
    const detail = execution.execution;
    const choices = verdict.executionAccounting?.selections?.filter(item => item.testId === testId);
    requireValue(detail && choices?.length === 1 && choices[0].selectedEvidenceId === executionId &&
      choices[0].selectedRunId === detail.runId && choices[0].selectedStatus === detail.status &&
      same(verdict.executionAccounting.target, detail.target), "qeg_selected_execution_mismatch");
    const run = bundle.nodes.find(node => detail.runId === "hate:" + node.id && node.kind === "run");
    selection = { testId, executionId, hateRunId: detail.runId, status: detail.status, reason: choices[0].reason,
      mode, event: run.data.event_name, provider: run.data.ci?.provider,
      blockers: (verdict.blockers ?? []).filter(b => b.testId === testId && b.evidenceId === executionId).map(b => b.message) };
  }
  let decisionRequest;
  if (options.decisionRequest) {
    const request = await json(options.decisionRequest);
    requireValue(request && typeof request === "object" && !Array.isArray(request) &&
      same(Object.keys(request).sort(), ["acceptanceRef", "caseId", "question", "reviewSha256", "sequence"]) &&
      request.caseId === entry.id && request.reviewSha256 === checked.planned.reviewSha256 &&
      typeof request.acceptanceRef === "string" &&
      [...checked.planned.traceTo, ...checked.planned.oracleRefs].includes(request.acceptanceRef) &&
      typeof request.question === "string" && request.question.trim().length > 0 && request.question.length <= 4000 &&
      Number.isSafeInteger(request.sequence), "invalid_decision_request");
    const action = recording.actions.find(item => item.sequence === request.sequence);
    requireValue(action, "invalid_decision_request");
    decisionRequest = { acceptanceRef: request.acceptanceRef, question: request.question,
      caseRevision: checked.planned.caseRevision, oracleRevision: checked.planned.oracleRevision,
      reviewSha256: checked.planned.reviewSha256,
      action: { sequence: action.sequence, actionId: action.actionId, offsetMs: action.offsetMs } };
  }
  return { schemaVersion: "lakda/platform-evidence/v1", status: "verified_private", caseId: entry.id,
    runId: entry.runId, attempt: entry.attempt, manifestSha256: snapshot.manifestSha256,
    qegVerdict: verdict.verdict, qegRecordSha256: recordSnapshot.sha256, qegOutputManifestSha256: outputManifest.sha256,
    hateBundleSha256: bundleBytes.sha256, hateExecutionId: connected[0].id,
    ...(selection ? { selection } : {}),
    recording: { plan: recording.plan, firstFrameAt: recording.firstFrameAt,
      stoppedAt: recording.stoppedAt, viewport: recording.viewport, measured: recording.measured },
    actions: recording.actions.map(({ sequence, actionId, offsetMs }) => ({ sequence, actionId, offsetMs })),
    ...(decisionRequest ? { decisionRequest } : {}),
    media: [{ artifactId: video.artifact_id, path: video.path, sha256: video.sha256,
      classification: video.classification, redactionStatus: video.redaction_status, safeForSummary: video.safe_for_summary,
      publicExposure: video.public_exposure }, { artifactId: snapshot.artifacts.find(item => item.path === "action-execution.json").artifact_id,
      path: "action-execution.json", sha256: snapshot.artifacts.find(item => item.path === "action-execution.json").sha256 }] };
}

// 「判定なし」は呼び出し側が対象ディレクトリに出力がないことを確認した場合だけ扱う。
export async function inspectReleaseReview(options, issued) {
  const gate = issued ? await readPinnedGate(options) : null;
  // 失格は QEG 自身の記録から読む。個別の動画の有無で未発行に変換しない。
  const checked = gate?.verdict.verdict === "disqualified" ? undefined : await inspectRun(options, { allowMissingRecording: !issued });
  const index = checked?.index ?? await json(options.index);
  const entry = checked?.entry;
  const context = { caseId: entry?.id, revision: index.callerSha, environment: entry?.environment,
    origin: index.executionOrigin === "local" ? "ローカル" : index.workflowRunId ? "CI" : "実行場所の記録なし",
    batchRun: index.localRunId ?? index.workflowRunId, batchAttempt: index.localRunAttempt ?? index.workflowRunAttempt };
  if (!gate) return { ...context, state: "unissued", canOpenLocalCase: Boolean(checked.recording) };
  const v = gate.verdict;
  requireValue(v.metadata.headRef === context.revision && ["go", "conditional_go", "no_go", "disqualified"].includes(v.verdict) &&
    Array.isArray(v.reasons) && v.reasons.every(reason => typeof reason === "string") &&
    ["fixture", "isolated_consumer", "real_environment"].includes(v.evaluationScope?.kind) &&
    typeof v.evaluationScope.target === "string" && Array.isArray(v.evaluationScope.notEvaluated) &&
    v.evaluationScope.notEvaluated.every(item => typeof item === "string"), "qeg_scope_mismatch");
  const target = v.executionAccounting?.target;
  if (target) requireValue(target.revision === context.revision && (!entry || target.environmentId === entry.environment), "execution_target_mismatch");
  const review = { state: v.verdict, reasons: v.reasons, scope: v.evaluationScope, profile: v.metadata.profile,
    qegRun: v.metadata.runId, qegManifest: gate.outputManifest.sha256, target };
  if (v.verdict === "disqualified") {
    requireValue(v.disqualifications?.length > 0, "missing_disqualification");
    // 失格理由は Gate 全体に属する。選ばれた個別ケースの判定としては扱わない。
    return { ...review, revision: v.metadata.headRef, environment: target?.environmentId,
      disqualifications: v.disqualifications.map(({ code, message }) => ({ code, message })) };
  }
  requireValue(!checked.unreported, "missing_selected_evidence");
  const evidence = await linkEvidence(options, checked, gate, true);
  if (evidence.selection.event === "local") context.origin = "ローカル";
  return { ...context, ...review, hateArtifactId: options.hateArtifactId, evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const keys = ["scenario-dir", "base-url", "index", "case-id", "run-dir", "qeg-dir", "qeg-manifest-sha256", "hate-artifact-id",
      "prepare-hate", "prepare-qeg", "emit-qeg-execution", "observed-build", "out", "test-record-id", "decision-request"];
    const { values } = parseArgs({ options: Object.fromEntries(keys.map(key => [key, { type: "string" }])), strict: true });
    for (const key of ["scenario-dir", "base-url", "index", "case-id"]) requireValue(values[key], "invalid_arguments");
    const options = { scenarioDir: values["scenario-dir"], baseUrl: values["base-url"], index: values.index, caseId: values["case-id"], runDir: values["run-dir"], qegDir: values["qeg-dir"], qegManifestSha256: values["qeg-manifest-sha256"], hateArtifactId: values["hate-artifact-id"], decisionRequest: values["decision-request"] };
    requireValue(["prepare-hate", "prepare-qeg", "emit-qeg-execution"].filter(key => key in values).length <= 1 &&
      Boolean(values["emit-qeg-execution"]) === Boolean(values["observed-build"]) &&
      !(values["decision-request"] && (values["prepare-hate"] || values["prepare-qeg"] || values["emit-qeg-execution"])), "invalid_arguments");
    const result = values["prepare-hate"]
      ? await prepareHateInput({ ...options, hateInput: values["prepare-hate"], out: values.out, testRecordId: values["test-record-id"] })
      : values["prepare-qeg"] || values["emit-qeg-execution"]
        ? await prepareQegInput({ ...options, qegTemplate: values["prepare-qeg"] ?? values["emit-qeg-execution"], observedBuild: values["observed-build"] })
        : await resolvePlatformEvidence(options);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write(`platform_evidence: ${error.message}\n`);
    process.exitCode = 2;
  }
}
