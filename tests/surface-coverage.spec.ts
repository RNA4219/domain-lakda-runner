import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { readCatalog, digest, scope } from "../src/surface-coverage/catalog.js";
import { SurfaceObserver, type Measurement } from "../src/surface-coverage/observer.js";
import { readMeasurement, readSurfaceIndex, surfaceReport, type TestMeasurement } from "../src/surface-coverage/report.js";
import { renderSurfaces } from "../src/surface-coverage/html.js";
import { runLakda } from "../src/core/runner.js";
import { loadConfig } from "../src/core/config.js";
import { startFixture } from "./fixtures/server.js";

const exec = promisify(execFile);
const hash = (v: Uint8Array | string) => createHash("sha256").update(v).digest("hex");
function rawCatalog(origin = "http://127.0.0.1:19000") {
  return { schema: "lakda/surface-catalog/v1", product: "example", version: "a".repeat(40), environment: "fixture", revision: "inventory-1",
    screens: [{ id: "customer", name: "Customer", channel: "web", origin, path: "/users/{id}", frequency: 100 },
      { id: "mobile", name: "Mobile", channel: "mobile", origin, path: "/mobile", frequency: 1000 },
      { id: "private-screen", name: "Hidden screen sentinel", channel: "private", origin, path: "/private", frequency: 99999 }],
    apis: [{ id: "lookup", name: "Lookup", method: "GET", origin, path: "/api/users/{id}", frequency: 2000 },
      { id: "write", name: "Write", method: "POST", origin, path: "/api/write", frequency: 1500 },
      { id: "private-api", name: "Hidden API sentinel", method: "GET", origin, path: "/api/private", frequency: 99999 }],
    relations: [{ screen: "customer", api: "lookup" }, { screen: "customer", api: "write" }, { screen: "mobile", api: "lookup" }, { screen: "private-screen", api: "private-api" }],
    publication: { screens: ["customer", "mobile"], apis: ["lookup", "write"] } };
}
function recorded(catalog = readCatalog(rawCatalog()), observations: Measurement["observations"] = []): TestMeasurement {
  const publicScope = scope(catalog);
  return { measurement: { schema: "lakda/surface-observations/v1", product: catalog.product, version: catalog.version, environment: catalog.environment, revision: catalog.revision,
    runId: "lakda:run-test-1", attempt: 1, testId: "TC-1", testRevision: "r1", catalogDigest: digest(publicScope), scope: publicScope, complete: true, observations },
    evidence: { series: "suite", seriesAttempt: 2, runId: "lakda:run-test-1", attempt: 1, testId: "TC-1", testRevision: "r1", outcome: "failed", manifestSha256: "a".repeat(64), observationSha256: "b".repeat(64) } };
}

test("catalog validates references, rejects unsafe locations and projects owner policy", () => {
  const raw = rawCatalog();
  const catalog = readCatalog(raw);
  expect(catalog.screens).toHaveLength(2); expect(catalog.apis).toHaveLength(2); expect(catalog.relations).toHaveLength(3);
  for (const mutate of [(r: typeof raw) => { r.screens[0].path = "/users/alice?password=sentinel"; }, (r: typeof raw) => { r.apis[0].origin += "/bad"; },
    (r: typeof raw) => { r.apis[0].path = "/api/%61lice"; }, (r: typeof raw) => { r.relations[0].api = "absent"; },
    (r: typeof raw) => { r.publication.screens.push("absent"); }, (r: typeof raw) => { r.screens.push(r.screens[0]); }, (r: typeof raw) => { r.screens[0].frequency = Infinity; }]) {
    const copy = structuredClone(raw); mutate(copy); expect(() => readCatalog(copy)).toThrow("Invalid surface catalog or publication policy");
  }
  expect(() => readCatalog({ ...raw, publication: undefined })).toThrow();
  expect(() => readCatalog({ ...raw, credentials: "private sentinel" })).toThrow();
  const empty = readCatalog({ ...raw, publication: { screens: [], apis: [] } });
  expect(surfaceReport(empty).summary.screens.all.ratio).toBeNull();
});

