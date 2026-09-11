import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { runCli } from "../src/cli.js";
import { startFixture } from "./fixtures/server.js";
import { loadReportSourceCollection } from "../src/reporting/source-collection.js";
import { resolveReportSources } from "../src/reporting/source-index.js";

async function invoke(args: string[]) {
  const stdout: string[] = []; const stderr: string[] = [];
  const original = { log: console.log, error: console.error };
  console.log = (...values: unknown[]) => { stdout.push(values.map(String).join(" ")); };
  console.error = (...values: unknown[]) => { stderr.push(values.map(String).join(" ")); };
  try { return { code: await runCli(args), stdout, stderr }; }
  finally { console.log = original.log; console.error = original.error; }
}

async function input(root: string, baseUrl: string) {
  const charter = {
    schemaVersion: "lakda/exploration-charter/v1", charterId: "report-auto", targetRevision: "fixture-v1", platform: "pc-web", executionMode: "fixture", adapter: { id: "playwright" }, baseUrl, persona: "guest", scope: { allowHosts: ["127.0.0.1"] },
    budget: { durationMs: 10_000, maxActions: 2, maxActionsPerMinute: 10 }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] }, generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" },
    capture: { video: "off", screenshot: "finding-non-pass-bookmark", sampledFrames: { enabled: false, intervalMs: 1000, maxFrames: 2, maxBytes: 1000, source: "playwright", stopTimeoutMs: 1000 } }, templateCorpusVersion: "none", seed: 7, outputDir: join(root, "runs"),
  };
  const path = join(root, "charter.json"); await writeFile(path, JSON.stringify(charter)); return path;
}

