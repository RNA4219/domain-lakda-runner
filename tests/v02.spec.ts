import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { ActionBudget } from "../src/core/action-budget.js";
import { loadConfig } from "../src/core/config.js";
import { sha256 } from "../src/core/redaction.js";
import { runLakda, runLakdaBatch } from "../src/core/runner.js";
import { exportHate } from "../src/core/hate.js";
import { writeSanitizedHar } from "../src/core/har.js";
import { startFixture } from "./fixtures/server.js";

test("ActionBudget shares a sliding window and expires entries", () => {
  let now = 0;
  const budget = new ActionBudget(2, () => now);
  expect(budget.tryConsume()).toBeTruthy();
  expect(budget.tryConsume()).toBeTruthy();
  expect(budget.tryConsume()).toBeFalsy();
  now = 60_000;
  expect(budget.tryConsume()).toBeTruthy();
});

test("workers run sequentially as independent HATE-backed results", async () => {
  const fixture = await startFixture();
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-batch-"));
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, workers: 2, mode: "smoke", safety: { maxActionsPerMinute: 10 } });
    const result = await runLakdaBatch(config);
    expect(result.schemaVersion).toBe("lakda/run-batch/v1");
    expect(result.outcome).toBe("passed");
    expect(result.completedWorkers).toBe(2);
    const children = result.workerResults.filter(entry => entry.status === "completed");
    expect(children.map(entry => entry.seed)).toEqual([4219, 4220]);
    expect(new Set(children.map(entry => entry.result.runId)).size).toBe(2);
    for (const child of children) await expect(readFile(child.result.artifactManifestPath!, "utf8")).resolves.toContain('"schema_version": "HATE/v1"');
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("batch-wide action budget stops later workers with partial", async () => {
  const fixture = await startFixture();
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-budget-"));
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, workers: 2, mode: "smoke", safety: { maxActionsPerMinute: 1 } });
    const result = await runLakdaBatch(config);
    const children = result.workerResults.filter(entry => entry.status === "completed");
    expect(children[0].result.outcome).toBe("passed");
    expect(children[1].result.outcome).toBe("partial");
    expect(children[1].result.terminationReason).toBe("rate_limit");
    expect(result.outcome).toBe("partial");
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("fake LLM workers=2 keep strict decision evidence per child", async () => {
  const fixture = await startFixture((url, _method, body) => {
    if (url.pathname === "/v1/models") return { body: JSON.stringify({ data: [{ id: "fixture-model" }] }), contentType: "application/json" };
    if (url.pathname === "/v1/chat/completions" && body.includes('"stream":true')) return { body: `data: {"choices":[{"delta":{"content":"{\\"decision\\":\\"action\\",\\"candidateId\\":\\"root\\",\\"reason\\":\\"safe\\",\\"confidence\\":\\"high\\"}"}}]}\n\ndata: [DONE]\n\n`, contentType: "text/event-stream" };
    if (url.pathname === "/v1/chat/completions") return { body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }), contentType: "application/json" };
    return undefined;
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-llm-batch-"));
  try {
    const modelPath = join(outputDir, "fixture.gguf"); await writeFile(modelPath, "fixture model");
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, workers: 2, mode: "llm-explore", actionCatalog: [{ id: "root", kind: "navigate" as const, path: "/" }], llm: { enabled: true, baseUrl: `${fixture.baseUrl}/v1`, expectedModelId: "fixture-model", modelPath, modelSha256: sha256("fixture model").toUpperCase() } });
    const result = await runLakdaBatch(config);
    expect(result.outcome).toBe("passed");
    for (const entry of result.workerResults) if (entry.status === "completed") expect(entry.result.llmStatus).toBe("available");
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("domSnapshots saves redacted HTML after each action", async () => {
  const fixture = await startFixture(() => ({ body: '<button data-testid="next">Next</button><input value="fixture@example.com"><div data-lakda-sensitive="true" data-private="dom-attribute-private" aria-label="dom-attribute-private">token=fixture-secret</div><script>const secret="fixture-secret";</script>', contentType: "text/html" }));
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-dom-"));
  try {
    const actions = [{ id: "root", kind: "navigate" as const, path: "/" }, { id: "next", kind: "click" as const, locator: { testId: "next" } }];
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, actionCatalog: actions, profiles: { smoke: { actionIds: ["root", "next"] } }, artifacts: { domSnapshots: true } }));
    expect(result.outcome).toBe("passed");
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    const snapshots = await readdir(join(runDir, "artifacts", "dom"));
    expect(snapshots).toHaveLength(2);
    const html = await readFile(join(runDir, "artifacts", "dom", snapshots[1]), "utf8");
    expect(html).not.toContain("fixture@example.com");
    expect(html).not.toContain("fixture-secret");
    expect(html).not.toContain("dom-attribute-private");
    expect(html).not.toContain("const secret");
    const manifest = JSON.parse(await readFile(result.artifactManifestPath!, "utf8")) as { artifacts: Array<{ path: string; kind: string; redaction_status: string }> };
    expect(manifest.artifacts.find(artifact => artifact.path.includes("artifacts/dom/"))).toMatchObject({ kind: "static", redaction_status: "redacted" });
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("config derives fixture reset and synchronizes llm seed", () => {
  const config = loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", seed: 99, fixtureReset: { url: "/reset" } });
  expect(config.llm.seed).toBe(99);
  expect(config.safety.fixtureResetConfigured).toBeTruthy();
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", seed: 99, llm: { seed: 100 } })).toThrow(/llm.seed/);
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", safety: { fixtureResetConfigured: true } })).toThrow(/fixtureResetConfigured/);
});

test("single worker enforces the action budget", async () => {
  const fixture = await startFixture();
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-single-budget-"));
  try {
    const actions = [
      { id: "first", kind: "navigate" as const, path: "/" },
      { id: "second", kind: "navigate" as const, path: "/" },
    ];
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, actionCatalog: actions, profiles: { smoke: { actionIds: ["first", "second"] } }, safety: { maxActionsPerMinute: 1 } });
    const result = await runLakda(config);
    expect(result.outcome, JSON.stringify(result)).toBe("partial");
    expect(result.terminationReason).toBe("rate_limit");
    expect(result.exitCode).toBe(2);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("runtime rejects non-integer worker overrides", () => {
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", workers: 1.5 })).toThrow(/workers/);
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", workers: Number.NaN })).toThrow(/workers/);
});


test("HAR redacts headers, cookies, query values, and repeated re-exports", async () => {
  const fixture = await startFixture();
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-har-"));
  const beforeHarDirectories = new Set((await readdir(tmpdir())).filter(name => name.startsWith("lakda-har-")));
  try {
    const rawPath = join(outputDir, "raw.har");
    const sanitizedPath = join(outputDir, "sanitized.har");
    const markers = ["HAR_AUTH_PRIVATE", "HAR_COOKIE_PRIVATE", "HAR_SET_COOKIE_PRIVATE", "HAR_QUERY_PRIVATE"];
    await writeFile(rawPath, JSON.stringify({ log: { entries: [{ request: { url: "http://127.0.0.1/?plain=HAR_QUERY_PRIVATE", headers: [{ name: "Authorization", value: "Bearer HAR_AUTH_PRIVATE" }, { name: "Cookie", value: "session=HAR_COOKIE_PRIVATE" }], queryString: [{ name: "plain", value: "HAR_QUERY_PRIVATE" }] }, response: { headers: [{ name: "Set-Cookie", value: "session=HAR_SET_COOKIE_PRIVATE" }] } }] } }));
    await writeSanitizedHar(rawPath, sanitizedPath);
    const sanitized = await readFile(sanitizedPath, "utf8");
    for (const marker of markers) expect(sanitized).not.toContain(marker);

    const secretUrl = "/api?token=fixture-secret&email=fixture@example.com";
    const action = { id: "secret-query", kind: "navigate" as const, path: secretUrl };
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, actionCatalog: [action], artifacts: { har: true, classification: "restricted" } }));
    expect(result.outcome).toBe("passed");
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    const har = await readFile(join(runDir, "artifacts", "network.har"), "utf8");
    expect(har).not.toContain("fixture-secret");
    expect(har).not.toContain("fixture@example.com");
    JSON.parse(har);
    const original = await readFile(result.artifactManifestPath!, "utf8");
    const manifest = JSON.parse(original) as { artifacts: Array<{ classification: string; path: string; security_checks: { secrets_scan: string; pii_scan: string } }> };
    expect(new Set(manifest.artifacts.map(artifact => artifact.classification))).toEqual(new Set(["restricted"]));
    expect(manifest.artifacts.find(artifact => artifact.path === "artifacts/network.har")?.security_checks).toEqual({ secrets_scan: "pass", pii_scan: "pass" });
    const reexportPath = join(runDir, "exports", "reexport.json");
    await exportHate(runDir, reexportPath);
    expect(await readFile(reexportPath, "utf8")).toBe(original);
    await exportHate(runDir, result.artifactManifestPath!);
    const repeated = await readFile(result.artifactManifestPath!, "utf8");
    expect(repeated).toBe(original);
    expect((JSON.parse(repeated) as { artifacts: Array<{ path: string }> }).artifacts.some(artifact => artifact.path.startsWith("exports/"))).toBeFalsy();
    const retainedHarDirectories = (await readdir(tmpdir())).filter(name => name.startsWith("lakda-har-") && !beforeHarDirectories.has(name));
    expect(retainedHarDirectories).toEqual([]);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});