test("legacy, incomplete, failed tests and publication changes preserve observation semantics", () => {
  const catalog = readCatalog(rawCatalog()), record = recorded(catalog, [{ kind: "apis", id: "lookup", lane: "mock" }]);
  const old = surfaceReport(catalog, [{ measurement: null, evidence: record.evidence }]);
  expect(old.apis.every(r => r.states.all === "unmeasured")).toBe(true);
  const report = surfaceReport(catalog, [record]);
  expect(report.apis[0].states).toEqual({ all: "observed", mock: "observed", real: "not_observed", unknown: "not_observed" });
  expect(report.apis[0].evidence[0].outcome).toBe("failed");
  expect(report.apis[1].states.all).toBe("not_observed");
  record.measurement!.complete = false;
  expect(surfaceReport(catalog, [record]).apis[1].states.all).toBe("unmeasured");
  const raw = rawCatalog(); raw.publication.apis = ["write"];
  const narrowed = surfaceReport(readCatalog(raw), [record]);
  expect(JSON.stringify(narrowed)).not.toContain('"lookup"');
  for (const forbidden of ["Hidden", "private-screen", "private-api", "99999"]) expect(JSON.stringify(narrowed)).not.toContain(forbidden);
  const expanded = rawCatalog(); expanded.publication.apis.push("private-api");
  expect(surfaceReport(readCatalog(expanded), [record]).apis[2].states.all).toBe("unmeasured");
  const changed = rawCatalog(); changed.apis[0].path = "/new/{id}";
  expect(surfaceReport(readCatalog(changed), [record]).apis[0].states.all).toBe("unmeasured");
  expect(() => readMeasurement({ ...record.measurement, rawUrl: "private-sentinel" })).toThrow();
});

test("browser observes real transport, fulfills and multiple screens without retaining values", async ({ browser }) => {
  const fixture = await startFixture(() => ({ body: "<h1>Ready</h1>" }));
  const context = await browser.newContext();
  try {
    const catalog = readCatalog(rawCatalog(fixture.baseUrl));
    const observer = new SurfaceObserver(context, { catalog, testId: "TC-1", testRevision: "r1", lane: "real" });
    const page = await context.newPage(); await observer.ready();
    await page.goto(fixture.baseUrl + "/users/ALICE-SENTINEL?auth=QUERY-SENTINEL");
    await page.evaluate(async () => { await fetch("/api/users/BOB-SENTINEL?token=QUERY-SENTINEL"); await fetch("/api/write", { method: "POST", body: "BODY-SENTINEL", headers: { Authorization: "Bearer HEADER-SENTINEL" } }); await fetch("/unknown/UNKNOWN-SENTINEL"); await fetch("/api/private"); });
    await context.route("**/api/users/*", route => route.fulfill({ body: "MOCK-BODY-SENTINEL" }));
    await page.goto(fixture.baseUrl + "/mobile");
    await page.evaluate(async () => { await fetch("/api/users/CAROL-SENTINEL"); });
    await context.close();
    const m = await observer.finish("lakda:run-test-1", 1, true);
    const json = JSON.stringify(m);
    for (const forbidden of ["SENTINEL", "private-api", "private-screen", "Authorization", "rawUrl", "headers", "body"]) expect(json).not.toContain(forbidden);
    expect(m.observations).toContainEqual({ kind: "apis", id: "lookup", lane: "real" });
    expect(m.observations).toContainEqual({ kind: "apis", id: "lookup", lane: "unknown" });
    expect(m.observations).toContainEqual({ kind: "relations", id: "customer:write", lane: "real" });
    expect(m.observations).toContainEqual({ kind: "relations", id: "mobile:lookup", lane: "unknown" });
    expect(m.observations).not.toContainEqual({ kind: "relations", id: "mobile:write", lane: "real" });
    expect(m.complete).toBe(true);
  } finally { await context.close(); await fixture.close(); }
});

