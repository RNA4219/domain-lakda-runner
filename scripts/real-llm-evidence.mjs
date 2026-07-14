import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertHateManifest } from "../dist/core/hate.js";
import { canonicalJson } from "../dist/core/plan.js";
import { findSensitive } from "../dist/core/redaction.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(await readFile(join(root, "schemas", "real-llm-acceptance-report-v2.schema.json"), "utf8"));
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default;
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

export const PROFILE_CONTRACTS = {
  full: { workers: 1, repetitions: 3, includeNormal: true, expected: { total: 90, normal: 60, critical: 30 }, releaseEligible: true },
  "worker-smoke": { workers: 2, repetitions: 1, includeNormal: false, expected: { total: 20, normal: 0, critical: 20 }, releaseEligible: true },
};

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function persistedCanonicalJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("証跡payloadをJSONへ永続化できません");
  return canonicalJson(JSON.parse(serialized));
}

const acceptanceCorpusPath = join(root, "tests", "fixtures", "acceptance-corpus-v1.json");
const acceptanceCorpusBytes = await readFile(acceptanceCorpusPath);
const acceptanceCorpus = JSON.parse(acceptanceCorpusBytes.toString("utf8"));
const acceptanceCorpusSha256 = sha256(acceptanceCorpusBytes);

export async function fileSha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", chunk => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}

export function resolveAcceptanceProfile(argv, corpusRepetitions) {
  const profileFlag = argv.find(value => value.startsWith("--profile="));
  const workersFlag = argv.find(value => value.startsWith("--workers="));
  const criticalOnly = argv.includes("--critical-only");
  const requested = profileFlag?.slice("--profile=".length);
  if (requested && !(requested in PROFILE_CONTRACTS)) throw new Error("--profileはfullまたはworker-smokeです");
  if (requested && (workersFlag || criticalOnly)) throw new Error("--profileと--workers/--critical-onlyは同時指定できません");
  if (requested) return { name: requested, ...PROFILE_CONTRACTS[requested] };
  if (!workersFlag && !criticalOnly) return { name: "full", ...PROFILE_CONTRACTS.full };
  const workers = workersFlag ? Number(workersFlag.slice("--workers=".length)) : 1;
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error("--workersは1〜4です");
  return {
    name: "custom",
    workers,
    repetitions: criticalOnly ? 1 : corpusRepetitions,
    includeNormal: !criticalOnly,
    expected: undefined,
    releaseEligible: false,
  };
}

export function orderedRuns(runs) {
  return [...runs].sort((left, right) =>
    left.caseId.localeCompare(right.caseId) ||
    left.repetition - right.repetition ||
    left.workerIndex - right.workerIndex);
}

export function runEvidenceSetSha256(runs) {
  return sha256(orderedRuns(runs).map(run => persistedCanonicalJson(run)).join("\n"));
}

export function reportPayloadSha256(report) {
  const { recordPayloadSha256: _ignored, ...payload } = report;
  void _ignored;
  return sha256(persistedCanonicalJson(payload));
}

function satisfiesRun(report, run) {
  return run.status === "completed" &&
    run.strictJsonAccepted &&
    run.selectedExpectedAction &&
    run.outcome === "passed" &&
    run.llmStatus === "available" &&
    !run.implicitFallback &&
    run.providerModelId === report.environment.model.expectedModelId;
}

function coverageFor(report) {
  const completed = report.runs.filter(run => run.status === "completed");
  const normal = completed.filter(run => run.caseKind === "normal");
  const critical = completed.filter(run => run.caseKind === "critical");
  const full = report.profile === "full";
  const smoke = report.profile === "worker-smoke";
  return {
    ac007: { eligible: full, expected: 60, actual: normal.length, passed: full && normal.length === 60 && normal.every(run => satisfiesRun(report, run)) },
    ac010: { eligible: full, expected: 30, actual: critical.length, passed: full && critical.length === 30 && critical.every(run => satisfiesRun(report, run)) },
    ac014Supplement: { eligible: smoke, expected: 20, actual: critical.length, passed: smoke && critical.length === 20 && new Set(critical.map(run => run.workerIndex)).size === 2 && critical.every(run => satisfiesRun(report, run)) },
  };
}

