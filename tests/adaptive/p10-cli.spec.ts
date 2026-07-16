import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { runCli } from "../../src/cli.js";
import { loadConfig } from "../../src/core/config.js";
import { runLakda } from "../../src/core/runner.js";
import { canonicalJson } from "../../src/core/plan.js";
import { startFixture } from "../fixtures/server.js";
import { createInvestigation, assertInvestigation, assertPromotionReady, promoteInvestigation, runStrictReplay } from "../../src/adaptive/investigation.js";
import { candidateDivergence, executionDivergence, oracleDivergence, validateAdaptiveReplayTrace, validateReplayScope } from "../../src/adaptive/replay.js";
import type { ActionCandidate, ExecutionResult, OracleResult } from "../../src/adaptive/contracts.js";
import type { ExplorationLead } from "../../src/adaptive/scouting.js";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type AjvInstance = { compile(schema: object): Validator };
type AjvConstructor = new (options: object) => AjvInstance;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;

function investigationValidator(): Validator {
  const schema = JSON.parse(readFileSync(resolve("schemas/lakda-investigation-v1.schema.json"), "utf8")) as object;
  return new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
}

function candidate(overrides: Partial<ActionCandidate> = {}): ActionCandidate {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "candidate-1", adapterId: "playwright",
    targetRef: { targetId: "page-1", kind: "page", origin: "http://127.0.0.1:3000", lifecycle: "active" },
    sourceFingerprint: "fp-before", actionKind: "click", locatorRecipe: { strategy: "test-id", value: "fail" },
    generatedBy: { ruleId: "rule/v1", observationId: "obs-1", reason: "fixture" }, risk: { weight: 1 }, mutationKind: "none", ...overrides,
  };
}

function execution(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", executionId: "exec-1", candidateId: "candidate-1",
    preFingerprint: "fp-before", postFingerprint: "fp-after", startedAt: "2026-07-16T00:00:00.000Z", endedAt: "2026-07-16T00:00:01.000Z",
    status: "executed", recoveryStatus: "not_required", targetChanges: [{ targetId: "page-1", kind: "page", lifecycle: "active" }],
    settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: ["dom-stable"] }, evidenceRefs: [], ...overrides,
  };
}

function oracle(overrides: Partial<OracleResult> = {}): OracleResult {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", oracleId: "oracle-1", oracleClass: "generic", verdict: "fail",
    severity: "major", sourceRefs: ["exec-1"], requirementRefs: [], evidenceRefs: [], message: "generic-failure:http-error", ...overrides,
  };
}

function traceFor(candidateValue = candidate(), executionValue = execution(), oracleValue = oracle()) {
  return { schemaVersion: "lakda/adaptive-trace/v1" as const, seed: 42, trace: [
    { type: "observation", observationId: "obs-1", targetRef: candidateValue.targetRef, fingerprint: candidateValue.sourceFingerprint },
    { type: "candidate", candidate: candidateValue },
    { type: "execution", executionResult: executionValue, executionId: executionValue.executionId, candidateId: executionValue.candidateId, status: executionValue.status, preFingerprint: executionValue.preFingerprint, postFingerprint: executionValue.postFingerprint, settle: executionValue.settleResult.status },
    { type: "oracle", result: oracleValue },
  ] };
}

function lead(): ExplorationLead {
  return {
    schemaVersion: "lakda/exploration-lead/v1", leadId: "lead-test", leadType: "oracle_failure", signalIds: ["signal-test"],
    priority: 70, status: "open", sourceRefs: ["exec-1"], leadDigest: "sha256:" + "a".repeat(64),
  };
}

