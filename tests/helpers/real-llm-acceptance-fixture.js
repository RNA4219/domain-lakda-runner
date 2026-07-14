import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  copySanitizedEvidence,
  finalizeReport,
  sha256,
  writeBundleManifest,
} from "../../scripts/real-llm-evidence.mjs";

function hateArtifact(id, kind, path, descriptor) {
  return {
    artifact_id: "lakda:artifact-" + id,
    kind,
    path,
    sha256: "sha256:" + descriptor.sha256,
    size_bytes: descriptor.size,
    classification: "internal",
    redaction_status: "redacted",
    redaction_rule_version: "lakda-redact-v1",
    safe_for_summary: true,
    public_exposure: "none",
    retention: { class: "default", days: 14 },
    security_checks: { secrets_scan: "pass", pii_scan: "pass" },
  };
}

export async function createAcceptanceFixture(root, profile) {
  const source = join(root, "source");
  const bundle = join(root, "bundle");
  await mkdir(source, { recursive: true });
  await mkdir(bundle, { recursive: true });
  const corpusBytes = await readFile("tests/fixtures/acceptance-corpus-v1.json");
  const corpus = JSON.parse(corpusBytes.toString("utf8"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runs = [];

  async function addRun(caseId, caseKind, repetition, workerIndex) {
    const seed = 4219 + workerIndex;
    const runId = `${caseId}-${repetition}-${workerIndex}`;
    const relativeRoot = `runs/${caseId}/r${String(repetition).padStart(2, "0")}/w${workerIndex}`;
    const evidenceRecord = {
      validation: "accepted",
      providerModelId: "fixture.gguf",
      seed,
      temperature: 0,
      topP: 1,
      maxTokens: 512,
      attempt: 1,
      responseTokens: 12,
      totalLatencyMs: 4,
      rawResponseSha256: sha256("raw-" + runId),
      promptHash: sha256("prompt-" + runId),
      schemaHash: sha256("schema"),
      decision: { decision: "action", candidateId: "navigate-root", reason: "safe fixture action", confidence: "high" },
    };
    const decisionSource = join(source, runId + "-decision.jsonl");
    const actionSource = join(source, runId + "-action.json");
    const hateSource = join(source, runId + "-hate.json");
    await writeFile(decisionSource, JSON.stringify(evidenceRecord) + "\n");
    await writeFile(actionSource, JSON.stringify({ schemaVersion: "lakda/action-sequence/v1", actions: [{ id: "navigate-root" }] }) + "\n");
    const decision = await copySanitizedEvidence(decisionSource, bundle, relativeRoot + "/llm-decisions.jsonl");
    const actionSequence = await copySanitizedEvidence(actionSource, bundle, relativeRoot + "/action-sequence.json");
    const hate = {
      schema_version: "HATE/v1",
      run_id: runId,
      run_attempt: 1,
      commit_sha: revision,
      artifacts: [
        hateArtifact(runId + "-decision", "log", "artifacts/llm-decisions.jsonl", decision),
        hateArtifact(runId + "-action", "report", "action-sequence.json", actionSequence),
      ],
    };
    await writeFile(hateSource, JSON.stringify(hate) + "\n");
    const hateManifest = await copySanitizedEvidence(hateSource, bundle, relativeRoot + "/artifact-manifest.json");
    runs.push({
      caseId,
      caseKind,
      repetition,
      workerIndex,
      seed,
      status: "completed",
      runId,
      outcome: "passed",
      terminationReason: "completed",
      llmStatus: "available",
      strictJsonAccepted: true,
      selectedExpectedAction: true,
      implicitFallback: false,
      providerModelId: "fixture.gguf",
      decision: {
        ...evidenceRecord.decision,
        rawResponseSha256: evidenceRecord.rawResponseSha256,
        promptHash: evidenceRecord.promptHash,
        schemaHash: evidenceRecord.schemaHash,
        responseTokens: evidenceRecord.responseTokens,
        totalLatencyMs: evidenceRecord.totalLatencyMs,
        retryCount: 0,
      },
      files: { decision, actionSequence, hateManifest },
    });
  }

  const cases = profile === "full"
    ? [
        ...corpus.llmDecisionCases.map(caseId => ({ caseId, caseKind: "normal" })),
        ...corpus.criticalLlmCases.map(value => ({ caseId: value.id, caseKind: "critical" })),
      ]
    : corpus.criticalLlmCases.map(value => ({ caseId: value.id, caseKind: "critical" }));
  const repetitions = profile === "full" ? 3 : 1;
  const workers = profile === "full" ? 1 : 2;
  for (const item of cases) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (let workerIndex = 0; workerIndex < workers; workerIndex += 1) {
        await addRun(item.caseId, item.caseKind, repetition, workerIndex);
      }
    }
  }

  const { descriptor: bundleManifest } = await writeBundleManifest(bundle, { acceptanceId: "fixture-" + profile, profile, subjectRevision: revision });
  const report = finalizeReport({
    schemaVersion: "lakda/real-llm-acceptance/v2",
    generatedAt: "2026-07-14T00:00:00.000Z",
    profile,
    subjectRevision: revision,
    corpus: { schemaVersion: corpus.schemaVersion, version: corpus.version, path: "tests/fixtures/acceptance-corpus-v1.json", sha256: sha256(corpusBytes) },
    environment: {
      endpoint: "http://127.0.0.1:8080/v1",
      browser: "chromium",
      workers,
      model: {
        expectedModelId: "fixture.gguf",
        actualModelId: "fixture.gguf",
        expectedModelIdSha256: sha256("fixture.gguf"),
        actualModelIdSha256: sha256("fixture.gguf"),
        fileName: "fixture.gguf",
        expectedSha256: sha256("model"),
        actualSha256: sha256("model"),
        expectedSha256Provided: true,
      },
      runtime: { version: "fixture-runtime", buildInfo: "fixture-build", chatTemplateSha256: sha256("template") },
      sampling: { seed: 4219, temperature: 0, topP: 1, maxTokens: 512 },
      timeouts: { connectMs: 5000, generationMs: 60000 },
    },
    execution: { command: "fixture", runCount: 0, runEvidenceSetSha256: sha256(""), bundleManifest },
    coverage: {},
    runs,
    metrics: {
      total: runs.length,
      completed: runs.length,
      accepted: runs.length,
      passed: runs.length,
      actionSelected: runs.length,
      modelAvailable: runs.length,
      criticalTotal: runs.filter(value => value.caseKind === "critical").length,
      criticalPassed: runs.filter(value => value.caseKind === "critical").length,
      implicitFallbacks: 0,
      errors: [],
    },
    overall: false,
  });
  const reportPath = join(root, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  return { bundle, report, reportPath, revision };
}