function assertAcceptanceCorpus(report) {
  if (report.corpus.schemaVersion !== acceptanceCorpus.schemaVersion ||
      report.corpus.version !== acceptanceCorpus.version ||
      report.corpus.path !== "tests/fixtures/acceptance-corpus-v1.json" ||
      report.corpus.sha256 !== acceptanceCorpusSha256) {
    throw new Error("report corpusが固定acceptance corpusと一致しません");
  }
}

function expectedProfileRuns(report) {
  if (report.profile === "custom") return undefined;
  const cases = report.profile === "full"
    ? [
        ...acceptanceCorpus.llmDecisionCases.map(caseId => ({ caseId, caseKind: "normal" })),
        ...acceptanceCorpus.criticalLlmCases.map(value => ({ caseId: value.id, caseKind: "critical" })),
      ]
    : acceptanceCorpus.criticalLlmCases.map(value => ({ caseId: value.id, caseKind: "critical" }));
  const repetitions = report.profile === "full" ? 3 : 1;
  const workers = report.profile === "full" ? 1 : 2;
  const expected = [];
  for (const item of cases) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (let workerIndex = 0; workerIndex < workers; workerIndex += 1) {
        expected.push({
          ...item,
          repetition,
          workerIndex,
          seed: (report.environment.sampling.seed + workerIndex) >>> 0,
        });
      }
    }
  }
  return orderedRuns(expected);
}

function assertProfileLayout(report) {
  const expected = expectedProfileRuns(report);
  if (!expected) return;
  const actual = orderedRuns(report.runs);
  if (actual.length !== expected.length) throw new Error("profileのchild run件数が固定layoutと一致しません");
  const seenTuples = new Set();
  for (let index = 0; index < expected.length; index += 1) {
    const run = actual[index];
    const wanted = expected[index];
    const tuple = `${run.caseId}\u0000${run.repetition}\u0000${run.workerIndex}`;
    if (seenTuples.has(tuple)) throw new Error("profileに重複child runがあります: " + run.caseId);
    seenTuples.add(tuple);
    if (run.caseId !== wanted.caseId || run.caseKind !== wanted.caseKind ||
        run.repetition !== wanted.repetition || run.workerIndex !== wanted.workerIndex || run.seed !== wanted.seed) {
      throw new Error("profileのcase/repetition/worker/seed layoutが固定契約と一致しません");
    }
  }
  const completedIds = actual.filter(run => run.status === "completed").map(run => run.runId);
  if (completedIds.some(runId => typeof runId !== "string" || runId.length === 0) || new Set(completedIds).size !== completedIds.length) {
    throw new Error("completed child runのrun IDが空または重複しています");
  }
}

function manifestArtifact(manifest, suffix) {
  return manifest.artifacts.find(artifact => artifact.path.replaceAll("\\", "/").endsWith(suffix));
}

function assertManifestArtifact(manifest, suffix, descriptor) {
  const artifact = manifestArtifact(manifest, suffix);
  if (!artifact) throw new Error("HATE manifestにbundle対象artifactがありません: " + suffix);
  if (artifact.sha256.replace(/^sha256:/, "") !== descriptor.sha256 || artifact.size_bytes !== descriptor.size) {
    throw new Error("HATE manifestのartifact hash/sizeがbundle evidenceと一致しません: " + suffix);
  }
}

export function finalizeReport(report) {
  report.runs = orderedRuns(report.runs);
  report.execution.runCount = report.runs.length;
  report.execution.runEvidenceSetSha256 = runEvidenceSetSha256(report.runs);
  report.coverage = coverageFor(report);
  const allCompletedPass = report.runs.length > 0 && report.runs.every(run => satisfiesRun(report, run));
  report.overall = report.profile === "full"
    ? allCompletedPass && report.coverage.ac007.passed && report.coverage.ac010.passed
    : report.profile === "worker-smoke"
      ? allCompletedPass && report.coverage.ac014Supplement.passed
      : allCompletedPass;
  report.recordPayloadSha256 = reportPayloadSha256(report);
  return report;
}