test("P10 execution divergence compares pre/post fingerprint, settle, and topology", () => {
  const expected = { status: "executed" as const, preFingerprint: "fp-before", postFingerprint: "fp-after", settleStatus: "settled", targetChanges: [{ targetId: "page-1", kind: "page", lifecycle: "active" }] };
  expect(executionDivergence(expected, execution())).toBeUndefined();
  expect(executionDivergence({ ...expected, preFingerprint: "other" }, execution())).toBe("pre-fingerprint-mismatch");
  expect(executionDivergence({ ...expected, postFingerprint: "other" }, execution())).toBe("post-fingerprint-mismatch");
  expect(executionDivergence({ ...expected, settleStatus: "timed_out" }, execution())).toBe("settle-status-mismatch");
  expect(executionDivergence({ ...expected, targetChanges: [{ targetId: "popup", kind: "page" }] }, execution())).toBe("target-topology-mismatch");
});

test("P10 oracle divergence compares generic/product signatures", () => {
  expect(oracleDivergence([oracle()], [oracle()])).toBeUndefined();
  expect(oracleDivergence([oracle()], [oracle({ oracleClass: "product", message: "postcondition-mismatch:state" })])).toBe("oracle-result-mismatch");
});

test("P10 candidate unresolved and candidate mismatch fail closed", () => {
  expect(candidateDivergence(candidate(), undefined)).toBe("candidate-unresolved");
  expect(candidateDivergence(candidate(), candidate({ actionKind: "fill" }))).toBe("candidate-replay-mismatch");
});