test("real transport correlates response timing after independently delivered CDP provenance", async ({ browser }) => {
  const fixture = await startFixture(() => ({ body: "<h1>Ready</h1>" })), context = await browser.newContext();
  const createSession = context.newCDPSession.bind(context);
  context.newCDPSession = async page => {
    const session = await createSession(page);
    return new Proxy(session, { get(target, key) {
      if (key === "on") return (event: string, listener: (data: unknown) => void) => {
        target.on(event as "Network.responseReceived", data => {
          if (event === "Network.responseReceived") setTimeout(() => listener(data), 75);
          else if (event === "Network.requestWillBeSent") {
            // requestTime can precede requestWillBeSent.timestamp. Move the
            // event's monotonic/wall anchor together without changing transport.
            const eventData = data as unknown as { timestamp: number; wallTime: number };
            listener({ ...eventData, timestamp: eventData.timestamp + 0.02, wallTime: eventData.wallTime + 0.02 });
          }
          else listener(data);
        });
        return target;
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  try {
    const observer = new SurfaceObserver(context, { catalog: readCatalog(rawCatalog(fixture.baseUrl)), testId: "TC-1", testRevision: "r1", lane: "real" });
    const page = await context.newPage(); await observer.ready(); await page.goto(fixture.baseUrl + "/users/EXAMPLE");
    await page.evaluate(() => fetch("/api/users/EXAMPLE").then(r => r.text()));
    const measurement = await observer.finish("lakda:run-delayed-cdp", 1, true);
    expect(measurement.observations).toContainEqual({ kind: "apis", id: "lookup", lane: "real" });
  } finally { await context.close(); await fixture.close(); }
});

test("mock declaration and ambiguous templates never promote to real", async ({ browser }) => {
  const fixture = await startFixture(() => ({ body: "<h1>Ready</h1>" })), context = await browser.newContext();
  try {
    const raw = rawCatalog(fixture.baseUrl);
    raw.apis.push({ ...raw.apis[0], id: "private-overlap", path: "/api/users/static" });
    const observer = new SurfaceObserver(context, { catalog: readCatalog(raw), testId: "TC-1", testRevision: "r1", lane: "mock" });
    const page = await context.newPage(); await observer.ready(); await page.goto(fixture.baseUrl + "/mobile");
    await page.evaluate(async () => { await fetch("/api/users/static"); await fetch("/api/write", { method: "POST" }); });
    await context.close(); const m = await observer.finish("lakda:run-test-1", 1, true);
    expect(m.observations.some(o => o.lane === "real")).toBe(false);
    expect(m.observations.some(o => o.id === "lookup")).toBe(false);
    expect(m.observations).toContainEqual({ kind: "apis", id: "write", lane: "mock" });
  } finally { await context.close(); await fixture.close(); }
});

test("SPA transitions, iframe requests and incomplete observation keep conservative relations", async ({ browser }) => {
  const fixture = await startFixture(url => ({ body: url.pathname === "/frame" ? '<script>fetch("/api/users/frame")</script>' : '<h1>Ready</h1>' }));
  const context = await browser.newContext();
  try {
    const catalog = readCatalog(rawCatalog(fixture.baseUrl)), observer = new SurfaceObserver(context, { catalog, testId: "TC-1", testRevision: "r1", lane: "real" });
    const page = await context.newPage(); await observer.ready(); await page.goto(fixture.baseUrl + "/users/alice");
    await page.evaluate(async () => { const f = document.createElement("iframe"); f.src = "/frame"; document.body.append(f); await new Promise(yes => { f.onload = yes; }); });
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => { history.pushState({}, "", "/mobile"); await fetch("/api/users/mobile"); });
    await context.route("**/api/write", () => {});
    const request = context.waitForEvent("request", r => r.url().endsWith("/api/write"));
    await page.evaluate(() => { void fetch("/api/write", { method: "POST" }); }); await request;
    const m = await observer.finish("lakda:run-test-1", 1, false);
    expect(m.complete).toBe(false);
    expect(m.observations).toContainEqual({ kind: "relations", id: "mobile:lookup", lane: "real" });
    expect(m.observations).not.toContainEqual({ kind: "relations", id: "customer:lookup", lane: "real" });
    expect(m.observations).toContainEqual({ kind: "apis", id: "write", lane: "unknown" });
    expect(JSON.stringify(m)).not.toContain("alice");
  } finally { await context.close(); await fixture.close(); }
});

test("Service Worker fulfilled responses remain unknown in a real-declared lane", async ({ browser }) => {
  const fixture = await startFixture(url => url.pathname === "/sw.js" ? { contentType: "text/javascript", body: 'self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(new URL(e.request.url).pathname.startsWith("/api/"))e.respondWith(new Response("PRIVATE-SW-BODY"))});' } : { body: "<h1>Ready</h1>" });
  const context = await browser.newContext();
  try {
    const observer = new SurfaceObserver(context, { catalog: readCatalog(rawCatalog(fixture.baseUrl)), testId: "TC-1", testRevision: "r1", lane: "real" });
    const page = await context.newPage(); await observer.ready(); await page.goto(fixture.baseUrl + "/mobile");
    await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(yes => navigator.serviceWorker.addEventListener("controllerchange", yes, { once: true }));
      await fetch("/api/users/SW-VALUE"); });
    await context.close(); const m = await observer.finish("lakda:run-test-1", 1, true);
    expect(m.observations).toContainEqual({ kind: "apis", id: "lookup", lane: "unknown" });
    expect(m.observations).not.toContainEqual({ kind: "apis", id: "lookup", lane: "real" });
    expect(JSON.stringify(m)).not.toContain("SW-VALUE"); expect(JSON.stringify(m)).not.toContain("PRIVATE-SW-BODY");
  } finally { await context.close(); await fixture.close(); }
});

test("transparent Service Worker upstream is counted once per API and never assigned to a frame", async ({ browser }) => {
  let upstreamCalls = 0;
  const fixture = await startFixture(url => {
    if (url.pathname === "/sw.js") return { contentType: "text/javascript", body: 'self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(new URL(e.request.url).pathname.startsWith("/api/"))e.respondWith(fetch(e.request))});' };
    if (url.pathname.startsWith("/api/")) upstreamCalls++;
    return { body: "<h1>Ready</h1>" };
  });
  const context = await browser.newContext();
  try {
    const catalog = readCatalog(rawCatalog(fixture.baseUrl)), observer = new SurfaceObserver(context, { catalog, testId: "TC-1", testRevision: "r1", lane: "real" });
    const page = await context.newPage(); await observer.ready(); await page.goto(fixture.baseUrl + "/mobile");
    await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(yes => navigator.serviceWorker.addEventListener("controllerchange", yes, { once: true }));
      await fetch("/api/users/PRIVATE-UPSTREAM"); });
    await context.close(); const m = await observer.finish("lakda:run-test-1", 1, true);
    expect(upstreamCalls).toBe(1);
    expect(m.observations.filter(o => o.kind === "apis" && o.id === "lookup")).toHaveLength(1);
    expect(m.observations.filter(o => o.kind === "apis" && o.id === "lookup" && o.lane === "real")).toHaveLength(0);
    expect(m.observations).toContainEqual({ kind: "apis", id: "lookup", lane: "unknown" });
    expect(m.observations).toContainEqual({ kind: "relations", id: "mobile:lookup", lane: "unknown" });
    expect(m.observations).not.toContainEqual({ kind: "relations", id: "mobile:lookup", lane: "real" });
    const measurement = recorded(catalog); measurement.measurement = m;
    const report = surfaceReport(catalog, [measurement]);
    expect(report.summary.apis.all.observed).toBe(1); expect(report.summary.apis.real.observed).toBe(0);
    expect(report.summary.relations.real.observed).toBe(0);
    expect(JSON.stringify(report)).not.toContain("PRIVATE-UPSTREAM");
  } finally { await context.close(); await fixture.close(); }
});

