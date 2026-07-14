import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../dist/core/config.js";
import { redact } from "../dist/core/redaction.js";
import { runLakda, runLakdaBatch } from "../dist/core/runner.js";
import {
  copySanitizedEvidence,
  fileSha256,
  finalizeReport,
  resolveAcceptanceProfile,
  sha256,
  verifyAcceptanceReport,
  writeBundleManifest,
} from "./real-llm-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = join(repoRoot, "tests", "fixtures", "acceptance-corpus-v1.json");
const corpusBytes = await readFile(corpusPath);
const corpus = JSON.parse(corpusBytes.toString("utf8"));
const corpusSha256 = sha256(corpusBytes);
const profile = resolveAcceptanceProfile(process.argv.slice(2), corpus.repetitions);
const subjectRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const acceptanceIdFlag = process.argv.find(value => value.startsWith("--acceptance-id="));
const acceptanceId = acceptanceIdFlag?.slice("--acceptance-id=".length) ?? ("real-llm-" + profile.name + "-" + subjectRevision.slice(0, 12));
if (!/^[A-Za-z0-9._-]+$/.test(acceptanceId)) throw new Error("--acceptance-idにportableでない文字があります");
const outFlag = process.argv.find(value => value.startsWith("--out="));
const bundleFlag = process.argv.find(value => value.startsWith("--bundle="));
const outputPath = resolve(outFlag?.slice("--out=".length) ?? join(repoRoot, ".lakda", "reports", acceptanceId + ".json"));
const bundlePath = resolve(bundleFlag?.slice("--bundle=".length) ?? join(repoRoot, ".lakda", "acceptance", acceptanceId));
if (existsSync(bundlePath)) throw new Error("bundle directoryは既に存在します: " + bundlePath);
await mkdir(dirname(bundlePath), { recursive: true });
await mkdir(bundlePath);
const endpoint = process.env.LAKDA_REAL_LLM_ENDPOINT ?? "http://127.0.0.1:8080/v1";
const endpointUrl = new globalThis.URL(endpoint);
if (!["127.0.0.1", "localhost", "::1"].includes(endpointUrl.hostname)) throw new Error("実LLM endpointはloopbackだけを許可します");
const modelPath = process.env.LAKDA_REAL_LLM_MODEL ?? "C:\\Users\\ryo-n\\Qwen3.5-4B-Q4_K_M.gguf";
if (!existsSync(modelPath)) throw new Error("GGUFがありません: " + modelPath);
const expectedModelIdRaw = process.env.LAKDA_REAL_LLM_MODEL_ID ?? modelPath;
const expectedShaInput = process.env.LAKDA_REAL_LLM_MODEL_SHA256;
if (profile.releaseEligible && !expectedShaInput) throw new Error("release profileにはLAKDA_REAL_LLM_MODEL_SHA256が必要です");
const actualModelSha256 = await fileSha256(modelPath);
const expectedModelSha256 = (expectedShaInput ?? actualModelSha256).toLowerCase();
if (actualModelSha256 !== expectedModelSha256) throw new Error("GGUF SHA-256が期待値と一致しません");

const propsResponse = await globalThis.fetch(new globalThis.URL("/props", endpoint), { signal: globalThis.AbortSignal.timeout(5_000) });
if (!propsResponse.ok) throw new Error("llama-server /props が失敗しました: HTTP " + propsResponse.status);
const runtimeProps = await propsResponse.json();
if (typeof runtimeProps.build_info !== "string" || !runtimeProps.build_info || typeof runtimeProps.chat_template !== "string" || !runtimeProps.chat_template) {
  throw new Error("llama-server /props にbuild_info/chat_templateがありません");
}
const modelsResponse = await globalThis.fetch(new globalThis.URL("models", endpoint.endsWith("/") ? endpoint : endpoint + "/"), { signal: globalThis.AbortSignal.timeout(5_000) });
if (!modelsResponse.ok) throw new Error("llama-server /v1/models が失敗しました: HTTP " + modelsResponse.status);
const modelsPayload = await modelsResponse.json();
const actualModel = modelsPayload.data?.find(value => value?.id === expectedModelIdRaw);
if (!actualModel) throw new Error("指定model IDが/v1/modelsにありません");
const safeModelId = value => String(value).split(/[\\/]/).at(-1) || String(value);
const expectedModelId = safeModelId(expectedModelIdRaw);
const actualModelId = safeModelId(actualModel.id);
const runtimeEvidence = {
  runtimeVersion: typeof runtimeProps.version === "string" && runtimeProps.version ? runtimeProps.version : runtimeProps.build_info,
  runtimeBuild: runtimeProps.build_info,
  chatTemplateHash: sha256(runtimeProps.chat_template),
};

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<html><body><main data-testid=\"home\">Lakda fixture</main></body></html>");
});
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture address unavailable");
const baseUrl = "http://127.0.0.1:" + address.port;
const outputDir = await mkdtemp(join(tmpdir(), "lakda-real-llm-"));
const runs = [];
const baseSeed = 4219;

