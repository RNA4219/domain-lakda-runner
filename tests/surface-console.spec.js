import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout, clearTimeout } from "node:timers";
import { URLSearchParams } from "node:url";
import { test, expect } from "@playwright/test";
import { surfacePage } from "../scripts/local-console/surfaces.mjs";
import { publicCatalog, publicJob } from "../scripts/local-console/surface-console.mjs";
import { recordingTools, checkReplayTools } from "../scripts/local-console/setup.mjs";

const exec = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
async function port() { const server = createServer(); await new Promise(yes => server.listen(0, "127.0.0.1", yes)); const n = server.address().port; await new Promise(yes => server.close(yes)); return n; }
const save = (file, value) => writeFile(file, JSON.stringify(value));

test("console binds the selected attempt and denies malformed, old and mismatched evidence", async () => {
  const dir = test.info().outputPath(); await mkdir(dir, { recursive: true });
  const raw = { schema: "lakda/surface-catalog/v1", product: "example", version: "a".repeat(40), environment: "local", revision: "r1",
    screens: [], apis: [], relations: [], publication: { screens: [], apis: [] } };
  await save(join(dir, "catalog.json"), raw);
  const suites = [{ id: "suite", name: "Suite", surfaceCatalog: "catalog.json" }, { id: "none", name: "None" }];
  const product = { productId: "example", revision: raw.version, environment: "local" };
  const context = { number: 3, state: "running", hasJob: true, directory: dir };
  const app = { catalog: () => ({ product, suites }), coverageContext: (_id, n) => n === 99 ? null : context };
  const page = q => surfacePage({ suites }, dir, app, new URLSearchParams(q));
  expect((await page("suite=suite")).html).toContain("第3回");
  expect((await page("suite=none")).status).toBe(200);
  for (const q of ["suite=absent", "suite=suite&attempt=99", "suite=suite&attempt=abc", "suite=suite&attempt=9007199254740999"]) expect((await page(q)).status).toBe(404);
  context.index = { schemaVersion: "lakda/e2e-case-index/v1", callerSha: raw.version, executionOrigin: "local", localRunId: "suite", localRunAttempt: 2, cases: [] };
  expect((await page("suite=suite")).status).toBe(422);
  context.index.localRunAttempt = 3;
  expect((await page("suite=suite")).status).toBe(200);
  await save(join(dir, "catalog.json"), { ...raw, product: "hidden sentinel" });
  const invalid = await page("suite=suite"); expect(invalid.status).toBe(422); expect(invalid.html).not.toContain("hidden sentinel");
  const safe = publicCatalog({ product, suites: [{ id: "suite", name: "Suite", next: 3, cases: [{ title: "private sentinel" }], latest: { number: 2, state: "complete", message: "private sentinel", cases: ["private sentinel"], totals: { count: 17 } } }] });
  expect(JSON.stringify(safe)).not.toContain("private sentinel"); expect(JSON.stringify(safe)).not.toContain("17");
  expect(publicJob({ number: 1, state: "complete", cases: ["private"] })).toEqual({ number: 1, state: "complete" });
});

