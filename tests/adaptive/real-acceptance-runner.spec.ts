import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const runner = resolve("scripts/run-adaptive-real-acceptance.mjs");
const variableNames = ["LAKDA_ADAPTIVE_REAL_CONFIG", "LAKDA_ADAPTIVE_REAL_CONFIRM", "LAKDA_ADAPTIVE_CORPUS_PATH", "LAKDA_ADAPTIVE_CASE_ID", "LAKDA_ADAPTIVE_ENVIRONMENT", "LAKDA_ADAPTIVE_TARGET_REVISION", "LAKDA_ADAPTIVE_TARGET_MANIFEST"];
const emptyConfigDigest = "sha256:" + createHash("sha256").update("{}").digest("hex");

function run(overrides: NodeJS.ProcessEnv = {}): Promise<{ code: number; stderr: string }> {
  const env = { ...process.env };
  for (const name of variableNames) delete env[name];
  Object.assign(env, overrides);
  return new Promise(resolvePromise => execFile(process.execPath, [runner], { cwd: process.cwd(), env }, (error, _stdout, stderr) => {
    resolvePromise({ code: typeof error?.code === "number" ? error.code : 0, stderr });
  }));
}

test("real adaptive acceptance fails closed before loading config without explicit confirmation", async () => {
  const result = await run();
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("LAKDA_ADAPTIVE_REAL_CONFIRM=I_UNDERSTAND");
});