test("DOM snapshot capacity stops without writing the oversized snapshot", async () => {
  const fixture = await startFixture(() => ({ body: "<main>snapshot content</main>" }));
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-dom-limit-"));
  try {
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, artifacts: { domSnapshots: true, maxRunBytes: 1000 } }));
    expect(result.outcome).toBe("partial");
    expect(result.terminationReason).toBe("artifact_limit");
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    await expect(readdir(join(runDir, "artifacts", "dom"))).resolves.toEqual([]);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("a failed action with no successful DOM snapshot remains machine failed", async () => {
  const fixture = await startFixture();
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-dom-failure-"));
  try {
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, artifacts: { domSnapshots: true }, actionCatalog: [{ id: "missing", kind: "navigate" as const, path: "http://127.0.0.1:1/" }] }));
    expect(result.outcome).toBe("failed");
    expect(result.terminationReason).toBe("machine_failure");
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});


test("an exhausted runtime budget skips LLM preflight", async () => {
  let llmRequests = 0;
  const fixture = await startFixture((url) => { if (url.pathname.startsWith("/v1/")) llmRequests += 1; return { body: "{}", contentType: "application/json" }; });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-early-budget-"));
  try {
    const modelPath = join(outputDir, "fixture.gguf");
    await writeFile(modelPath, "fixture model");
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "llm-explore", actionCatalog: [{ id: "root", kind: "navigate" as const, path: "/" }], llm: { enabled: true, baseUrl: fixture.baseUrl + "/v1", expectedModelId: "fixture-model", modelPath, modelSha256: sha256("fixture model").toUpperCase() } });
    const budget = new ActionBudget(1, () => 0);
    expect(budget.tryConsume()).toBeTruthy();
    const result = await runLakda(config, undefined, { actionBudget: budget, clock: () => 0 });
    expect(result.outcome).toBe("partial");
    expect(result.terminationReason).toBe("rate_limit");
    expect(llmRequests).toBe(0);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("fixture reset failure preserves executor_error", async () => {
  const fixture = await startFixture();
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-reset-error-"));
  try {
    const action = { id: "mutate", kind: "click" as const, locator: { testId: "mutate" }, mutates: true };
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, fixtureReset: { url: "/failure" }, actionCatalog: [action], profiles: { smoke: { actionIds: ["mutate"] } } });
    const result = await runLakda(config);
    expect(result.outcome).toBe("error");
    expect(result.terminationReason).toBe("executor_error");
    expect(result.exitCode).toBe(1);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("manifest export failure omits artifactManifestPath", async () => {
  const fixture = await startFixture();
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-manifest-collision-"));
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;
    const runDir = join(outputDir, "lakda-run-1970-01-01T00-00-00-000Z-8");
    await mkdir(join(runDir, "exports", "artifact-manifest.json"), { recursive: true });
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir }), undefined, { clock: () => 0 });
    expect(result.outcome).toBe("error");
    expect(result.terminationReason).toBe("artifact_failure");
    expect(result.artifactManifestPath).toBeUndefined();
  } finally { Math.random = originalRandom; await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});