function config() {
  return loadConfig(undefined, {
    baseUrl,
    outputDir,
    mode: "llm-explore",
    maxActions: 1,
    workers: profile.workers,
    actionCatalog: [{ id: "navigate-root", kind: "navigate", path: "/" }],
    profiles: {
      smoke: { actionIds: ["navigate-root"] },
      seededRandom: { candidateIds: ["navigate-root"], count: 1 },
    },
    obligations: [{ expectedUrl: "/" }],
    llm: {
      enabled: true,
      baseUrl: endpoint,
      expectedModelId: expectedModelIdRaw,
      modelPath,
      modelSha256: expectedModelSha256.toUpperCase(),
      runtimeEvidence,
    },
  });
}

function safeMessage(error) {
  const message = redact(error instanceof Error ? error.message : String(error));
  return message
    .replace(/[A-Za-z]:\\[^\s]+/g, "[PATH]")
    .replace(/\/home\/[^\s]+/g, "[PATH]");
}

function errorRun(caseId, caseKind, repetition, workerIndex, seed, error) {
  return {
    caseId,
    caseKind,
    repetition,
    workerIndex,
    seed,
    status: "error",
    runId: null,
    outcome: null,
    terminationReason: null,
    llmStatus: null,
    strictJsonAccepted: false,
    selectedExpectedAction: false,
    implicitFallback: true,
    providerModelId: null,
    decision: null,
    files: null,
    error: { name: error instanceof Error ? error.name : "Error", message: safeMessage(error) },
  };
}

async function recordRun(caseId, caseKind, repetition, result, workerIndex, seed) {
  const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
  const evidencePath = join(runDir, "artifacts", "llm-decisions.jsonl");
  const actionPath = join(runDir, "action-sequence.json");
  const hatePath = result.artifactManifestPath ?? join(runDir, "exports", "artifact-manifest.json");
  const evidence = await readFile(evidencePath, "utf8");
  const actionSequence = await readFile(actionPath, "utf8");
  const evidenceRecords = evidence.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const lastEvidence = evidenceRecords.at(-1);
  const actions = JSON.parse(actionSequence).actions;
  const strictJsonAccepted = evidenceRecords.length > 0 && evidenceRecords.every(value => value.validation === "accepted");
  const selectedExpectedAction = Array.isArray(actions) && actions.length === 1 && actions[0].id === "navigate-root";
  const providerModelId = typeof lastEvidence?.providerModelId === "string" ? lastEvidence.providerModelId : null;
  const relativeRoot = "runs/" + caseId + "/r" + String(repetition).padStart(2, "0") + "/w" + workerIndex;
  const files = {
    decision: await copySanitizedEvidence(evidencePath, bundlePath, relativeRoot + "/llm-decisions.jsonl"),
    actionSequence: await copySanitizedEvidence(actionPath, bundlePath, relativeRoot + "/action-sequence.json"),
    hateManifest: await copySanitizedEvidence(hatePath, bundlePath, relativeRoot + "/artifact-manifest.json"),
  };
  const sourceDecision = lastEvidence?.decision;
  const decision = sourceDecision ? {
    decision: sourceDecision.decision,
    candidateId: sourceDecision.candidateId,
    inputProfileId: sourceDecision.inputProfileId,
    reason: sourceDecision.reason,
    confidence: sourceDecision.confidence,
    rawResponseSha256: lastEvidence.rawResponseSha256,
    promptHash: lastEvidence.promptHash,
    schemaHash: lastEvidence.schemaHash,
    responseTokens: lastEvidence.responseTokens,
    totalLatencyMs: lastEvidence.totalLatencyMs,
    retryCount: Math.max(0, Number(lastEvidence.attempt ?? 1) - 1),
  } : null;
  runs.push({
    caseId,
    caseKind,
    repetition,
    workerIndex,
    seed,
    status: "completed",
    runId: result.runId,
    outcome: result.outcome,
    terminationReason: result.terminationReason,
    llmStatus: result.llmStatus,
    strictJsonAccepted,
    selectedExpectedAction,
    implicitFallback: result.llmStatus !== "available",
    providerModelId,
    decision,
    files,
  });
}

