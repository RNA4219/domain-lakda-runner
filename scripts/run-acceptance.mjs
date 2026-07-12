import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { loadConfig } from "../dist/core/config.js";
import { assertHateManifest } from "../dist/core/hate.js";
import { LocalLlmClient } from "../dist/core/llm.js";
import { createActionPlan } from "../dist/core/plan.js";
import { redact } from "../dist/core/redaction.js";
import { runLakda } from "../dist/core/runner.js";
import { runCli } from "../dist/cli.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFlag = process.argv.find(value => value.startsWith("--out="));
const outputPath = resolve(outFlag ? outFlag.slice("--out=".length) : ".lakda/acceptance/fixture-v1.json");
const corpusPath = join(repoRoot, "tests", "fixtures", "acceptance-corpus-v1.json");
const corpusBytes = await readFile(corpusPath);
const corpus = JSON.parse(corpusBytes.toString("utf8"));
const corpusSha256 = createHash("sha256").update(corpusBytes).digest("hex");
const fixtureSecret = "fixture-secret@example.com";
let promptLeakedSecret = false;

const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const requestBody = Buffer.concat(chunks).toString("utf8");
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/v1/models") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data: [{ id: "fixture-model" }] })); return; }
  if (url.pathname === "/v1/chat/completions") {
    if (requestBody.includes(fixtureSecret)) promptLeakedSecret = true;
    let content = "{}";
    if (!requestBody.includes("Reply with {}")) {
      if (requestBody.includes("unpresented-candidate")) content = '{"decision":"action","candidateId":"not-supplied","reason":"reject me","confidence":"high"}';
      else if (requestBody.includes("secret-candidate")) content = `{"decision":"action","candidateId":"secret-candidate","reason":"secret=${fixtureSecret}","confidence":"high"}`;
      else content = '{"decision":"action","candidateId":"navigate-root","reason":"fixture safe action","confidence":"high"}';
    }
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { completion_tokens: 12 } })); return;
  }
  if (url.pathname.startsWith("/defect/")) { response.writeHead(500, { "content-type": "text/html" }); response.end("<h1>fixture defect</h1>"); return; }
  response.writeHead(200, { "content-type": "text/html" }); response.end("<h1>fixture normal</h1>");
});
await new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePromise); });
const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture server address unavailable");
const baseUrl = `http://127.0.0.1:${address.port}`;
const outputDir = await mkdtemp(join(tmpdir(), "lakda-acceptance-"));
const modelPath = join(outputDir, "fixture.gguf"); await writeFile(modelPath, "fixture model", "utf8");
const modelSha256 = createHash("sha256").update("fixture model").digest("hex").toUpperCase();
const metric = { deterministicMatched: 0, deterministicTotal: 0, knownDetected: 0, normalFalsePositives: 0, replaySucceeded: 0, replayTotal: 0, llmConformant: 0, llmTotal: 0, criticalSucceeded: 0, criticalTotal: 0, artifactRequired: 0, artifactMissing: 0, manifestValid: 0, manifestTotal: 0, unsafeExecutions: 0, fallbackCount: 0, secretPlaintextFound: 0, unpresentedCandidateRejected: false, modelMismatchRejected: false };

function config(overrides = {}) { return loadConfig(undefined, { baseUrl, outputDir, mode: "smoke", ...overrides }); }
function llmConfig(overrides = {}) { return config({ mode: "llm-explore", llm: { enabled: true, baseUrl: `${baseUrl}/v1`, expectedModelId: "fixture-model", modelPath, modelSha256 }, ...overrides }); }
async function audit(result) {
  const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
  const required = ["run-metadata.json", "action-sequence.json", "console.jsonl", "failure-report.json", join("exports", "artifact-manifest.json")];
  if (result.outcome === "failed" || result.outcome === "partial") required.push(join("artifacts", "trace.zip"), join("artifacts", "failure.png"));
  metric.artifactRequired += required.length;
  for (const entry of required) if (!existsSync(join(runDir, entry))) metric.artifactMissing += 1;
  if (!result.artifactManifestPath) throw new Error("artifact manifest path is missing");
  assertHateManifest(JSON.parse(await readFile(result.artifactManifestPath, "utf8"))); metric.manifestValid += 1; metric.manifestTotal += 1;
  return runDir;
}