test("warm HTTP cache with a remembered server address is never counted as real transport", async ({ browser }) => {
  let upstreamCalls = 0;
  const server = createServer((request, response) => { if (request.url?.startsWith("/api/")) upstreamCalls++;
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "max-age=3600" }); response.end("<h1>Ready</h1>"); });
  await new Promise<void>(yes => server.listen(0, "127.0.0.1", yes)); const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture unavailable");
  const origin = "http://127.0.0.1:" + address.port, context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(origin + "/mobile");
    await page.evaluate(async () => { await fetch("/api/users/cache"); });
    expect(upstreamCalls).toBe(1);
    const observer = new SurfaceObserver(context, { catalog: readCatalog(rawCatalog(origin)), testId: "TC-1", testRevision: "r1", lane: "real" });
    await observer.ready();
    await page.evaluate(async () => { await fetch("/api/users/cache"); await fetch("/api/users/cache"); });
    await context.close(); const m = await observer.finish("lakda:run-test-1", 1, true);
    expect(upstreamCalls).toBe(1);
    expect(m.observations.filter(o => o.kind === "apis" && o.id === "lookup")).toEqual([{ kind: "apis", id: "lookup", lane: "unknown" }]);
    expect(m.observations.some(o => o.lane === "real")).toBe(false);
  } finally { await context.close(); await new Promise<void>(yes => server.close(() => yes())); }
});

