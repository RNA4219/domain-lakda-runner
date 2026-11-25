import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { dirname, basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readCatalog, matching } from "../src/surface-coverage/catalog.js";
import { readMeasurement, readSurfaceIndex, surfaceReport } from "../src/surface-coverage/report.js";
import { startSurfaceCoverage, surfaceRunIndex } from "../src/index.js";
import { runLakda } from "../src/core/runner.js";
import { loadConfig } from "../src/core/config.js";
import { findSensitive, redact } from "../src/core/redaction.js";
import { startFixture } from "./fixtures/server.js";

const exec = promisify(execFile), hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const save = (file: string, value: unknown) => writeFile(file, JSON.stringify(value));
function catalog(origin: string) {
  return { schema: "lakda/surface-catalog/v1", product: "synthetic-product", version: "b".repeat(40), environment: "local-synthetic", revision: "field-1",
    screens: ["reset-password", "api-key", "cookie", "000-000-0000"].map((id, n) => ({ id, name: id, channel: "web", origin, path: "/page-" + n, frequency: 1, ready: { testId: "ready", timeoutMs: 3000 } })),
    apis: [{ id: "lookup", name: "Lookup", method: "GET", origin, path: "/api/lookup/{id}", frequency: 1 }],
    relations: ["reset-password", "api-key", "cookie", "000-000-0000"].map(screen => ({ screen, api: "lookup" })), publication: { screens: ["reset-password", "api-key", "cookie", "000-000-0000"], apis: ["lookup"] } };
}
async function replay(out: string, raw: ReturnType<typeof catalog>, paths: string[]) {
  const bytes = JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", baseUrl: raw.screens[0].origin, seed: 4219,
    actions: paths.map((path, n) => ({ id: "open-" + n, kind: "navigate", path })) });
  const plan = join(out, "actions.json"); await save(join(out, "catalog.json"), raw); await writeFile(plan, bytes);
  const config = loadConfig(undefined, { baseUrl: raw.screens[0].origin, mode: "regression-replay", reviewedE2E: true, outputDir: join(out, "runs"),
    obligations: [{ visible: { testId: "initial" } }] });
  const result = await runLakda(config, plan, { surfaceCoverage: { catalog: readCatalog(raw), testId: "TC-FIELD", testRevision: "case-1", lane: "real" } });
  const directory = dirname(result.actionSequencePath!), manifest = await readFile(result.artifactManifestPath!);
  const index = { schemaVersion: "lakda/e2e-case-index/v1", callerSha: raw.version, executionOrigin: "local", localRunId: "field", localRunAttempt: 1,
    cases: [{ id: "TC-FIELD", caseRevision: "case-1", environment: raw.environment, runId: result.runId, runRef: basename(directory), attempt: result.attempt,
      outcome: result.outcome, reason: result.terminationReason, actionSha256: hash(bytes), manifestSha256: "sha256:" + hash(manifest) }] };
  return { result, directory, index };
}

test("saved identifiers survive redaction and delayed APIs bind the target rather than the producer checkout", async () => {
  const fixture = await startFixture(url => ({ body: url.pathname.startsWith("/api/") ? "ok" : '<h1 data-testid="initial">Open</h1><script>setTimeout(()=>fetch("/api/lookup/SYNTHETIC-PATH?token=SYNTHETIC-QUERY").then(()=>{const e=document.createElement("p");e.dataset.testid="ready";e.textContent="Ready";document.body.append(e)}),180)</script>' }));
  try {
    const out = test.info().outputPath(); await mkdir(out, { recursive: true }); const raw = catalog(fixture.baseUrl);
    const run = await replay(out, raw, ["/page-0", "/page-1", "/page-2", "/page-3"]);
    expect(run.result.outcome).toBe("passed");
    const bytes = await readFile(join(run.directory, "surface-observations.json"), "utf8"), measurement = readMeasurement(JSON.parse(bytes));
    expect(measurement.complete).toBe(true);
    for (const screen of raw.screens) expect(measurement.observations).toContainEqual({ kind: "relations", id: screen.id + ":lookup", lane: "real" });
    expect(findSensitive(bytes)).toEqual([]); expect(bytes).not.toContain("SYNTHETIC-");
    expect(redact("password=SYNTHETIC-SECRET")).toBe("password=[REDACTED]");
    const metadata = JSON.parse(await readFile(join(run.directory, "run-metadata.json"), "utf8"));
    expect(metadata.commitSha).not.toBe(raw.version); expect(metadata.surfaceCoverage.target.version).toBe(raw.version);
    const tests = await readSurfaceIndex(readCatalog(raw), run.index, join(out, "runs"));
    expect(surfaceReport(readCatalog(raw), tests).relations.every(row => row.states.real === "observed")).toBe(true);
    await save(join(out, "index.json"), run.index);
    const output = await exec(process.execPath, [resolve("dist/cli.js"), "coverage", "surfaces", "--config", join(out, "catalog.json"), "--input", join(out, "index.json"), "--runs-dir", join(out, "runs")]);
    expect(JSON.parse(output.stdout).relations).toHaveLength(4);
    const wrong = structuredClone(raw); wrong.version = "c".repeat(40); const wrongIndex = { ...run.index, callerSha: wrong.version };
    await expect(readSurfaceIndex(readCatalog(wrong), wrongIndex, join(out, "runs"))).rejects.toThrow("Cannot verify surface evidence");
    raw.publication.screens = []; const narrowed = surfaceReport(readCatalog(raw), tests);
    expect(narrowed.screens).toEqual([]); expect(narrowed.relations).toEqual([]); expect(JSON.stringify(narrowed)).not.toContain("reset-password");
  } finally { await fixture.close(); }
});