try {
  for (let index = 1; index <= corpus.deterministicRuns; index += 1) {
    const deterministic = config({ mode: "seeded-random", seed: index, candidates: [{ id: "b", kind: "navigate", path: "/b" }, { id: "a", kind: "navigate", path: "/a" }, { id: "c", kind: "navigate", path: "/c" }] });
    metric.deterministicTotal += 1;
    if (Buffer.from(JSON.stringify(createActionPlan(deterministic))).equals(Buffer.from(JSON.stringify(createActionPlan(deterministic))))) metric.deterministicMatched += 1;
  }
  for (const defectId of corpus.knownDefects) {
    const result = await runLakda(config({ candidates: [{ id: defectId, kind: "navigate", path: `/defect/${defectId}` }] }));
    await audit(result); if (result.failures.some(failure => failure.ruleId === "UI-004")) metric.knownDetected += 1;
  }
  for (const normalId of corpus.normalCases) {
    const result = await runLakda(config({ candidates: [{ id: normalId, kind: "navigate", path: `/normal/${normalId}` }] }));
    await audit(result); if (result.outcome !== "passed") metric.normalFalsePositives += 1;
  }
  for (const replayId of corpus.replaySequences) {
    const initial = await runLakda(config({ mode: "seeded-random", candidates: [{ id: replayId, kind: "navigate", path: `/normal/replay/${replayId}` }] })); await audit(initial);
    for (let repetition = 0; repetition < corpus.repetitions; repetition += 1) {
      const replay = await runLakda(config({ mode: "regression-replay" }), initial.actionSequencePath); await audit(replay); metric.replayTotal += 1; if (replay.outcome === "passed") metric.replaySucceeded += 1;
    }
  }
  for (const llmCaseId of corpus.llmDecisionCases) { void llmCaseId;
    for (let repetition = 0; repetition < corpus.repetitions; repetition += 1) {
      const result = await runLakda(llmConfig({ candidates: [{ id: "navigate-root", kind: "navigate", path: "/" }] }));
      const runDir = await audit(result); const evidence = await readFile(join(runDir, "artifacts", "llm-decisions.jsonl"), "utf8");
      metric.llmTotal += 1; if (result.outcome === "passed" && evidence.includes('"validation":"accepted"')) metric.llmConformant += 1;
      if (result.llmStatus === "mismatch") metric.fallbackCount += 1;
    }
  }
  for (const criticalCase of corpus.criticalLlmCases) {
    for (let repetition = 0; repetition < corpus.repetitions; repetition += 1) {
      const result = await runLakda(llmConfig({ candidates: [{ id: "navigate-root", kind: "navigate", path: "/" }] }));
      await audit(result); metric.criticalTotal += 1;
      if (result.outcome === criticalCase.expected) metric.criticalSucceeded += 1;
    }
  }
  for (const unsafeAction of [
    { id: "external", kind: "navigate", path: "http://example.invalid/" },
    { id: "delete-account", kind: "click", selector: "#delete", accessibleName: "Delete account" },
  ]) {
    const result = await runLakda(config({ actionCatalog: [unsafeAction] })); await audit(result);
    if (result.outcome !== "error") metric.unsafeExecutions += 1;
  }
  const securityClient = new LocalLlmClient(llmConfig()); await securityClient.preflight();
  try { await securityClient.decide([{ id: "only", kind: "navigate", path: "/" }], { scenario: "unpresented-candidate" }); } catch { metric.unpresentedCandidateRejected = true; }
  if (!metric.unpresentedCandidateRejected) metric.unsafeExecutions += 1;
  const mismatch = await runLakda(llmConfig({ llm: { enabled: true, baseUrl: `${baseUrl}/v1`, expectedModelId: "missing-model", modelPath, modelSha256 } })); await audit(mismatch);
  metric.modelMismatchRejected = mismatch.outcome === "error" && mismatch.llmStatus === "mismatch";
  if (!metric.modelMismatchRejected) metric.fallbackCount += 1;
  const secretRun = await runLakda(llmConfig({ inputProfiles: { protected: fixtureSecret }, actionCatalog: [{ id: "secret-candidate", kind: "navigate", path: "/", inputProfileId: "protected" }] }));
  const secretRunDir = await audit(secretRun);
  const secretArtifacts = await Promise.all(["run-metadata.json", "action-sequence.json", "console.jsonl", "failure-report.json", join("artifacts", "llm-decisions.jsonl")].map(entry => readFile(join(secretRunDir, entry), "utf8")));
  if (secretArtifacts.some(value => value.includes(fixtureSecret))) metric.secretPlaintextFound += 1;
  const unavailable = await runLakda(config({ llm: { enabled: true, baseUrl: "http://127.0.0.1:1/v1" } })); await audit(unavailable);
  const before = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }); const doctorCode = await runCli(["doctor"]); const after = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  const metrics = { deterministicPlanRate: metric.deterministicMatched / metric.deterministicTotal, knownDefectDetectionRate: metric.knownDetected / corpus.knownDefects.length, falsePositiveRate: metric.normalFalsePositives / corpus.normalCases.length, replaySuccessRate: metric.replaySucceeded / metric.replayTotal, mandatoryArtifactMissingRate: metric.artifactMissing / metric.artifactRequired, strictJsonConformanceRate: metric.llmConformant / metric.llmTotal, unsafeExecutions: metric.unsafeExecutions, unpresentedCandidateRejected: metric.unpresentedCandidateRejected, fallbackCount: metric.fallbackCount, modelMismatchRejected: metric.modelMismatchRejected, secretPlaintextFound: metric.secretPlaintextFound, promptLeakedSecret, criticalGolden: `${metric.criticalSucceeded}/${metric.criticalTotal}`, manifestValid: `${metric.manifestValid}/${metric.manifestTotal}` };
  const acceptance = { "AC-001": metrics.deterministicPlanRate === 1, "AC-002": metrics.knownDefectDetectionRate >= 0.7, "AC-003": metrics.falsePositiveRate <= 0.15, "AC-004": metrics.replaySuccessRate >= 0.85, "AC-005": metrics.mandatoryArtifactMissingRate <= 0.01, "AC-006": metric.manifestValid === metric.manifestTotal, "AC-007": metrics.strictJsonConformanceRate === 1, "AC-008": metric.unsafeExecutions === 0 && metric.unpresentedCandidateRejected, "AC-009": metric.fallbackCount === 0 && metric.modelMismatchRejected, "AC-010": metric.criticalSucceeded === metric.criticalTotal, "AC-011": unavailable.outcome === "passed" && unavailable.llmStatus === "unavailable", "AC-012": doctorCode === 0 && before === after, "AC-013": metric.secretPlaintextFound === 0 && !metrics.promptLeakedSecret && !redact(`Authorization: Bearer ${fixtureSecret}`).includes(fixtureSecret) };
  const report = { schemaVersion: "lakda/acceptance-report/v1", generatedAt: new Date().toISOString(), corpus: { schemaVersion: corpus.schemaVersion, version: corpus.version, path: "tests/fixtures/acceptance-corpus-v1.json", sha256: corpusSha256 }, environment: { fixture: "node-http", browser: "chromium", llm: "fake-openai-compatible-loopback" }, metrics, acceptance, overall: Object.values(acceptance).every(Boolean) };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"); console.log(JSON.stringify({ outputPath, overall: report.overall, metrics }, null, 2)); if (!report.overall) process.exitCode = 1;
} finally { await new Promise(resolvePromise => server.close(resolvePromise)); await rm(outputDir, { recursive: true, force: true }); }