test("P10 unknown schema and secret fields are rejected before replay", () => {
  expect(() => validateAdaptiveReplayTrace({ ...traceFor(), schemaVersion: "unknown" })).toThrow(/schemaVersion/);
  const secret = traceFor(candidate({ locatorRecipe: { strategy: "test-id", value: "fail", secret: "token" } as unknown as ActionCandidate["locatorRecipe"] }));
  expect(() => validateAdaptiveReplayTrace(secret)).toThrow(/sensitive|secret/);
  const inputWithValue = traceFor();
  (inputWithValue.trace[1] as Record<string, unknown>).inputCase = { caseId: "c", fieldId: "f", category: "valid", generatorVersion: "lakda-input-generator/v1", seed: 42, domainRef: "f", validity: "valid", expectedOracleRef: "ok", valueDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", value: "PII" };
  expect(() => validateAdaptiveReplayTrace(inputWithValue)).toThrow(/unknown keys/);
});

test("P10 scope validator rejects out-of-allowlist URLs and target kinds", () => {
  const outside = traceFor(candidate({ targetRef: { targetId: "page-1", kind: "page", origin: "https://outside.example", lifecycle: "active" } }));
  expect(() => validateReplayScope(outside, "http://127.0.0.1:3000", ["127.0.0.1"], ["page"])).toThrow(/outside replay scope/);
  const badKind = traceFor(candidate({ targetRef: { targetId: "device-1", kind: "device", origin: "http://127.0.0.1:3000", lifecycle: "active" } }));
  expect(() => validateReplayScope(badKind, "http://127.0.0.1:3000", ["127.0.0.1"], ["page"])).toThrow(/target kind/);
});

test("P10 investigation is deterministic for fixed input and clock", async () => {
  const first = await runStrictReplay(createInvestigation(lead(), "reviewer:test", "2026-07-16T00:00:00.000Z"), () => ({ reproduced: true, oracleRefs: ["oracle:sha256:" + "b".repeat(64)], evidenceRefs: ["adaptive/trace.json"], details: { stable: true } }));
  const second = await runStrictReplay(createInvestigation(lead(), "reviewer:test", "2026-07-16T00:00:00.000Z"), () => ({ reproduced: true, oracleRefs: ["oracle:sha256:" + "b".repeat(64)], evidenceRefs: ["adaptive/trace.json"], details: { stable: true } }));
  expect(canonicalJson(first)).toBe(canonicalJson(second));
});

test("P10 investigation schema accepts portable replay metadata and rejects unsafe refs", async () => {
  const investigation = await runStrictReplay(createInvestigation(lead(), "reviewer:test", "2026-07-16T00:00:00.000Z"), () => ({
    reproduced: true,
    oracleRefs: ["oracle:sha256:" + "b".repeat(64)],
    evidenceRefs: ["adaptive/trace.json"],
    traceRef: "adaptive/trace.json",
    configDigest: "sha256:" + "c".repeat(64),
    terminationReason: "completed",
    details: { stable: true },
  }));
  const validate = investigationValidator();
  expect(validate(investigation)).toBe(true);
  expect(validate({ ...investigation, extra: true })).toBe(false);
  expect(validate({ ...investigation, evidenceRefs: ["C:/private/trace.json"] })).toBe(false);
  expect(() => assertInvestigation({ ...investigation, evidenceRefs: ["adaptive/secret.json"] })).toThrow(/evidenceRefs/);
  expect(() => assertInvestigation({ ...investigation, traceRef: "/private/trace.json" })).toThrow(/traceRef/);
});

test("P10 reproduced investigation can be promoted and parent digest is derived", async () => {
  const investigation = await runStrictReplay(createInvestigation(lead(), "reviewer:test", "2026-07-16T00:00:00.000Z"), () => ({ reproduced: true, oracleRefs: ["oracle:sha256:" + "b".repeat(64)], evidenceRefs: ["adaptive/trace.json"], details: { stable: true } }));
  assertPromotionReady(investigation, "trace", ["adaptive/trace.json"], () => true);
  const promotion = promoteInvestigation(investigation, "trace", ["adaptive/trace.json"], "2026-07-16T00:00:00.000Z");
  expect(promotion.status).toBe("promoted");
  expect(promotion.parentInvestigationDigest).toMatch(/^sha256:/);
});

test("P10 promotion rejects replay divergence, missing evidence, and missing artifact", async () => {
  const diverged = await runStrictReplay(createInvestigation(lead(), "reviewer:test", "2026-07-16T00:00:00.000Z"), () => ({ reproduced: true, divergence: "fingerprint-mismatch", oracleRefs: ["oracle:sha256:" + "b".repeat(64)], evidenceRefs: ["adaptive/trace.json"] }));
  expect(() => assertPromotionReady(diverged, "trace", ["adaptive/trace.json"], () => true)).toThrow(/reproduced/);
  const noEvidence = await runStrictReplay(createInvestigation(lead(), "reviewer:test", "2026-07-16T00:00:00.000Z"), () => ({ reproduced: true, oracleRefs: ["oracle:sha256:" + "b".repeat(64)] }));
  expect(() => assertPromotionReady(noEvidence, "trace", ["adaptive/trace.json"], () => true)).toThrow(/evidenceRefs/);
  const missing = await runStrictReplay(createInvestigation(lead(), "reviewer:test", "2026-07-16T00:00:00.000Z"), () => ({ reproduced: true, oracleRefs: ["oracle:sha256:" + "b".repeat(64)], evidenceRefs: ["adaptive/trace.json"] }));
  expect(() => assertPromotionReady(missing, "trace", ["adaptive/trace.json"], () => false)).toThrow(/missing/);
});

test("P10 trace validation has replayable candidate, execution, and oracle expectations", () => {
  expect(() => validateAdaptiveReplayTrace(traceFor())).not.toThrow();
  expect(() => validateAdaptiveReplayTrace({ schemaVersion: "lakda/adaptive-trace/v1", seed: 42, trace: [{ type: "candidate", candidate: candidate() }] })).toThrow(/execution/);
});


test("P10 generated trace with partial replay expectations is rejected, divergence-only trace is allowed", () => {
  const partial = traceFor();
  partial.trace = partial.trace.filter(entry => entry.type !== "oracle");
  expect(() => validateAdaptiveReplayTrace(partial, { requireReplayable: false })).toThrow(/oracle/);
  const divergenceOnly = { schemaVersion: "lakda/adaptive-trace/v1" as const, seed: 42, trace: [{ type: "replay-divergence", reason: "candidate-unresolved" }] };
  expect(() => validateAdaptiveReplayTrace(divergenceOnly, { requireReplayable: false })).not.toThrow();
});
test("P10 preflight missing trace or config never reaches target", async () => {
  let requests = 0;
  const fixture = await startFixture(() => { requests += 1; return { body: "<main>ok</main>" }; });
  const dir = await mkdtemp(join(process.cwd(), "test-results", "p10-preflight-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "lakda/v1", mode: "adaptive-explore", baseUrl: fixture.baseUrl, seed: 42, outputDir: dir, adaptive: { schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 500, stableWindowMs: 10 }, fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" }, recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 }, safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] } }, safety: { allowHosts: ["127.0.0.1"] } }));
    const leadPath = join(dir, "lead.json");
    const tracePath = join(dir, "trace.json");
    await writeFile(leadPath, JSON.stringify(lead()));
    await writeFile(tracePath, JSON.stringify(traceFor()));
    const missingTrace = await runCli(["investigate", "--lead", leadPath, "--trace", join(dir, "missing-trace.json"), "--config", configPath, "--reviewer", "reviewer:test", "--out", join(dir, "missing-trace.json")]);
    const missingConfig = await runCli(["investigate", "--lead", leadPath, "--trace", tracePath, "--config", join(dir, "missing-config.json"), "--reviewer", "reviewer:test", "--out", join(dir, "missing-config.json")]);
    expect(missingTrace).not.toBe(0);
    expect(missingConfig).not.toBe(0);
    expect(requests).toBe(0);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});