async function execute(caseId, caseKind, repetition) {
  try {
    if (profile.workers === 1) {
      const result = await runLakda(config());
      await recordRun(caseId, caseKind, repetition, result, 0, baseSeed);
      return;
    }
    const batch = await runLakdaBatch(config());
    for (const entry of batch.workerResults) {
      if (entry.status === "completed") await recordRun(caseId, caseKind, repetition, entry.result, entry.workerIndex, entry.seed);
      else runs.push(errorRun(caseId, caseKind, repetition, entry.workerIndex, entry.seed, new Error(entry.error.message)));
    }
  } catch (error) {
    for (let workerIndex = 0; workerIndex < profile.workers; workerIndex += 1) {
      runs.push(errorRun(caseId, caseKind, repetition, workerIndex, (baseSeed + workerIndex) >>> 0, error));
    }
  }
}

try {
  if (profile.includeNormal) {
    for (const caseId of corpus.llmDecisionCases) {
      for (let repetition = 1; repetition <= profile.repetitions; repetition += 1) await execute(caseId, "normal", repetition);
    }
  }
  for (const criticalCase of corpus.criticalLlmCases) {
    for (let repetition = 1; repetition <= profile.repetitions; repetition += 1) await execute(criticalCase.id, "critical", repetition);
  }

  const { descriptor: bundleManifest } = await writeBundleManifest(bundlePath, {
    acceptanceId,
    profile: profile.name,
    subjectRevision,
  });
  const completed = runs.filter(run => run.status === "completed");
  const successful = run => run.status === "completed" &&
    run.strictJsonAccepted &&
    run.selectedExpectedAction &&
    run.outcome === "passed" &&
    run.llmStatus === "available" &&
    !run.implicitFallback &&
    run.providerModelId === actualModelId;
  const critical = completed.filter(run => run.caseKind === "critical");
  const errors = runs.filter(run => !successful(run)).map(run => ({
    caseId: run.caseId,
    repetition: run.repetition,
    workerIndex: run.workerIndex,
    status: run.status,
    outcome: run.outcome,
    llmStatus: run.llmStatus,
    error: run.error?.message,
  }));
  const report = finalizeReport({
    schemaVersion: "lakda/real-llm-acceptance/v2",
    generatedAt: new Date().toISOString(),
    profile: profile.name,
    subjectRevision,
    corpus: {
      schemaVersion: corpus.schemaVersion,
      version: corpus.version,
      path: "tests/fixtures/acceptance-corpus-v1.json",
      sha256: corpusSha256,
    },
    environment: {
      endpoint,
      browser: "chromium",
      workers: profile.workers,
      model: {
        expectedModelId,
        actualModelId,
        expectedModelIdSha256: sha256(expectedModelId),
        actualModelIdSha256: sha256(actualModelId),
        fileName: basename(modelPath),
        expectedSha256: expectedModelSha256,
        actualSha256: actualModelSha256,
        expectedSha256Provided: Boolean(expectedShaInput),
      },
      runtime: {
        version: runtimeEvidence.runtimeVersion,
        buildInfo: runtimeEvidence.runtimeBuild,
        chatTemplateSha256: runtimeEvidence.chatTemplateHash,
      },
      sampling: {
        seed: baseSeed,
        temperature: 0,
        topP: 1,
        maxTokens: 512,
      },
      timeouts: {
        connectMs: 5_000,
        generationMs: 60_000,
      },
    },
    execution: {
      command: "npm run acceptance:real-llm:" + (profile.name === "worker-smoke" ? "worker-smoke" : profile.name) + " -- --out=<report> --bundle=<bundle>",
      runCount: runs.length,
      runEvidenceSetSha256: "",
      bundleManifest,
    },
    coverage: {},
    runs,
    metrics: {
      total: runs.length,
      completed: completed.length,
      accepted: completed.filter(run => run.strictJsonAccepted).length,
      passed: completed.filter(run => run.outcome === "passed").length,
      actionSelected: completed.filter(run => run.selectedExpectedAction).length,
      modelAvailable: completed.filter(run => run.llmStatus === "available").length,
      criticalTotal: critical.length,
      criticalPassed: critical.filter(successful).length,
      implicitFallbacks: runs.filter(run => run.implicitFallback).length,
      errors,
    },
    overall: false,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  const verification = await verifyAcceptanceReport({ reportPath: outputPath, bundlePath, checkRevision: true });
  console.log(JSON.stringify({ outputPath, bundlePath, verification }, null, 2));
  if (!report.overall) process.exitCode = 1;
} finally {
  await new Promise(resolvePromise => server.close(resolvePromise));
  await rm(outputDir, { recursive: true, force: true });
}