test("unmet readiness never declares an absent delayed API not_observed", async () => {
  const fixture = await startFixture(() => ({ body: '<h1 data-testid="initial">Open</h1>' }));
  try {
    const out = test.info().outputPath(); await mkdir(out, { recursive: true }); const raw = catalog(fixture.baseUrl);
    raw.screens.forEach(screen => { screen.ready.timeoutMs = 75; });
    const run = await replay(out, raw, ["/page-0"]), saved = JSON.parse(await readFile(join(run.directory, "surface-observations.json"), "utf8"));
    expect(run.result.outcome).toBe("passed"); expect(saved.complete).toBe(false);
    const report = surfaceReport(readCatalog(raw), await readSurfaceIndex(readCatalog(raw), run.index, join(out, "runs")));
    expect(report.apis[0].states.all).toBe("unmeasured");
  } finally { await fixture.close(); }
});

test("existing Playwright context records hash routes and same-URL DOM states without owning actions or browser", async ({ browser }) => {
  const fixture = await startFixture(() => ({ body: '<main><div data-testid="state-a">A</div></main>' })), context = await browser.newContext();
  try {
    const out = test.info().outputPath(); await mkdir(out, { recursive: true }); const origin = fixture.baseUrl;
    const screens = [
      { id: "hash-detail", name: "Detail", channel: "web", origin, path: "/app", hashRoute: "/home/detail/{id}", frequency: 1 },
      { id: "hash-list", name: "List", channel: "web", origin, path: "/app", hashRoute: "/home/list", frequency: 1 },
      ...["state-a", "state-b"].map(id => ({ id, name: id, channel: "web", origin, path: "/same", state: { testId: id }, frequency: 1 })),
      { id: "private", name: "PRIVATE-STATE", channel: "web", origin, path: "/private", hashRoute: "/hidden/{id}", frequency: 9 }];
    const raw = { ...catalog(origin), screens, relations: [{ screen: "hash-detail", api: "lookup" }, { screen: "state-a", api: "lookup" }], publication: { screens: ["hash-detail", "hash-list", "state-a", "state-b"], apis: ["lookup"] } };
    await save(join(out, "catalog.json"), raw);
    const session = await startSurfaceCoverage(context, { catalogPath: join(out, "catalog.json"), outputDir: join(out, "runs"), testId: "TC-EXTERNAL", testRevision: "case-1", lane: "real" });
    const page = await context.newPage(); await page.goto(origin + "/app#/home/detail/SYNTHETIC-HASH?token=SYNTHETIC-QUERY");
    await page.evaluate(() => fetch("/api/lookup/SYNTHETIC-PATH").then(r => r.text())); await session.checkpoint();
    await page.evaluate(() => { location.hash = "/home/list"; }); await session.checkpoint();
    await page.goto(origin + "/same"); await expect(page.getByTestId("state-a")).toBeVisible();
    await page.evaluate(() => { document.querySelector("main")!.innerHTML = '<div data-testid="state-b">B</div>'; }); await expect(page.getByTestId("state-b")).toBeVisible();
    await page.evaluate(() => fetch("/api/lookup/SYNTHETIC-DOM").then(r => r.text()));
    const record = await session.finish("passed"); expect(page.isClosed()).toBe(false); expect(await page.locator("main").textContent()).toBe("B");
    const saved = await readFile(record.measurementPath, "utf8"); expect(saved).not.toContain("SYNTHETIC-"); expect(saved).not.toContain("PRIVATE-STATE");
    const index = surfaceRunIndex([record]), tests = await readSurfaceIndex(readCatalog(raw), index, join(out, "runs")), report = surfaceReport(readCatalog(raw), tests);
    expect(report.screens.every(row => row.states.all === "observed")).toBe(true);
    expect(report.relations.find(row => row.id === "hash-detail:lookup")!.states.real).toBe("observed");
    expect(report.relations.find(row => row.id === "state-a:lookup")!.states.all).toBe("not_observed");
    expect(await readdir(record.runDirectory)).not.toContain("action-sequence.json");
    await save(join(out, "index.json"), index);
    const output = await exec(process.execPath, [resolve("dist/cli.js"), "coverage", "surfaces", "--config", join(out, "catalog.json"), "--input", join(out, "index.json"), "--runs-dir", join(out, "runs"), "--format", "html"]);
    expect(output.stdout).toContain("hash-detail"); expect(output.stdout).not.toContain("SYNTHETIC-");
    await expect(session.finish("passed")).rejects.toThrow();
  } finally { await context.close(); await fixture.close(); }
});