test("P10 CLI scout-investigate-promote completes on the same fixture and preserves source trace bytes", async () => {
  const fixture = await startFixture(url => url.pathname === "/failure"
    ? { status: 500, body: "<main>failure</main>" }
    : { body: "<main><a data-testid='fail' data-lakda-mutation-kind='none' href='/failure'>Fail</a></main>" });
  const dir = await mkdtemp(join(process.cwd(), "test-results", "p10-cli-"));
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: dir, seed: 42, maxActions: 1, durationMs: 8_000, mode: "adaptive-explore", adaptive: { schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 500, stableWindowMs: 10 }, fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" }, recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 }, safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] } } });
    const configPath = join(dir, "lakda.config.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "lakda/v1", baseUrl: fixture.baseUrl, mode: "adaptive-explore", seed: 42, outputDir: dir, maxActions: 1, durationMs: 8_000, safety: { allowHosts: ["127.0.0.1"] }, adaptive: config.adaptive }));
    const source = await runLakda(config);
    expect(source.actionSequencePath).toBeTruthy();
    const tracePath = join(source.actionSequencePath ? dirname(source.actionSequencePath) : dir, "adaptive", "trace.json");
    const sourceBytes = await readFile(tracePath);
    const leadsPath = join(dir, "leads.json");
    expect(await runCli(["scout", "--config", configPath, "--suite", tracePath, "--scout-mode", "rule-only", "--out", leadsPath])).toBe(0);
    const investigationPath = join(dir, "investigation.json");
    const investigateCode = await runCli(["investigate", "--lead", leadsPath, "--trace", tracePath, "--config", configPath, "--reviewer", "reviewer:test", "--out", investigationPath]);
    expect(investigateCode).toBe(0);
    const investigation = JSON.parse(await readFile(investigationPath, "utf8")) as { status: string; replayCount: number; oracleRefs?: string[]; evidenceRefs?: string[] };
    expect(investigation.status).toBe("reproduced");
    expect(investigation.replayCount).toBe(1);
    expect(investigation.oracleRefs?.length).toBeGreaterThan(0);
    expect(investigation.evidenceRefs?.length).toBeGreaterThan(0);
    const promotionPath = join(dir, "promotion.json");
    expect(await runCli(["promote", "--investigation", investigationPath, "--kind", "trace", "--out", promotionPath])).toBe(0);
    const promotion = JSON.parse(await readFile(promotionPath, "utf8")) as { status: string; parentInvestigationDigest: string };
    expect(promotion.status).toBe("promoted");
    expect(promotion.parentInvestigationDigest).toMatch(/^sha256:/);
    expect(await readFile(tracePath)).toEqual(sourceBytes);
  } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
});
