import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { loadConfig } from "../src/core/config.js";
import { assertHateManifest } from "../src/core/hate.js";
import { canonicalJson, createActionPlan, mulberry32, workerSeed } from "../src/core/plan.js";
import { runLakda } from "../src/core/runner.js";
import { startFixture } from "./fixtures/server.js";

test("same seed produces byte-identical deterministic plan", () => {
  const config = loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", mode: "seeded-random", seed: 4219, candidates: [
    { id: "b", kind: "navigate", path: "/b" }, { id: "a", kind: "navigate", path: "/a" }, { id: "c", kind: "navigate", path: "/c" },
  ] });
  expect(JSON.stringify(createActionPlan(config))).toBe(JSON.stringify(createActionPlan(config)));
});

test("deny action is rejected before browser execution", () => {
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", candidates: [{ id: "delete-account", kind: "click", selector: "#delete", accessibleName: "Delete account" }] })).not.toThrow();
  const config = loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", candidates: [{ id: "delete-account", kind: "click", selector: "#delete", accessibleName: "Delete account" }] });
  expect(() => createActionPlan(config)).toThrow(/deny policy/);
  const idOnly = loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", candidates: [{ id: "destroy-all", kind: "click", locator: { testId: "safe-button" } }] });
  expect(() => createActionPlan(idOnly)).toThrow(/deny policy/);
});