function portable(path) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error("bundle pathがportableではありません: " + path);
  return path.split(sep).join("/");
}

async function listFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const values = await Promise.all(entries.map(async entry => {
    const path = join(rootPath, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return values.flat();
}

function assertSafeText(path, text) {
  const findings = findSensitive(text);
  if (findings.length) throw new Error("bundle security scan失敗: " + path + " (" + findings.join(",") + ")");
  if (/[A-Za-z]:\\Users\\|\/home\/[^/]+\//i.test(text)) throw new Error("bundleに絶対user pathがあります: " + path);
}

export async function copySanitizedEvidence(source, bundleRoot, relativePath) {
  const targetRelative = portable(relativePath);
  const text = await readFile(source, "utf8");
  assertSafeText(targetRelative, text);
  const target = join(bundleRoot, ...targetRelative.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
  const size = (await stat(target)).size;
  return { path: targetRelative, size, sha256: await fileSha256(target) };
}

export async function writeBundleManifest(bundleRoot, fields) {
  const files = (await listFiles(bundleRoot))
    .filter(path => relative(bundleRoot, path).split(sep).join("/") !== "bundle-manifest.json");
  const entries = [];
  for (const path of files) {
    const rel = portable(relative(bundleRoot, path));
    const text = await readFile(path, "utf8");
    assertSafeText(rel, text);
    entries.push({ path: rel, size: (await stat(path)).size, sha256: await fileSha256(path) });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = { schemaVersion: "lakda/acceptance-bundle/v1", ...fields, files: entries };
  manifest.payloadSha256 = sha256(persistedCanonicalJson(manifest));
  const manifestPath = join(bundleRoot, "bundle-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { manifest, descriptor: { path: "bundle-manifest.json", size: (await stat(manifestPath)).size, sha256: await fileSha256(manifestPath) } };
}

function equal(left, right) {
  return persistedCanonicalJson(left) === persistedCanonicalJson(right);
}

export async function verifyAcceptanceReport({ reportPath, bundlePath, checkRevision = false }) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (!validateSchema(report)) throw new Error("report schema不適合: " + validateSchema.errors.map(error => error.instancePath + " " + error.message).join("; "));
  assertAcceptanceCorpus(report);
  assertProfileLayout(report);
  if (report.recordPayloadSha256 !== reportPayloadSha256(report)) throw new Error("recordPayloadSha256が一致しません");
  if (!equal(report.runs, orderedRuns(report.runs))) throw new Error("runs[]の順序がcanonicalではありません");
  if (report.execution.runEvidenceSetSha256 !== runEvidenceSetSha256(report.runs)) throw new Error("runEvidenceSetSha256が一致しません");
  const expectedCoverage = coverageFor(report);
  if (!equal(report.coverage, expectedCoverage)) throw new Error("coverage判定が再計算結果と一致しません");
  const copy = globalThis.structuredClone(report);
  delete copy.recordPayloadSha256;
  const expectedOverall = finalizeReport(copy).overall;
  if (report.overall !== expectedOverall) throw new Error("overallがprofile契約と一致しません");
  if (report.profile !== "custom") {
    const contract = PROFILE_CONTRACTS[report.profile];
    if (report.environment.workers !== contract.workers || report.execution.runCount !== contract.expected.total) throw new Error("profileの固定件数と一致しません");
    if (!report.environment.model.expectedSha256Provided) throw new Error("release profileに期待GGUF SHA-256がありません");
  }
  const endpoint = new globalThis.URL(report.environment.endpoint);
  if (!["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("LLM endpointがloopbackではありません");
  const model = report.environment.model;
  if (model.actualModelId !== model.expectedModelId) throw new Error("model ID attestation不一致");
  if (model.expectedModelIdSha256 !== sha256(model.expectedModelId) || model.actualModelIdSha256 !== sha256(model.actualModelId)) throw new Error("model ID hash attestation不一致");
  if (model.actualSha256 !== model.expectedSha256) throw new Error("GGUF attestation不一致");
  if (!report.environment.runtime.version || !report.environment.runtime.buildInfo || !report.environment.runtime.chatTemplateSha256) throw new Error("runtime attestationが不足しています");

  const completed = report.runs.filter(run => run.status === "completed");
  const critical = completed.filter(run => run.caseKind === "critical");
  const expectedMetricCounts = {
    total: report.runs.length,
    completed: completed.length,
    accepted: completed.filter(run => run.strictJsonAccepted).length,
    passed: completed.filter(run => run.outcome === "passed").length,
    actionSelected: completed.filter(run => run.selectedExpectedAction).length,
    modelAvailable: completed.filter(run => run.llmStatus === "available").length,
    criticalTotal: critical.length,
    criticalPassed: critical.filter(run => satisfiesRun(report, run)).length,
    implicitFallbacks: report.runs.filter(run => run.implicitFallback).length,
    errors: report.runs.filter(run => !satisfiesRun(report, run)).length,
  };
  for (const [name, value] of Object.entries(expectedMetricCounts)) {
    const actual = name === "errors" ? report.metrics.errors.length : report.metrics[name];
    if (actual !== value) throw new Error("metrics再計算不一致: " + name);
  }

  const bundleManifestPath = join(bundlePath, "bundle-manifest.json");
  const manifestBytes = await readFile(bundleManifestPath);
  if (report.execution.bundleManifest.path !== "bundle-manifest.json" ||
      (await stat(bundleManifestPath)).size !== report.execution.bundleManifest.size ||
      sha256(manifestBytes) !== report.execution.bundleManifest.sha256) {
    throw new Error("bundle manifest descriptorが一致しません");
  }
  const bundleManifest = JSON.parse(manifestBytes.toString("utf8"));
  if (bundleManifest.schemaVersion !== "lakda/acceptance-bundle/v1" ||
      bundleManifest.profile !== report.profile || bundleManifest.subjectRevision !== report.subjectRevision ||
      typeof bundleManifest.acceptanceId !== "string" || !/^[A-Za-z0-9._-]+$/.test(bundleManifest.acceptanceId)) {
    throw new Error("bundle manifest identityがreportと一致しません");
  }
  const { payloadSha256, ...bundlePayload } = bundleManifest;
  if (payloadSha256 !== sha256(persistedCanonicalJson(bundlePayload))) throw new Error("bundle payload hashが一致しません");
  const actualFiles = (await listFiles(bundlePath))
    .map(path => relative(bundlePath, path).split(sep).join("/"))
    .filter(path => path !== "bundle-manifest.json")
    .sort();
  const manifestFiles = bundleManifest.files.map(file => file.path);
  if (!equal(manifestFiles, [...manifestFiles].sort())) throw new Error("bundle manifest file順序がcanonicalではありません");
  const expectedFiles = completed.flatMap(run => Object.values(run.files).map(file => file.path)).sort();
  if (new Set(expectedFiles).size !== expectedFiles.length) throw new Error("child run evidence pathが重複しています");
  if (!equal(actualFiles, manifestFiles) || !equal(actualFiles, expectedFiles)) throw new Error("bundleに未参照file、欠落、または順序不一致があります");
  for (const file of bundleManifest.files) {
    const target = join(bundlePath, ...portable(file.path).split("/"));
    const text = await readFile(target, "utf8");
    assertSafeText(file.path, text);
    if ((await stat(target)).size !== file.size || await fileSha256(target) !== file.sha256) throw new Error("bundle file hash不一致: " + file.path);
  }
  for (const run of completed) {
    for (const descriptor of Object.values(run.files)) {
      const target = join(bundlePath, ...portable(descriptor.path).split("/"));
      if (await fileSha256(target) !== descriptor.sha256 || (await stat(target)).size !== descriptor.size) throw new Error("run evidence hash不一致: " + descriptor.path);
    }
    const evidenceText = await readFile(join(bundlePath, ...run.files.decision.path.split("/")), "utf8");
    const evidence = evidenceText.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const last = evidence.at(-1);
    const strictJsonAccepted = evidence.length > 0 && evidence.every(value => value.validation === "accepted");
    if (run.strictJsonAccepted !== strictJsonAccepted) throw new Error("strict JSON判定がdecision JSONLと一致しません: " + run.caseId);
    const actionSequence = JSON.parse(await readFile(join(bundlePath, ...run.files.actionSequence.path.split("/")), "utf8"));
    const selectedExpectedAction = Array.isArray(actionSequence.actions) && actionSequence.actions.length === 1 && actionSequence.actions[0].id === "navigate-root";
    if (run.selectedExpectedAction !== selectedExpectedAction) throw new Error("action selection判定がaction sequenceと一致しません: " + run.caseId);
    const providerModelId = typeof last?.providerModelId === "string" ? last.providerModelId.split(/[\\/]/).at(-1) : null;
    if (run.providerModelId !== providerModelId || providerModelId !== model.expectedModelId) throw new Error("response model IDがdecision JSONLと一致しません: " + run.caseId);
    if (last.seed !== run.seed || last.temperature !== 0 || last.topP !== 1 || last.maxTokens !== 512) throw new Error("decision sampling/seedが固定契約と一致しません: " + run.caseId);
    const sourceDecision = last.decision;
    const expectedDecision = sourceDecision ? JSON.parse(JSON.stringify({
      decision: sourceDecision.decision,
      candidateId: sourceDecision.candidateId,
      inputProfileId: sourceDecision.inputProfileId,
      reason: sourceDecision.reason,
      confidence: sourceDecision.confidence,
      rawResponseSha256: last.rawResponseSha256,
      promptHash: last.promptHash,
      schemaHash: last.schemaHash,
      responseTokens: last.responseTokens,
      totalLatencyMs: last.totalLatencyMs,
      retryCount: Math.max(0, Number(last.attempt ?? 1) - 1),
    })) : null;
    if (!sourceDecision || sourceDecision.decision !== "action" || sourceDecision.candidateId !== "navigate-root" ||
        typeof sourceDecision.reason !== "string" || sourceDecision.reason.length === 0 ||
        !["low", "medium", "high"].includes(sourceDecision.confidence) || !equal(run.decision, expectedDecision)) {
      throw new Error("decision結果がstrict acceptance契約またはreport summaryと一致しません: " + run.caseId);
    }
    for (const name of ["rawResponseSha256", "promptHash", "schemaHash"]) {
      if (!/^[0-9a-f]{64}$/.test(run.decision[name] ?? "")) throw new Error("decision hashが不足しています: " + name);
    }
    if (!Number.isInteger(run.decision.responseTokens) || run.decision.responseTokens < 0 ||
        !Number.isFinite(run.decision.totalLatencyMs) || run.decision.totalLatencyMs < 0 ||
        !Number.isInteger(run.decision.retryCount) || run.decision.retryCount < 0 || run.decision.retryCount > 2) {
      throw new Error("decision token/latency/retry証跡が不正です: " + run.caseId);
    }
    const hate = JSON.parse(await readFile(join(bundlePath, ...run.files.hateManifest.path.split("/")), "utf8"));
    assertHateManifest(hate);
    if (hate.run_id !== run.runId || hate.commit_sha !== report.subjectRevision) throw new Error("HATE manifestのrun/revision不一致: " + run.caseId);
    assertManifestArtifact(hate, "artifacts/llm-decisions.jsonl", run.files.decision);
    assertManifestArtifact(hate, "action-sequence.json", run.files.actionSequence);
  }
  if (checkRevision) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    if (head !== report.subjectRevision) throw new Error("report subjectRevisionがcheckout中のHEADと一致しません");
  }
  return {
    valid: true,
    profile: report.profile,
    subjectRevision: report.subjectRevision,
    runCount: report.execution.runCount,
    coverage: report.coverage,
    bundleManifestSha256: report.execution.bundleManifest.sha256,
    overall: report.overall,
  };
}