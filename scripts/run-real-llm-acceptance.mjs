import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../dist/core/config.js";
import { runLakda } from "../dist/core/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = join(repoRoot, "tests", "fixtures", "acceptance-corpus-v1.json");
const corpusBytes = await readFile(corpusPath);
const corpus = JSON.parse(corpusBytes.toString("utf8"));
const corpusSha256 = createHash("sha256").update(corpusBytes).digest("hex");
const endpoint = process.env.LAKDA_REAL_LLM_ENDPOINT ?? "http://127.0.0.1:8080/v1";
const modelPath = process.env.LAKDA_REAL_LLM_MODEL ?? "C:\\Users\\ryo-n\\Qwen3.5-4B-Q4_K_M.gguf";
const modelSha256 = "00FE7986FF5F6B463E62455821146049DB6F9313603938A70800D1FB69EF11A4";
const outFlag = process.argv.find(value => value.startsWith("--out="));
const outputArgument = outFlag ? outFlag.slice("--out=".length) : "docs/acceptance/AC-20260713-02.real-llm.json";
const outputPath = resolve(outputArgument);
const executedCommand = `npm run acceptance:real-llm -- --out=${outputArgument}`;
const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const sha256 = value => createHash("sha256").update(value).digest("hex");
if (!existsSync(modelPath)) throw new Error(`GGUFがありません: ${modelPath}`);

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<html><body><main data-testid=\"home\">Lakda fixture</main></body></html>");
});
await new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePromise); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture address unavailable");
const baseUrl = `http://127.0.0.1:${address.port}`;
const outputDir = await mkdtemp(join(tmpdir(), "lakda-real-llm-"));
const metrics = { total: 0, accepted: 0, passed: 0, actionSelected: 0, modelAvailable: 0, criticalTotal: 0, criticalPassed: 0, implicitFallbacks: 0, errors: [] };
const runEvidenceHashes = [];
const acceptanceConfig = config();

function config() {
  return loadConfig(undefined, {
    baseUrl, outputDir, mode: "llm-explore", maxActions: 1,
    actionCatalog: [{ id: "navigate-root", kind: "navigate", path: "/" }],
    profiles: { smoke: { actionIds: ["navigate-root"] }, seededRandom: { candidateIds: ["navigate-root"], count: 1 } },
    obligations: [{ expectedUrl: "/" }],
    llm: { enabled: true, baseUrl: endpoint, expectedModelId: "Qwen3.5-4B-Q4_K_M.gguf", modelPath, modelSha256 },
  });
}

async function execute(caseId, critical = false) {
  const result = await runLakda(config());
  const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
  const evidencePath = join(runDir, "artifacts", "llm-decisions.jsonl");
  const actionPath = join(runDir, "action-sequence.json");
  const evidence = existsSync(evidencePath) ? await readFile(evidencePath, "utf8") : "";
  const actionSequence = existsSync(actionPath) ? await readFile(actionPath, "utf8") : "";
  const actions = actionSequence ? JSON.parse(actionSequence).actions : [];
  const accepted = evidence.includes('"validation":"accepted"');
  const selected = Array.isArray(actions) && actions.length === 1 && actions[0].id === "navigate-root";
  metrics.total += 1;
  if (accepted) metrics.accepted += 1;
  if (result.outcome === "passed") metrics.passed += 1;
  if (selected) metrics.actionSelected += 1;
  if (result.llmStatus === "available") metrics.modelAvailable += 1;
  if (result.llmStatus !== "available") metrics.implicitFallbacks += 1;
  if (critical) { metrics.criticalTotal += 1; if (accepted && selected && result.outcome === "passed") metrics.criticalPassed += 1; }
  runEvidenceHashes.push(sha256(JSON.stringify({ caseId, critical, runId: result.runId, outcome: result.outcome, llmStatus: result.llmStatus, accepted, selected, evidenceSha256: sha256(evidence), actionSequenceSha256: sha256(actionSequence) })));
  if (!(accepted && selected && result.outcome === "passed" && result.llmStatus === "available")) metrics.errors.push({ caseId, outcome: result.outcome, llmStatus: result.llmStatus, accepted, selected, failures: result.failures.map(failure => failure.ruleId) });
}

try {
  for (const caseId of corpus.llmDecisionCases) for (let repetition = 0; repetition < corpus.repetitions; repetition += 1) await execute(`${caseId}-${repetition + 1}`);
  for (const criticalCase of corpus.criticalLlmCases) for (let repetition = 0; repetition < corpus.repetitions; repetition += 1) await execute(`${criticalCase.id}-${repetition + 1}`, true);
  const report = {
    schemaVersion: "lakda/real-llm-acceptance-report/v1",
    generatedAt: new Date().toISOString(),
    corpus: { schemaVersion: corpus.schemaVersion, version: corpus.version, path: "tests/fixtures/acceptance-corpus-v1.json", sha256: corpusSha256 },
    environment: {
      endpoint,
      expectedModelId: "Qwen3.5-4B-Q4_K_M.gguf",
      modelPath,
      modelSha256,
      runtime: acceptanceConfig.llm.runtimeEvidence,
      sampling: { seed: acceptanceConfig.seed, temperature: acceptanceConfig.llm.temperature, topP: acceptanceConfig.llm.topP, maxTokens: acceptanceConfig.llm.maxTokens },
      timeouts: { connectMs: acceptanceConfig.llm.connectTimeoutMs, generationMs: acceptanceConfig.llm.requestTimeoutMs },
      browser: "chromium",
    },
    execution: {
      command: executedCommand,
      gitCommit,
      runCount: runEvidenceHashes.length,
      runEvidenceSetSha256: sha256(runEvidenceHashes.join("\n")),
      rawRunDirectoriesRetained: false,
    },
    metrics,
    acceptance: {
      strictJsonConformance: metrics.accepted === metrics.total,
      safeActionSelection: metrics.actionSelected === metrics.total,
      successfulExploration: metrics.passed === metrics.total,
      noImplicitFallback: metrics.implicitFallbacks === 0 && metrics.modelAvailable === metrics.total,
      criticalGolden: metrics.criticalPassed === metrics.criticalTotal,
    },
  };
  report.overall = Object.values(report.acceptance).every(Boolean);
  report.recordPayloadSha256 = sha256(JSON.stringify(report));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, overall: report.overall, acceptance: report.acceptance, total: metrics.total }, null, 2));
  if (!report.overall) process.exitCode = 1;
} finally {
  await new Promise(resolvePromise => server.close(resolvePromise));
  await rm(outputDir, { recursive: true, force: true });
}