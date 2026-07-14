import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  copySanitizedEvidence,
  reportPayloadSha256,
  resolveAcceptanceProfile,
  runEvidenceSetSha256,
  verifyAcceptanceReport,
} from "../scripts/real-llm-evidence.mjs";
import { createAcceptanceFixture } from "./helpers/real-llm-acceptance-fixture.js";

test("real LLM profiles have fixed normative counts and legacy flags are custom", () => {
  expect(resolveAcceptanceProfile(["--profile=full"], 3)).toMatchObject({ name: "full", workers: 1, repetitions: 3, releaseEligible: true });
  expect(resolveAcceptanceProfile(["--profile=worker-smoke"], 3)).toMatchObject({ name: "worker-smoke", workers: 2, repetitions: 1, releaseEligible: true });
  expect(resolveAcceptanceProfile(["--critical-only", "--workers=2"], 3)).toMatchObject({ name: "custom", workers: 2, repetitions: 1, releaseEligible: false });
  expect(() => resolveAcceptanceProfile(["--profile=full", "--workers=2"], 3)).toThrow(/同時指定/);
});

test("evidence hashes use persisted JSON semantics", () => {
  const inMemory = { caseId: "case-1", optional: undefined, nested: { value: 1, optional: undefined } };
  const persisted = JSON.parse(JSON.stringify(inMemory));
  expect(reportPayloadSha256(inMemory)).toBe(reportPayloadSha256(persisted));
  expect(runEvidenceSetSha256([inMemory])).toBe(runEvidenceSetSha256([persisted]));
});

test("v2 report and per-child sanitized bundle are independently verifiable", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-evidence-test-"));
  const fixture = await createAcceptanceFixture(root, "worker-smoke");
  await expect(verifyAcceptanceReport({ reportPath: fixture.reportPath, bundlePath: fixture.bundle })).resolves.toMatchObject({
    valid: true,
    profile: "worker-smoke",
    runCount: 20,
    overall: true,
  });
  expect(fixture.report.coverage.ac007).toEqual({ eligible: false, expected: 60, actual: 0, passed: false });
  expect(fixture.report.coverage.ac010.eligible).toBe(false);
  expect(fixture.report.coverage.ac014Supplement.passed).toBe(true);
  expect(new Set(fixture.report.runs.flatMap(run => Object.values(run.files).map(file => file.path))).size).toBe(60);
});

test("tampering, unreferenced files, and absolute user paths are rejected", async () => {
  const tamperRoot = await mkdtemp(join(tmpdir(), "lakda-evidence-tamper-"));
  const tampered = await createAcceptanceFixture(tamperRoot, "worker-smoke");
  const decisionPath = join(tampered.bundle, ...tampered.report.runs[0].files.decision.path.split("/"));
  await writeFile(decisionPath, (await readFile(decisionPath, "utf8")) + "tampered\n");
  await expect(verifyAcceptanceReport({ reportPath: tampered.reportPath, bundlePath: tampered.bundle })).rejects.toThrow(/hash|payload|file/);

  const extraRoot = await mkdtemp(join(tmpdir(), "lakda-evidence-extra-"));
  const extra = await createAcceptanceFixture(extraRoot, "worker-smoke");
  await writeFile(join(extra.bundle, "unreferenced.json"), "{}\n");
  await expect(verifyAcceptanceReport({ reportPath: extra.reportPath, bundlePath: extra.bundle })).rejects.toThrow(/未参照|file/);

  const unsafeRoot = await mkdtemp(join(tmpdir(), "lakda-evidence-unsafe-"));
  const source = join(unsafeRoot, "source");
  const bundle = join(unsafeRoot, "bundle");
  await mkdir(bundle);
  await writeFile(source, "C:\\Users\\someone\\model.gguf\n");
  await expect(copySanitizedEvidence(source, bundle, "unsafe.txt")).rejects.toThrow(/絶対user path/);
});

test("profile duplicate tuple and model attestation mismatch are rejected", async () => {
  const duplicateRoot = await mkdtemp(join(tmpdir(), "lakda-evidence-layout-"));
  const duplicate = await createAcceptanceFixture(duplicateRoot, "worker-smoke");
  const duplicateReport = JSON.parse(await readFile(duplicate.reportPath, "utf8"));
  duplicateReport.runs[1].caseId = duplicateReport.runs[0].caseId;
  duplicateReport.runs[1].repetition = duplicateReport.runs[0].repetition;
  duplicateReport.runs[1].workerIndex = duplicateReport.runs[0].workerIndex;
  await writeFile(duplicate.reportPath, JSON.stringify(duplicateReport, null, 2) + "\n");
  await expect(verifyAcceptanceReport({ reportPath: duplicate.reportPath, bundlePath: duplicate.bundle })).rejects.toThrow(/重複|layout/);

  const modelRoot = await mkdtemp(join(tmpdir(), "lakda-evidence-model-"));
  const model = await createAcceptanceFixture(modelRoot, "worker-smoke");
  const modelReport = JSON.parse(await readFile(model.reportPath, "utf8"));
  modelReport.environment.model.actualModelId = "fallback.gguf";
  modelReport.recordPayloadSha256 = reportPayloadSha256(modelReport);
  await writeFile(model.reportPath, JSON.stringify(modelReport, null, 2) + "\n");
  await expect(verifyAcceptanceReport({ reportPath: model.reportPath, bundlePath: model.bundle })).rejects.toThrow(/model ID/);
});