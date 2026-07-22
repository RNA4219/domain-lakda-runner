import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AdaptiveConfig } from "../../src/adaptive/contracts.js";
import type { RedactedGraphSummary } from "../../src/adaptive/generators.js";
import { loadConfig } from "../../src/core/config.js";
import { LocalLlmClient, LlmContractError } from "../../src/core/llm.js";
import { sha256 } from "../../src/core/redaction.js";
import { runLakda } from "../../src/core/runner.js";
import { startFixture } from "../fixtures/server.js";

const adaptive = (): AdaptiveConfig => ({
  schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" }, generator: { strategy: "llm-select" },
  stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 500, stableWindowMs: 10 },
  fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" }, recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 },
  safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
});
const summary: RedactedGraphSummary = {
  schemaVersion: "lakda/adaptive-llm-graph-summary/v1", graphRevision: 1, discoveredStateCount: 1, transitionCount: 0,
  coverage: { actionCoverage: 0, transitionCoverage: 0, transitionPairCoverage: 0, roundTripCoverage: 0, obligationCoverage: 1 },
  candidateStats: [
    { candidateId: "safe-a", sourceStateVisits: 1, transitionVisits: 0, uncovered: true },
    { candidateId: "safe-b", sourceStateVisits: 1, transitionVisits: 0, uncovered: true },
  ],
};
async function config(baseUrl: string, outputDir: string) {
  const modelPath = join(outputDir, "fixture.gguf"); await writeFile(modelPath, "adaptive fixture model");
  return loadConfig(undefined, { baseUrl, outputDir, mode: "adaptive-explore", maxActions: 1, durationMs: 5_000, adaptive: adaptive(), llm: { enabled: true, baseUrl: `${baseUrl}/v1`, expectedModelId: "fixture-model", modelPath, modelSha256: sha256("adaptive fixture model").toUpperCase() } });
}

test("adaptive LLM request is restricted to opaque IDs and redacted summary", async () => {
  let requestBody = "";
  const fixture = await startFixture((url, _method, body) => {
    if (url.pathname === "/v1/models") return { contentType: "application/json", body: JSON.stringify({ data: [{ id: "fixture-model" }] }) };
    if (url.pathname === "/v1/chat/completions") {
      requestBody = body;
      const content = JSON.stringify({ schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "action", candidateId: "safe-a" });
      return { contentType: "application/json", body: JSON.stringify({ model: "fixture-model", choices: [{ message: { content } }] }) };
    }
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-select-client-"));
  try {
    const client = new LocalLlmClient(await config(fixture.baseUrl, outputDir));
    await client.preflight({ completion: false });
    expect(requestBody).toBe("");
    const selected = await client.selectAdaptiveCandidate(["safe-b", "safe-a"], summary);
    expect(selected.decision).toEqual({ schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "action", candidateId: "safe-a" });
    const sent = JSON.parse(requestBody) as { messages: Array<{ role: string; content: string }> };
    const payload = JSON.parse(sent.messages.find(message => message.role === "user")?.content ?? "null") as Record<string, unknown>;
    expect(payload.candidateIds).toEqual(["safe-a", "safe-b"]);
    expect(Object.keys(payload).sort()).toEqual(["candidateIds", "instruction", "summary"]);
    expect(JSON.stringify(payload)).not.toMatch(/locator|selector|https?:|inputValue|command|verdict/);
  } finally {
    await fixture.close(); await rm(outputDir, { recursive: true, force: true });
  }
});


test("adaptive LLM accepts explicit stop and rejects malformed or unoffered decisions", async () => {
  let content = JSON.stringify({ schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "stop" });
  const fixture = await startFixture(url => {
    if (url.pathname === "/v1/models") return { contentType: "application/json", body: JSON.stringify({ data: [{ id: "fixture-model" }] }) };
    if (url.pathname === "/v1/chat/completions") return { contentType: "application/json", body: JSON.stringify({ model: "fixture-model", choices: [{ message: { content } }] }) };
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-select-strict-"));
  try {
    const client = new LocalLlmClient(await config(fixture.baseUrl, outputDir));
    await client.preflight({ completion: false });
    expect((await client.selectAdaptiveCandidate(["safe-a", "safe-b"], summary)).decision).toEqual({ schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "stop" });
    for (const rejected of [
      "not-json",
      JSON.stringify({ schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "stop", reason: "extra" }),
      JSON.stringify({ schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "action", candidateId: "not-offered" }),
    ]) {
      content = rejected;
      await expect(client.selectAdaptiveCandidate(["safe-a", "safe-b"], summary)).rejects.toBeInstanceOf(LlmContractError);
    }
  } finally {
    await fixture.close(); await rm(outputDir, { recursive: true, force: true });
  }
});


test("llm-select configuration rejects missing LLM proof and dynamic adapter fields", () => {
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1", mode: "adaptive-explore", adaptive: adaptive() }))
    .toThrow(/llm-select requires llm\.enabled=true/);
  const extended = { ...adaptive(), adapter: { id: "playwright", modulePath: "./plugin.mjs" } } as unknown as AdaptiveConfig;
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1", mode: "adaptive-explore", adaptive: extended }))
    .toThrow(/unsupported extension fields/);
});


test("unavailable adaptive LLM stops before adapter execution and preserves fail-closed evidence", async () => {
  test.setTimeout(30_000);
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-select-unavailable-"));
  try {
    const result = await runLakda(await config("http://127.0.0.1:1", outputDir));
    expect(result).toMatchObject({ outcome: "partial", exitCode: 2, terminationReason: "llm_error", llmStatus: "unavailable" });
    const tracePath = join(result.actionSequencePath!, "..", "adaptive", "trace.json");
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as { trace: Array<{ type: string; phase?: string; reason?: string }> };
    expect(trace.trace.some(entry => entry.type === "llm-selection-error" && entry.phase === "preflight")).toBe(true);
    expect(trace.trace.some(entry => entry.type === "execution")).toBe(false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