test("npm platform entry executes the same-attempt safe surface view and blocks broad evidence routes", async ({ page, request }) => {
  test.setTimeout(90_000);
  let tools;
  try { tools = await recordingTools({}); await checkReplayTools(tools); }
  catch { test.skip(true, "Optional FFmpeg/H.264 recording tools unavailable"); return; }
  const out = test.info().outputPath(), root = resolve("."), sample = resolve("examples/e2e-platform");
  await mkdir(out, { recursive: true });
  const revision = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
  const targetPort = await port(), uiPort = await port(), baseUrl = "http://127.0.0.1:" + targetPort + "/", origin = "http://127.0.0.1:" + uiPort;
  await cp(join(sample, "exports"), join(out, "exports"), { recursive: true });
  const scenario = join(out, "exports", "TC-SHIPPING"), actions = await json(join(scenario, "action-sequence.json")); actions.baseUrl = baseUrl;
  await save(join(scenario, "action-sequence.json"), actions);
  const manifest = await json(join(scenario, "manifest.json")); manifest.filesSha256["action-sequence.json"] = hash(await readFile(join(scenario, "action-sequence.json"))); await save(join(scenario, "manifest.json"), manifest);
  const site = join(out, "site"); await mkdir(site); const bytes = await readFile(join(sample, "site", "index.html")); await writeFile(join(site, "index.html"), bytes); const fileSha = hash(bytes);
  await save(join(out, "observation.json"), { productId: "shipping-demo", revision, environment: "local-fixture", files: { "index.html": { servedSha256: fileSha, diskSha256: fileSha } } });
  await save(join(out, "binding.json"), { bindingVersion: "qeg-build/v1", target: { projectId: "shipping-demo", revision, environmentId: "local-fixture", buildId: "sha256:" + hash("index.html " + fileSha + "\n") } });
  const catalog = { schema: "lakda/surface-catalog/v1", product: "shipping-demo", version: revision, environment: "local-fixture", revision: "catalog-1",
    screens: [{ id: "faq", name: "FAQ", channel: "web", origin: baseUrl.slice(0, -1), path: "/", frequency: 100 }, { id: "private", name: "PRIVATE-SCREEN-SENTINEL", channel: "private", origin: baseUrl.slice(0, -1), path: "/private", frequency: 99999 }],
    apis: [{ id: "api", name: "Unused API", method: "GET", origin: baseUrl.slice(0, -1), path: "/api", frequency: 1000 }], relations: [{ screen: "faq", api: "api" }], publication: { screens: ["faq"], apis: ["api"] } };
  await save(join(out, "catalog.json"), catalog);
  const cfg = { productName: "Synthetic fixture", baseUrl, store: join(out, "history"), ...tools,
    target: { directory: site, observation: join(out, "observation.json"), binding: join(out, "binding.json") }, suites: [{ id: "shipping", name: "Fixture suite", checkout: root,
      scenarios: relative(root, join(out, "exports")), featureSpec: join(sample, "feature.json"), manualCaseSet: join(sample, "cases.json"), surfaceCatalog: join(out, "catalog.json"), surfaceLane: "mock" }] };
  const cfgFile = join(out, "console.json"); await save(cfgFile, cfg);
  const child = spawn(process.execPath, [resolve("scripts/e2e-local-console.mjs"), "--config", cfgFile, "--port", String(uiPort)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stderr.on("data", b => { logs += b; });
  try {
    await new Promise((yes, no) => { const timer = setTimeout(() => no(Error("Console start timeout: " + logs)), 20_000); child.stdout.on("data", b => { if (String(b).includes(origin)) { clearTimeout(timer); yes(); } }); child.once("exit", () => { clearTimeout(timer); no(Error("Console exited: " + logs)); }); });
    await page.goto(origin + "/"); await expect(page.getByRole("heading", { name: "画面・API のテスト実行" })).toBeVisible();
    for (const path of ["/coverage", "/architecture", "/v/view-private/index.html", "/v/view-private/local-case-1.html"]) expect((await request.get(origin + path)).status()).toBe(404);
    await page.getByRole("link", { name: "画面・API の到達状況", exact: true }).click();
    await expect(page.locator("#rows")).toContainText("未計測"); expect(await page.content()).not.toContain("PRIVATE-SCREEN-SENTINEL");
    await page.getByRole("link", { name: "テストの概要に戻る" }).click();
    await page.getByRole("button", { name: "第1回を実行", exact: true }).click();
    await expect.poll(async () => (await (await request.get(origin + "/api/runs/shipping/1")).json())?.state, { timeout: 45_000 }).toBe("complete");
    await page.goto(origin + "/surfaces?suite=shipping&attempt=1");
    await expect(page.locator("#rows")).toContainText("到達"); await page.locator("#rows button").click();
    await expect(page.locator("#evidence")).toContainText("TC-SHIPPING"); await expect(page.locator("#evidence")).toContainText("shipping / 1");
    const report = await (await request.get(origin + "/api/surfaces?suite=shipping&attempt=1")).json();
    expect(report.screens[0].states.mock).toBe("observed"); expect(report.screens[0].states.real).toBe("not_observed");
    expect(report.apis[0].states.all).toBe("not_observed"); expect(JSON.stringify(report)).not.toContain("PRIVATE-SCREEN-SENTINEL");
    expect((await request.get(origin + "/api/surfaces?suite=shipping&attempt=2")).status()).toBe(404);
    // Owner narrows publication while the server is running; no cached earlier data may escape.
    catalog.publication.screens = []; await save(join(out, "catalog.json"), catalog);
    const narrowed = await (await request.get(origin + "/api/surfaces?suite=shipping&attempt=1")).json(); expect(narrowed.screens).toEqual([]); expect(narrowed.relations).toEqual([]);
    expect(JSON.stringify(narrowed)).not.toContain("TC-SHIPPING");
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(origin + "/surfaces?suite=shipping&attempt=1"); await page.screenshot({ path: join(out, "surface-mobile.png"), fullPage: true });
  } finally { child.kill(); await new Promise(yes => { if (child.exitCode !== null) yes(); else child.once("exit", yes); }); }
});