test("run saves required artifacts and a schema-valid HATE manifest", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-pass-"));
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "smoke" });
    const result = await runLakda(config);
    expect(result.outcome, JSON.stringify(result)).toBe("passed"); expect(result.exitCode).toBe(0); expect(result.artifactManifestPath).toBeTruthy();
    const manifest = JSON.parse(await readFile(result.artifactManifestPath!, "utf8")); assertHateManifest(manifest);
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    await expect(readFile(join(runDir, "run-metadata.json"), "utf8")).resolves.toContain('"outcome": "passed"');
    expect(JSON.parse(await readFile(join(runDir, "action-sequence.json"), "utf8")).schemaVersion).toBe("lakda/action-plan/v1");
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("5xx becomes failed with trace and screenshot", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-fail-"));
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }] });
    const result = await runLakda(config);
    expect(result.outcome, JSON.stringify(result)).toBe("failed"); expect(result.exitCode).toBe(2); expect(result.failures.some(failure => failure.ruleId === "UI-004")).toBeTruthy();
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    await expect(readFile(join(runDir, "artifacts", "trace.zip"))).resolves.toBeTruthy();
    await expect(readFile(join(runDir, "artifacts", "failure.png"))).resolves.toBeTruthy();
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("artifact size limit preserves valid evidence as partial", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-size-"));
  try {
    const result = await runLakda(loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, candidates: [{ id: "failure", kind: "navigate", path: "/failure" }], artifacts: { maxRunBytes: 1 },
    }));
    expect(result.outcome, JSON.stringify(result)).toBe("partial"); expect(result.exitCode).toBe(2);
    const runDir = join(outputDir, result.runId.replace(/[^A-Za-z0-9._-]/g, "-"));
    await expect(readFile(join(runDir, "artifacts", "trace.zip"))).resolves.toBeTruthy();
    await expect(readFile(join(runDir, "artifacts", "failure.png"))).resolves.toBeTruthy();
    assertHateManifest(JSON.parse(await readFile(result.artifactManifestPath!, "utf8")));
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});
test("saved action sequence is replayed with regression-replay", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-replay-"));
  try {
    const initial = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "seeded-random", candidates: [{ id: "root", kind: "navigate", path: "/" }] }));
    const replay = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay" }), initial.actionSequencePath);
    expect(initial.outcome).toBe("passed"); expect(replay.outcome, JSON.stringify(replay)).toBe("passed"); expect(replay.exitCode).toBe(0);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("declared action catalog resolves locators, profiles, and fixture reset", async () => {
  let resetCalls = 0;
  const fixture = await startFixture((url, method) => {
    if (url.pathname === "/reset") { if (method === "POST") resetCalls += 1; return { body: "reset", contentType: "text/plain" }; }
    return { body: '<html><body><input data-testid="query"><input data-testid="agree" type="checkbox"><select data-testid="choice"><option value="one">one</option><option value="two">two</option></select><button data-testid="submit">Submit</button></body></html>', contentType: "text/html" };
  });
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-actions-"));
  try {
    const actions = [
      { id: "goto-root", kind: "goto" as const, path: "/" },
      { id: "fill-query", kind: "fill" as const, locator: { testId: "query" }, inputProfileId: "query" },
      { id: "check-agree", kind: "check" as const, locator: { testId: "agree" } },
      { id: "select-choice", kind: "select" as const, locator: { testId: "choice" }, inputProfileId: "choice" },
      { id: "submit", kind: "click" as const, locator: { testId: "submit" }, mutates: true },
    ];
    const planPath = join(outputDir, "declared-sequence.json");
    await writeFile(planPath, JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", seed: 4219, baseUrl: fixture.baseUrl, actions }));
    const result = await runLakda(loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, mode: "regression-replay", inputProfiles: { query: "safe input", choice: "two" }, fixtureReset: { url: "/reset" }, actionCatalog: actions,
    }), planPath);
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
    expect(resetCalls).toBe(2);
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("unexpected logout is classified mechanically", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-auth-"));
  try {
    const result = await runLakda(loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir, persona: "member",
      personas: { member: { validationPath: "/login", loginUrlPattern: "/login", requiredLocator: { testId: "missing-auth" } } },
      actionCatalog: [{ id: "login-redirect", kind: "navigate", path: "/login" }],
    }));
    expect(result.outcome).toBe("failed");
    expect(result.failures.some(failure => failure.ruleId === "UI-007")).toBeTruthy();
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});
test("execution profiles and classifier suppression are declarative", async () => {
  const profileConfig = loadConfig(undefined, {
    baseUrl: "http://127.0.0.1:3000", mode: "smoke",
    actionCatalog: [{ id: "first", kind: "navigate", path: "/first" }, { id: "second", kind: "navigate", path: "/second" }],
    profiles: { smoke: { actionIds: ["second", "first"] }, seededRandom: { candidateIds: ["first"], count: 1 } },
  });
  expect(createActionPlan(profileConfig).actions.map(action => action.id)).toEqual(["second", "first"]);
  expect(createActionPlan(profileConfig, "seeded-random").actions.map(action => action.id)).toEqual(["first"]);
  const fixture = await startFixture(() => ({ body: "<script>console.error('known fixture noise')</script><h1>ok</h1>" }));
  const outputDir = await mkdtemp(join(tmpdir(), "lakda-classifier-"));
  try {
    const result = await runLakda(loadConfig(undefined, {
      baseUrl: fixture.baseUrl, outputDir,
      classifier: { consoleErrorAllowPatterns: ["known fixture noise"], majorRequestUrlPatterns: ["/critical/"] },
    }));
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});

test("fixture reset rejects a non-loopback endpoint", () => {
  expect(() => loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", fixtureReset: { url: "http://example.com/reset" } })).toThrow(/loopback/);
});
test("config file is validated against the v1 schema before merge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-schema-"));
  const configPath = join(directory, "lakda.config.json");
  try {
    await writeFile(configPath, JSON.stringify({ schemaVersion: "lakda/v1", unexpected: true }));
    expect(() => loadConfig(configPath)).toThrow(/設定schema/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("mulberry32 vector, worker seed, and canonical JSON are stable", () => {
  const random = mulberry32(4219);
  expect([random(), random(), random()]).toEqual([0.2032677789684385, 0.834809469524771, 0.02527741529047489]);
  expect(workerSeed(4219, 3)).toBe(4222);
  expect(canonicalJson({ b: 1, a: { z: 2, y: [3, 1] } })).toBe('{"a":{"y":[3,1],"z":2},"b":1}');
});

test("auth state is stored below ignored .lakda/auth", async () => {
  const { authStatePath } = await import("../src/core/runner.js");
  expect(authStatePath("member").replace(/\\/g, "/")).toContain("/.lakda/auth/member.json");
});