test("API document navigation is observed without inheriting the preceding screen relation", async ({ browser }) => {
  const fixture = await startFixture(() => ({ body: "<h1>Ready</h1>" })), context = await browser.newContext();
  try {
    const observer = new SurfaceObserver(context, { catalog: readCatalog(rawCatalog(fixture.baseUrl)), testId: "TC-1", testRevision: "r1", lane: "real" });
    const page = await context.newPage(); await observer.ready(); await page.goto(fixture.baseUrl + "/mobile");
    await page.goto(fixture.baseUrl + "/api/users/PRIVATE-DOCUMENT"); await context.close();
    const m = await observer.finish("lakda:run-test-1", 1, true);
    expect(m.observations).toContainEqual({ kind: "apis", id: "lookup", lane: "real" });
    expect(m.observations.some(o => o.kind === "relations")).toBe(false);
    expect(JSON.stringify(m)).not.toContain("PRIVATE-DOCUMENT");
  } finally { await context.close(); await fixture.close(); }
});

test("runner persists digest-bound observation, CLI accepts index and rejects wrong attempt evidence", async () => {
  const out = test.info().outputPath(); await mkdir(out, { recursive: true });
  const fixture = await startFixture(url => url.pathname.startsWith("/api/") ? { body: "ok" } : { body: '<main data-testid="ready">Loading</main><script>fetch("/api/users/PRIVATE-VALUE?token=PRIVATE-QUERY").then(()=>document.querySelector("main").textContent="Ready")</script>' });
  try {
    const raw = rawCatalog(fixture.baseUrl); raw.version = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
    const catalog = readCatalog(raw), plan = join(out, "actions.json"), configFile = join(out, "catalog.json");
    await writeFile(configFile, JSON.stringify(raw));
    const bytes = JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "regression-replay", baseUrl: fixture.baseUrl, seed: 4219,
      actions: [{ id: "open", kind: "navigate", path: "/users/alice" }] });
    await writeFile(plan, bytes);
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, mode: "regression-replay", reviewedE2E: true, outputDir: join(out, "runs"), obligations: [{ textEquals: { locator: { testId: "ready" }, text: "Ready" } }] });
    const result = await runLakda(config, plan, { surfaceCoverage: { catalog, testId: "TC-1", testRevision: "r1", lane: "real" } });
    expect(result.outcome).toBe("passed"); expect(result.artifactManifestPath).toBeTruthy();
    const runDir = dirname(result.actionSequencePath!), manifest = await readFile(result.artifactManifestPath!);
    const m = await readFile(join(runDir, "surface-observations.json"), "utf8");
    expect(m).not.toContain("PRIVATE-");
    const index = { schemaVersion: "lakda/e2e-case-index/v1", callerSha: raw.version, executionOrigin: "local", localRunId: "suite", localRunAttempt: 7,
      cases: [{ id: "TC-1", caseRevision: "r1", environment: "fixture", runId: result.runId, runRef: basename(runDir), attempt: 1,
        outcome: result.outcome, reason: result.terminationReason, actionSha256: hash(bytes), manifestSha256: "sha256:" + hash(manifest) }] };
    const tests = await readSurfaceIndex(catalog, index, join(out, "runs"));
    expect(surfaceReport(catalog, tests).apis[0].states.real).toBe("observed");
    expect(tests[0].evidence.seriesAttempt).toBe(7);
    const indexFile = join(out, "index.json"); await writeFile(indexFile, JSON.stringify(index));
    const command = [resolve("dist/cli.js"), "coverage", "surfaces", "--config", configFile, "--input", indexFile, "--runs-dir", join(out, "runs")];
    const output = JSON.parse((await exec(process.execPath, command)).stdout);
    expect(output.apis[0].states.real).toBe("observed"); expect(JSON.stringify(output)).not.toContain("private-api");
    const html = join(out, "report.html"); await exec(process.execPath, [...command, "--format", "html", "--out", html]);
    expect(await readFile(html, "utf8")).toContain("lakda/surface-report/v1");
    await expect(exec(process.execPath, [...command, "--format", "html", "--out", html])).rejects.toThrow();
    const runnerConfig = join(out, "runner.json");
    await writeFile(runnerConfig, JSON.stringify({ schemaVersion: "lakda/v1", reviewedE2E: true, obligations: [{ textEquals: { locator: { testId: "ready" }, text: "Ready" } }] }));
    const replayCommand = [resolve("dist/cli.js"), "replay", "--config", runnerConfig, "--input", plan, "--base-url", fixture.baseUrl,
      "--output-dir", join(out, "cli-runs"), "--surface-catalog", configFile, "--test-id", "TC-1", "--test-revision", "r1", "--surface-lane", "real"];
    const publicResult = JSON.parse((await exec(process.execPath, replayCommand)).stdout);
    expect(Object.keys(publicResult).sort()).toEqual(["attempt", "exitCode", "outcome", "runId"]);
    expect(publicResult.outcome).toBe("passed");
    await expect(exec(process.execPath, [...replayCommand, "--report", "html"])).rejects.toThrow("Surface coverage requires its scoped export");
    const wrong = structuredClone(index); wrong.cases[0].attempt = 2;
    await expect(readSurfaceIndex(catalog, wrong, join(out, "runs"))).rejects.toThrow("Cannot verify surface evidence");
    await writeFile(join(runDir, "surface-observations.json"), m + " ");
    await expect(readSurfaceIndex(catalog, index, join(out, "runs"))).rejects.toThrow("Cannot verify surface evidence");
  } finally { await fixture.close(); }
});