test("explore completion generates one report by default while retaining its original stdout and exit", async () => {
  const fixture = await startFixture(() => ({ body: "<main><h1>Report fixture</h1></main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-report-auto-"));
  try {
    const charter = await input(root, fixture.baseUrl); const reports = join(root, "reports");
    const result = await invoke(["explore", "run", "--charter", charter, "--report-dir", reports, "--report-language", "en"]);
    expect(result.code, result.stderr.join("\n")).toBe(0); expect(result.stdout).toHaveLength(1);
    const execution = JSON.parse(result.stdout[0]);
    expect(execution).toMatchObject({ outcome: "passed", exitCode: 0, report: { status: "completed" } });
    expect(execution).not.toHaveProperty("generationStatus");
    const notification = result.stderr.map(line => { try { return JSON.parse(line); } catch { return null; } }).find(value => value?.report?.schemaVersion === "lakda/report-receipt/v1");
    expect(notification).toBeTruthy(); expect(notification.report.generationStatus).toBe("ready");
    expect(JSON.parse(await readFile(notification.receiptPath, "utf8"))).toEqual(notification.report);
    const view = JSON.parse(await readFile(join(notification.directory, "report-data.json"), "utf8"));
    expect(view.counts).toMatchObject({ sources: 1, runs: 1 });
    expect(view.language).toBe("en");
    expect(await readFile(join(notification.directory, "index.html"), "utf8")).toContain('<html lang="en">');
    expect(view.sessions[0]).toMatchObject({ sessionId: execution.sessionId, status: "completed", technicalOutcome: "passed", acceptanceStatus: "fixture_only" });
    expect((await readdir(reports)).filter(name => name.endsWith(".receipt.json"))).toHaveLength(1);
    const verification = await invoke(["report", "verify", "--report-dir", notification.directory]);
    expect(verification.code).toBe(0);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("report preflight errors do not start exploration, and off suppresses all generation", async () => {
  let requests = 0;
  const fixture = await startFixture(() => { requests++; return { body: "<main>No controls</main>" }; });
  const root = await mkdtemp(join(tmpdir(), "lakda-report-auto-"));
  try {
    const charter = await input(root, fixture.baseUrl); const reports = join(root, "reports");
    const rejected = await invoke(["explore", "run", "--charter", charter, "--report-config", join(root, "missing.json")]);
    expect(rejected.code).toBe(2); expect(requests).toBe(0); expect(rejected.stdout).toEqual([]);
    expect((await readdir(root)).includes("explorations")).toBe(false);
    const disabled = await invoke(["explore", "run", "--charter", charter, "--report", "off", "--report-dir", reports]);
    expect(disabled.code).toBe(0); expect(disabled.stdout).toHaveLength(1);
    expect((await readdir(root)).includes("reports")).toBe(false); expect(disabled.stderr).toEqual([]);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("a report output failure preserves the successful exploration result", async () => {
  const fixture = await startFixture(() => ({ body: "<main>No controls</main>" }));
  const root = await mkdtemp(join(tmpdir(), "lakda-report-auto-"));
  try {
    const charter = await input(root, fixture.baseUrl); const reports = join(root, "reports");
    await writeFile(reports, "occupied by a file");
    const result = await invoke(["explore", "run", "--charter", charter, "--report-dir", reports]);
    expect(result.code).toBe(0); expect(result.stdout).toHaveLength(1);
    expect(JSON.parse(result.stdout[0]).outcome).toBe("passed");
    expect(result.stderr.join("\n")).toContain('"generationStatus":"error"');
    expect(await readFile(reports, "utf8")).toBe("occupied by a file");
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

for (const actionsBeforePause of [0, 1]) test(`pause after ${actionsBeforePause} actions and resume completion create immutable snapshots`, async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-auto-"));
  let pauseRequested = false;
  const fixture = await startFixture(url => {
    if ((actionsBeforePause === 0 || url.pathname === "/pause") && !pauseRequested) {
      pauseRequested = true;
      const sessions = readdirSync(join(root, "explorations"));
      if (sessions.length !== 1) throw new Error("Expected one test-owned session");
      const control = join(root, "explorations", sessions[0], "control-requests");
      mkdirSync(control, { recursive: true });
      writeFileSync(join(control, "pause.json"), JSON.stringify({ command: "pause", reason: "fixture-pause", requestId: "fixture-pause" }));
    }
    return { body: '<main><button data-testid="continue" data-lakda-mutation-kind="none">Continue</button></main><script>document.querySelector("button").onclick = () => { document.querySelector("main").textContent = "Completed action"; fetch("/pause"); };</script>' };
  });
  const notification = (lines: string[]) => lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).find(value => value?.report?.schemaVersion === "lakda/report-receipt/v1");
  try {
    const charter = await input(root, fixture.baseUrl); const reports = join(root, "reports");
    const charterValue = JSON.parse(await readFile(charter, "utf8"));
    if (actionsBeforePause > 0) charterValue.stopWhen = { any: [{ type: "noveltyPlateau", windowActions: 1, minActions: 2 }] };
    await writeFile(charter, JSON.stringify(charterValue));
    const paused = await invoke(["explore", "run", "--charter", charter, "--report-dir", reports]);
    expect(paused.code, paused.stderr.join("\n")).toBe(2);
    expect(JSON.parse(paused.stdout[0]).report.status).toBe("paused");
    const session = join(root, "explorations", (await readdir(join(root, "explorations")))[0]);
    await loadReportSourceCollection(await resolveReportSources({ session }));
    const runRoot = dirname(JSON.parse(paused.stdout[0]).actionSequencePath);
    const observed = JSON.parse(await readFile(join(runRoot, "adaptive/trace.json"), "utf8"));
    const replay = JSON.parse(await readFile(join(runRoot, "adaptive/replay-trace.json"), "utf8"));
    expect(observed.trace.some((entry: { type: string }) => entry.type === "operator-control")).toBe(true);
    expect(replay).toEqual({ ...observed, trace: observed.trace.filter((entry: { type: string }) => !["operator-control", "operator-bookmark", "operator-bookmark-error", "operator-control-error"].includes(entry.type)) });
    const first = notification(paused.stderr); expect(first.report.generationStatus, paused.stderr.join("\n")).toBe("ready");
    const firstPath = join(first.directory, "report-data.json"); const firstBytes = await readFile(firstPath);
    expect(JSON.parse(firstBytes.toString()).sessions[0].status).toBe("paused");
    const resumed = await invoke(["explore", "resume", "--session", session, "--report-dir", reports]);
    const resumedExecution = JSON.parse(resumed.stdout[0]);
    const resumedTrace = JSON.parse(await readFile(join(dirname(resumedExecution.actionSequencePath), "adaptive/trace.json"), "utf8"));
    expect(resumed.code, JSON.stringify(resumedTrace.trace.filter((entry: { type: string }) => entry.type === "replay-divergence"))).toBe(0);
    expect(resumedExecution.outcome).toBe("passed");
    const second = notification(resumed.stderr); expect(second.report.generationStatus).toBe("ready");
    expect(second.report.reportId).not.toBe(first.report.reportId);
    expect(second.directory).not.toBe(first.directory);
    const nextView = JSON.parse(await readFile(join(second.directory, "report-data.json"), "utf8"));
    expect(nextView.sessions[0]).toMatchObject({ status: "completed", technicalOutcome: resumedExecution.outcome });
    expect(nextView.runs.some((run: { outcome: string }) => run.outcome === resumedExecution.outcome)).toBe(true);
    expect(await readFile(firstPath)).toEqual(firstBytes);
    expect((await invoke(["report", "verify", "--report-dir", first.directory])).code).toBe(0);
    expect((await readdir(reports)).filter(name => name.endsWith(".receipt.json"))).toHaveLength(2);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