test("external mock execution preserves fail outcome and never promotes fulfill to real", async ({ browser }) => {
  const fixture = await startFixture(() => ({ body: "<h1>Open</h1>" })), context = await browser.newContext();
  try {
    const out = test.info().outputPath(); await mkdir(out, { recursive: true }); const raw = catalog(fixture.baseUrl);
    raw.screens.forEach(screen => { delete (screen as { ready?: unknown }).ready; }); await save(join(out, "catalog.json"), raw);
    await context.route("**/api/lookup/*", route => route.fulfill({ body: "synthetic mock" }));
    const session = await startSurfaceCoverage(context, { catalogPath: join(out, "catalog.json"), outputDir: join(out, "runs"), testId: "TC-MOCK", testRevision: "case-1", lane: "mock" });
    const page = await context.newPage(); await page.goto(fixture.baseUrl + "/page-0"); await page.evaluate(() => fetch("/api/lookup/mock").then(r => r.text()));
    const record = await session.finish("failed"), index = surfaceRunIndex([record]);
    const report = surfaceReport(readCatalog(raw), await readSurfaceIndex(readCatalog(raw), index, join(out, "runs")));
    expect(report.apis[0].states.mock).toBe("observed"); expect(report.apis[0].states.real).toBe("not_observed"); expect(report.apis[0].evidence[0].outcome).toBe("failed");
    const wrong = structuredClone(index); wrong.cases[0].manifestSha256 = "sha256:" + "f".repeat(64);
    await expect(readSurfaceIndex(readCatalog(raw), wrong, join(out, "runs"))).rejects.toThrow("Cannot verify surface evidence");
  } finally { await context.close(); await fixture.close(); }
});

test("private overlapping hash and DOM definitions fail closed without widening publication", () => {
  const raw = catalog("http://127.0.0.1:19000");
  const screen = { ...raw.screens[0], path: "/app", hashRoute: "/home/{id}", state: { testId: "visible" } };
  const hidden = { ...screen, id: "private", state: { testId: "PRIVATE-STATE" } };
  const value = { ...raw, screens: [screen, hidden], relations: [], publication: { screens: [screen.id], apis: ["lookup"] } };
  const projected = readCatalog(value); expect(matching(projected.screens, screen.origin + "/app#/home/value")).toEqual([]);
  expect(JSON.stringify(projected)).not.toContain("PRIVATE-STATE");
  expect(() => readCatalog({ ...value, screens: [{ ...screen, hashRoute: "/home?secret=value" }] })).toThrow();
  const publicHash = readCatalog({ ...value, screens: [{ ...screen, state: undefined, hashRoute: "/home/detail/{id}" }] });
  expect(matching(publicHash.screens, screen.origin + "/app#/home/detail/example")).toHaveLength(1);
  expect(matching(publicHash.screens, screen.origin + "/app#//other/home/detail/example")).toEqual([]);
});