test("real adaptive acceptance rejects an invalid corpus case before external execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-real-runner-"));
  const configPath = join(directory, "config.json");
  const corpusPath = join(directory, "corpus.json");
  try {
    await writeFile(configPath, "{}", "utf8");
    await writeFile(corpusPath, JSON.stringify({ schemaVersion: "lakda/adaptive-acceptance-corpus/v1", corpusId: "fixture", version: "1", targetRevision: "fixture-revision", cases: [{ caseId: "case-1", acceptanceId: "AC-AE-017", configDigest: emptyConfigDigest, expected: { outcome: "passed" } }] }), "utf8");
    const result = await run({
      LAKDA_ADAPTIVE_REAL_CONFIG: configPath, LAKDA_ADAPTIVE_REAL_CONFIRM: "I_UNDERSTAND", LAKDA_ADAPTIVE_CORPUS_PATH: corpusPath,
      LAKDA_ADAPTIVE_CASE_ID: "case-1", LAKDA_ADAPTIVE_ENVIRONMENT: "fixture-must-not-run", LAKDA_ADAPTIVE_TARGET_REVISION: "fixture-revision",
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("adaptive acceptance case contract is invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real adaptive acceptance rejects target revision mismatch before loading config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-real-revision-"));
  const configPath = join(directory, "config.json");
  const corpusPath = join(directory, "corpus.json");
  try {
    await writeFile(configPath, "{}", "utf8");
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: "lakda/adaptive-acceptance-corpus/v1", corpusId: "fixed-corpus", version: "1", targetRevision: "corpus-revision",
      cases: [{ caseId: "case-1", acceptanceId: "AC-AE-001", configDigest: emptyConfigDigest, expected: { outcome: "passed" } }],
    }), "utf8");
    const result = await run({
      LAKDA_ADAPTIVE_REAL_CONFIG: configPath, LAKDA_ADAPTIVE_REAL_CONFIRM: "I_UNDERSTAND", LAKDA_ADAPTIVE_CORPUS_PATH: corpusPath,
      LAKDA_ADAPTIVE_CASE_ID: "case-1", LAKDA_ADAPTIVE_ENVIRONMENT: "fixture-must-not-run", LAKDA_ADAPTIVE_TARGET_REVISION: "operator-revision",
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("target revision does not match immutable corpus");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("real adaptive acceptance requires a target manifest before loading the browser config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-real-target-manifest-"));
  const configPath = join(directory, "config.json");
  const corpusPath = join(directory, "corpus.json");
  try {
    await writeFile(configPath, "{}", "utf8");
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: "lakda/adaptive-acceptance-corpus/v1", corpusId: "fixed-corpus", version: "1", targetRevision: "corpus-revision",
      cases: [{ caseId: "case-1", acceptanceId: "AC-AE-001", configDigest: emptyConfigDigest, expected: { outcome: "passed" } }],
    }), "utf8");
    const result = await run({
      LAKDA_ADAPTIVE_REAL_CONFIG: configPath, LAKDA_ADAPTIVE_REAL_CONFIRM: "I_UNDERSTAND", LAKDA_ADAPTIVE_CORPUS_PATH: corpusPath,
      LAKDA_ADAPTIVE_CASE_ID: "case-1", LAKDA_ADAPTIVE_ENVIRONMENT: "fixture-must-not-run", LAKDA_ADAPTIVE_TARGET_REVISION: "corpus-revision",
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("LAKDA_ADAPTIVE_TARGET_MANIFEST");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("real adaptive acceptance rejects a pending target manifest before browser execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-real-pending-target-"));
  const configPath = join(directory, "config.json");
  const corpusPath = join(directory, "corpus.json");
  try {
    await writeFile(configPath, "{}", "utf8");
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: "lakda/adaptive-acceptance-corpus/v1", corpusId: "fixed-corpus", version: "1", targetRevision: "corpus-revision",
      cases: [{ caseId: "case-1", acceptanceId: "AC-AE-001", configDigest: emptyConfigDigest, expected: { outcome: "passed" } }],
    }), "utf8");
    const result = await run({
      LAKDA_ADAPTIVE_REAL_CONFIG: configPath, LAKDA_ADAPTIVE_REAL_CONFIRM: "I_UNDERSTAND", LAKDA_ADAPTIVE_CORPUS_PATH: corpusPath,
      LAKDA_ADAPTIVE_CASE_ID: "case-1", LAKDA_ADAPTIVE_ENVIRONMENT: "fixture-must-not-run", LAKDA_ADAPTIVE_TARGET_REVISION: "corpus-revision",
      LAKDA_ADAPTIVE_TARGET_MANIFEST: resolve("docs/targets/saas-crm.pending-external.json"),
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("target manifest remains pending_external");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("real adaptive acceptance rejects a target-manifest settle profile mismatch before browser execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-real-settle-profile-"));
  const configPath = join(directory, "config.json");
  const corpusPath = join(directory, "corpus.json");
  const manifestPath = join(directory, "target.json");
  try {
    const config = {
      schemaVersion: "lakda/v1", baseUrl: "https://staging.example.test/app", mode: "adaptive-explore", durationMs: 1_000, maxActions: 1,
      safety: { allowHosts: ["staging.example.test"], denyActionKinds: [], maxActionsPerMinute: 1 },
      adaptive: {
        schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "least-visited-transition" },
        stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, settlePolicy: { policyVersion: "lightweight-dom/v1", maxWaitMs: 100, stableWindowMs: 10 },
        fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" }, recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
        safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] }, actionContracts: [{ actionId: "view-record", mutationKind: "none" }],
      },
    };
    const configBytes = JSON.stringify(config);
    await writeFile(configPath, configBytes, "utf8");
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: "lakda/adaptive-acceptance-corpus/v1", corpusId: "fixed-corpus", version: "1", targetRevision: "corpus-revision",
      cases: [{ caseId: "case-1", acceptanceId: "AC-AE-001", configDigest: "sha256:" + createHash("sha256").update(configBytes).digest("hex"), expected: { outcome: "passed" } }],
    }), "utf8");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: "lakda/target-manifest/v1", manifestId: "ready-target", targetClass: "crm-list", status: "ready", owner: "owner@example.test",
      environment: { name: "staging", baseUrlOrigin: "https://staging.example.test" }, access: { approved: true, authSource: "github-environment", approvalEvidenceRef: "approval-ref" },
      scope: { allowHosts: ["staging.example.test"], pathPrefixes: ["/app"] }, safety: { allowMutationKinds: ["none"], resetProcedureRef: "reset-ref", killSwitchRef: "kill-ref" },
      privacy: { piiPolicyRef: "pii-ref", sensitiveValuesPersisted: false }, actionContracts: [{ actionId: "view-record", mutationKind: "none" }],
      settleProfile: { policyVersion: "consensus/v1", readiness: null, networkQuietExclusions: ["/api/poll"] }, acceptance: { p0ActionIds: ["view-record"], p1ActionIds: [] },
    }), "utf8");
    const result = await run({
      LAKDA_ADAPTIVE_REAL_CONFIG: configPath, LAKDA_ADAPTIVE_REAL_CONFIRM: "I_UNDERSTAND", LAKDA_ADAPTIVE_CORPUS_PATH: corpusPath,
      LAKDA_ADAPTIVE_CASE_ID: "case-1", LAKDA_ADAPTIVE_ENVIRONMENT: "staging", LAKDA_ADAPTIVE_TARGET_REVISION: "corpus-revision", LAKDA_ADAPTIVE_TARGET_MANIFEST: manifestPath,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("target manifest settle policy does not match config");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real adaptive acceptance rejects config digest mismatch before loading config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-real-config-digest-"));
  const configPath = join(directory, "config.json");
  const corpusPath = join(directory, "corpus.json");
  try {
    await writeFile(configPath, "{}", "utf8");
    await writeFile(corpusPath, JSON.stringify({
      schemaVersion: "lakda/adaptive-acceptance-corpus/v1", corpusId: "fixed-corpus", version: "1", targetRevision: "corpus-revision",
      cases: [{ caseId: "case-1", acceptanceId: "AC-AE-001", configDigest: "sha256:" + "0".repeat(64), expected: { outcome: "passed" } }],
    }), "utf8");
    const result = await run({
      LAKDA_ADAPTIVE_REAL_CONFIG: configPath, LAKDA_ADAPTIVE_REAL_CONFIRM: "I_UNDERSTAND", LAKDA_ADAPTIVE_CORPUS_PATH: corpusPath,
      LAKDA_ADAPTIVE_CASE_ID: "case-1", LAKDA_ADAPTIVE_ENVIRONMENT: "fixture-must-not-run", LAKDA_ADAPTIVE_TARGET_REVISION: "corpus-revision",
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("config digest does not match immutable corpus case");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
