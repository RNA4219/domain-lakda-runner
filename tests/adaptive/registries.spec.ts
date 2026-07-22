import { expect, test } from "@playwright/test";
import { BUILTIN_ADAPTER_IDS, assertBuiltInAdapterConfiguration, assertBuiltInAdapterId } from "../../src/adapters/registry.js";
import type { ActionCandidate, ExecutionResult, Observation } from "../../src/adaptive/contracts.js";
import { BUILTIN_GENERATOR_STRATEGIES, assertBuiltInGenerator, selectAdaptiveGenerator, type AdaptiveLlmSelector } from "../../src/adaptive/generators.js";
import { StateGraph } from "../../src/adaptive/graph.js";
import { BUILTIN_ORACLE_IDS, evaluateBuiltInOracles, resolveBuiltInOracle } from "../../src/adaptive/oracle-registry.js";
import type { LlmEvidence } from "../../src/core/types.js";

const candidate = (id: string, weight = 1): ActionCandidate => ({ schemaVersion: "lakda/adaptive-contracts/v1", candidateId: id, adapterId: "playwright", targetRef: { targetId: "page-1", kind: "page" }, sourceFingerprint: "state:one", actionKind: "click", locatorRecipe: { strategy: "test-id", value: "must-not-reach-llm" }, generatedBy: { ruleId: "fixture", observationId: "obs-1", reason: "fixture" }, risk: { weight }, mutationKind: "none" });
const seeded = (seed: number) => { let value = seed >>> 0; return () => { value += 0x6d2b79f5; let next = value; next = Math.imul(next ^ (next >>> 15), next | 1); next ^= next + Math.imul(next ^ (next >>> 7), next | 61); return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296; }; };
const evidence: LlmEvidence = { endpoint: "http://127.0.0.1/v1", runtime: { runtimeVersion: "fixture", runtimeBuild: "fixture", chatTemplateHash: "fixture" }, promptHash: "a".repeat(64), schemaHash: "b".repeat(64), seed: 42, temperature: 0, topP: 1, maxTokens: 128, attempt: 1, totalLatencyMs: 1, redactedRequestSha256: "c".repeat(64), validation: "accepted" };
const observation: Observation = { schemaVersion: "lakda/adaptive-contracts/v1", observationId: "obs-1", observedAt: "2026-07-22T00:00:00Z", targetRef: { targetId: "page-1", kind: "page" }, completeness: "complete", ui: {}, forms: [], dialogs: [], topology: {}, obligations: {}, provenance: { adapterId: "playwright", runtime: "fixture", capabilityRevision: "fixture/v1" } };
const execution: ExecutionResult = { schemaVersion: "lakda/adaptive-contracts/v1", executionId: "exec-1", candidateId: "a", preFingerprint: "state:one", postFingerprint: "state:two", startedAt: "2026-07-22T00:00:00Z", endedAt: "2026-07-22T00:00:01Z", status: "executed", recoveryStatus: "not_required", targetChanges: [], settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] };

test("adapter and oracle registries are closed built-in allowlists", () => {
  expect(BUILTIN_ADAPTER_IDS).toEqual(["playwright", "airtest-poco", "security"]); expect(BUILTIN_ORACLE_IDS).toEqual(["generic", "product-contract", "security-candidate"]);
  expect(() => assertBuiltInAdapterId("custom-module")).toThrow(/built-in adapter/); expect(() => assertBuiltInAdapterConfiguration("playwright", ["device"])).toThrow(/capability mismatch/); expect(() => resolveBuiltInOracle("llm-verdict")).toThrow(/built-in oracle/);
  const result = evaluateBuiltInOracles({ candidate: candidate("a"), before: observation, after: { ...observation, observationId: "obs-2" }, execution });
  expect(result.results.map(value => value.oracleClass)).toEqual(["generic", "product"]);
});
test("all built-in generators are deterministic for an equal graph and seed", async () => {
  for (const strategy of BUILTIN_GENERATOR_STRATEGIES) {
    const run = async () => {
      const graph = new StateGraph(); const candidates = [candidate("b", 3), candidate("a")]; graph.recordFingerprint("state:one", {}, 0); graph.recordOffered(candidates, 0);
      const llm: AdaptiveLlmSelector = { selectAdaptiveCandidate: async ids => ({ decision: { schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "action", candidateId: ids[0] }, evidence }) };
      const selected = await selectAdaptiveGenerator(strategy, { candidates, graph, random: seeded(4219), llm });
      return selected.kind === "candidate" ? selected.candidate.candidateId : selected.kind;
    };
    expect(await run(), strategy).toBe(await run());
  }
});
test("llm-select sees only sorted IDs and redacted graph data, supports stop, and rejects substitutions", async () => {
  const graph = new StateGraph(); const candidates = [candidate("b"), candidate("a")]; graph.recordFingerprint("state:one", {}, 0); graph.recordOffered(candidates, 0); let summary = "";
  const stop: AdaptiveLlmSelector = { selectAdaptiveCandidate: async (ids, value) => {
    expect(ids).toEqual(["a", "b"]); summary = JSON.stringify(value);
    return { decision: { schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "stop" }, evidence };
  } };
  expect((await selectAdaptiveGenerator("llm-select", { candidates, graph, random: seeded(1), llm: stop })).kind).toBe("stop");
  expect(summary).not.toMatch(/must-not-reach-llm|locator|selector|https?:|input|command|oracle|verdict/i);
  const bad: AdaptiveLlmSelector = { selectAdaptiveCandidate: async () => ({ decision: { schemaVersion: "lakda/adaptive-llm-selection/v1", decision: "action", candidateId: "not-offered" }, evidence }) };
  await expect(selectAdaptiveGenerator("llm-select", { candidates: [candidate("safe")], graph, random: seeded(1), llm: bad })).rejects.toThrow(/unoffered/);
  await expect(selectAdaptiveGenerator("llm-select", { candidates: [candidate("https://secret.invalid")], graph, random: seeded(1), llm: bad })).rejects.toThrow(/opaque/);
  expect(() => assertBuiltInGenerator("dynamic-plugin")).toThrow(/built-in generator/);
  expect(() => assertBuiltInGenerator("random", "file:plugin.mjs")).toThrow(/version/);
});