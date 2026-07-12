import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { loadConfig } from "../src/core/config.js";
import { LocalLlmClient, LlmContractError } from "../src/core/llm.js";
import { sha256 } from "../src/core/redaction.js";
import { runLakda } from "../src/core/runner.js";
import { startFixture } from "./fixtures/server.js";

async function llmConfig(baseUrl: string, outputDir: string) {
  const modelPath = join(outputDir, "fixture.gguf"); await writeFile(modelPath, "fixture model");
  return loadConfig(undefined, { baseUrl, outputDir, mode: "llm-explore", llm: { enabled: true, baseUrl: `${baseUrl}/v1`, expectedModelId: "fixture-model", modelPath, modelSha256: sha256("fixture model").toUpperCase() } });
}

test("llm-explore accepts only a supplied candidate and records evidence", async () => {
  let decisions = 0;
  const fixture = await startFixture((url, _method, body) => {
    if (url.pathname === "/v1/models") return { body: JSON.stringify({ data: [{ id: "fixture-model" }] }), contentType: "application/json" };
    if (url.pathname === "/v1/chat/completions") {
      decisions += 1;
      if (body.includes('"stream":true')) return { body: `data: {"choices":[{"delta":{"content":"{\\"decision\\":\\"action\\",\\"candidateId\\":\\"navigate-root\\",\\"reason\\":\\"safe\\",\\"confidence\\":\\"high\\"}"}}]}\n\ndata: [DONE]\n\n`, contentType: "text/event-stream" };
      return { body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }), contentType: "application/json" };
    }
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-"));
  try {
    const result = await runLakda(await llmConfig(fixture.baseUrl, outputDir));
    expect(result.outcome).toBe("passed"); expect(result.llmStatus).toBe("available"); expect(decisions).toBe(2);
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    const evidence = await readFile(join(runDir, "artifacts", "llm-decisions.jsonl"), "utf8");
    expect(evidence).toContain('"validation":"accepted"'); expect(evidence).toContain('"rawResponseSha256"');
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("duplicate decision keys are rejected without provider retry", async () => {
  let completions = 0;
  const fixture = await startFixture((url, _method, body) => {
    if (url.pathname === "/v1/models") return { body: JSON.stringify({ data: [{ id: "fixture-model" }] }), contentType: "application/json" };
    if (url.pathname === "/v1/chat/completions") {
      completions += 1;
      const content = body.includes('"stream":true') ? '{"decision":"action","decision":"action","candidateId":"navigate-root","reason":"bad","confidence":"high"}' : "{}";
      return { body: JSON.stringify({ choices: [{ message: { content } }] }), contentType: "application/json" };
    }
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-invalid-"));
  try {
    const client = new LocalLlmClient(await llmConfig(fixture.baseUrl, outputDir)); await client.preflight();
    await expect(client.decide([{ id: "navigate-root", kind: "navigate", path: "/" }], {})).rejects.toBeInstanceOf(LlmContractError);
    expect(completions).toBe(2);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("loopback policy and retry allowlist are enforced", async () => {
  expect(() => loadConfig(undefined, { llm: { baseUrl: "http://192.0.2.10:8080/v1" } })).toThrow(/loopback/);
  let completions = 0;
  const fixture = await startFixture((url, _method, body) => {
    if (url.pathname === "/v1/models") return { body: JSON.stringify({ data: [{ id: "fixture-model" }] }), contentType: "application/json" };
    if (url.pathname === "/v1/chat/completions") {
      completions += 1;
      if (body.includes('"stream":true') && completions === 2) return { status: 503, body: "temporary", contentType: "text/plain" };
      const content = body.includes('"stream":true') ? '{"decision":"action","candidateId":"navigate-root","reason":"retry-safe","confidence":"high"}' : "{}";
      return { body: JSON.stringify({ choices: [{ message: { content } }] }), contentType: "application/json" };
    }
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-retry-"));
  try {
    const client = new LocalLlmClient(await llmConfig(fixture.baseUrl, outputDir)); await client.preflight();
    const result = await client.decide([{ id: "navigate-root", kind: "navigate", path: "/" }], {});
    expect(result.decision.decision).toBe("action"); expect(result.evidence.attempt).toBe(2); expect(result.evidence.retryReason).toBe("HTTP 503"); expect(completions).toBe(3);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("llm-explore consumes only supplied candidates and redacts decision secrets", async () => {
  let completions = 0; let decisionPrompt = "";
  const fixture = await startFixture((url, _method, body) => {
    if (url.pathname === "/v1/models") return { body: JSON.stringify({ data: [{ id: "fixture-model" }] }), contentType: "application/json" };
    if (url.pathname === "/v1/chat/completions") {
      completions += 1;
      if (body.includes('"stream":true')) {
        decisionPrompt = body;
        const candidateId = completions === 2 ? "first" : "second";
        const content = JSON.stringify({ decision: "action", candidateId, reason: "secret=fixture-secret@example.com", confidence: "high" });
        return { body: JSON.stringify({ choices: [{ message: { content } }] }), contentType: "application/json" };
      }
      return { body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }), contentType: "application/json" };
    }
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-loop-"));
  try {
    const config = await llmConfig(fixture.baseUrl, outputDir);
    config.maxActions = 2;
    config.actionCatalog = [
      { id: "first", kind: "navigate", path: "/first" },
      { id: "second", kind: "navigate", path: "/second" },
    ];
    config.candidates = config.actionCatalog;
    const result = await runLakda(config);
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
    expect(decisionPrompt).not.toContain('"path"'); expect(decisionPrompt).not.toContain('"selector"'); expect(decisionPrompt).not.toContain("fixture-secret");
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    const evidence = await readFile(join(runDir, "artifacts", "llm-decisions.jsonl"), "utf8");
    const sequence = await readFile(join(runDir, "action-sequence.json"), "utf8");
    expect(evidence).not.toContain("fixture-secret"); expect(evidence).toContain('"validation":"accepted"');
    expect(sequence).toContain('"id": "first"'); expect(sequence).toContain('"id": "second"');
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("LLM inputProfileId cannot be substituted", async () => {
  const fixture = await startFixture((url, _method, body) => {
    if (url.pathname === "/v1/models") return { body: JSON.stringify({ data: [{ id: "fixture-model" }] }), contentType: "application/json" };
    if (url.pathname === "/v1/chat/completions") {
      const content = body.includes('"stream":true')
        ? '{"decision":"action","candidateId":"safe","inputProfileId":"other","reason":"bad","confidence":"high"}' : "{}";
      return { body: JSON.stringify({ choices: [{ message: { content } }] }), contentType: "application/json" };
    }
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-profile-"));
  try {
    const client = new LocalLlmClient(await llmConfig(fixture.baseUrl, outputDir)); await client.preflight();
    await expect(client.decide([{ id: "safe", kind: "navigate", path: "/", inputProfileId: "approved" }], {})).rejects.toThrow(/inputProfileId/);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});