test("large catalog HTML supports mobile, pagination, priority, lane and bounded graph", async ({ page }) => {
  const raw = rawCatalog();
  for (let n = 0; n < 400; n++) raw.screens.push({ ...raw.screens[0], id: "screen-" + n, name: "Screen " + n, path: "/screen-" + n, frequency: n });
  for (let n = 0; n < 1000; n++) { raw.apis.push({ ...raw.apis[0], id: "api-" + n, name: "API " + n, path: "/api-" + n, frequency: n }); raw.relations.push({ screen: "customer", api: "api-" + n }); }
  raw.publication.screens = raw.screens.filter(s => s.id !== "private-screen").map(s => s.id); raw.publication.apis = raw.apis.filter(a => a.id !== "private-api").map(a => a.id);
  const report = surfaceReport(readCatalog(raw)); const html = renderSurfaces(report, "suite · 第2回");
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.goto("about:blank"); await page.setViewportSize(size); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.setContent(html); expect(errors).toEqual([]);
    await expect(page.locator("#rows tr")).toHaveCount(50);
    await expect(page.locator("#rows tr").first()).toContainText("Mobile");
    await page.locator("#query").fill("Customer"); await page.locator("#rows button").click();
    await expect(page.locator("#omitted")).toContainText("省略");
    expect(await page.locator("svg rect").count()).toBeLessThanOrEqual(40); expect(await page.locator("svg line").count()).toBeLessThanOrEqual(80);
    await page.locator("#query").fill(""); await page.locator("#kind").selectOption("apis");
    await page.locator("#channel").selectOption("mobile"); await expect(page.locator("#rows tr")).toHaveCount(1); await expect(page.locator("#rows")).toContainText("Lookup"); await page.locator("#channel").selectOption("");
    await expect(page.locator("#rows tr")).toHaveCount(50); await page.getByRole("button", { name: "次へ", exact: true }).click(); await expect(page.locator("#page")).toHaveText("2 / 21");
    await page.locator("#lane").selectOption("real"); await page.locator("#status").selectOption("observed");
    await expect(page.locator("#rows")).toContainText("該当する要素はありません");
    expect(await page.locator("body").innerText()).not.toContain("Hidden");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
