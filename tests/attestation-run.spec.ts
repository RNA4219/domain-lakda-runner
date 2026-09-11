import { generateKeyPairSync, sign } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, test } from "@playwright/test";
import { ArtifactCollector } from "../src/core/artifacts.js";
import { exportHate } from "../src/core/hate.js";
import { loadConfig } from "../src/core/config.js";
import { runLakda } from "../src/core/runner.js";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { attestationRequestDigest, type BinaryAttestationRequest, type BinaryAttestationResponse } from "../src/exploration/attestation-contracts.js";
import { closeAdaptiveEnvironment, type AdaptiveEnvironment } from "../src/adaptive/coordinator/runtime.js";
import { startFixture } from "./fixtures/server.js";
import { loadReportRun } from "../src/reporting/run-source.js";
import { generateReport } from "../src/reporting/generation.js";

const roots: string[] = [];
async function root() { const path = await mkdtemp(join(tmpdir(), "lakda-attestation-run-")); roots.push(path); return path; }
test.afterEach(async () => {
  for (const path of roots.splice(0)) {
    if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith("lakda-attestation-run-")) throw new Error("unexpected fixture root");
    await rm(path, { recursive: true, force: true });
  }
});

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5K0AAAAASUVORK5CYII=", "base64");
async function setup() {
  const directory = await root(), stagingRoot = join(directory, "private"), controlFile = join(directory, "control"), trustPath = join(directory, "keys.json");
  await mkdir(stagingRoot); await mkdir(controlFile);
  const keys = generateKeyPairSync("ed25519");
  await writeFile(trustPath, JSON.stringify([{ keyId: "fixture", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }]));
  const runtime = { requireBinaryAttestation: true, attestationTrustStorePath: trustPath, artifactAttestorKeyIds: ["fixture"], controlFile,
    binaryAttestation: { stagingRoot, targetManifestSha256: "sha256:" + "a".repeat(64), policyDigest: "sha256:" + "b".repeat(64), sessionId: "fixture-session", timeoutMs: 3000 } };
  return { directory, keys, runtime };
}

/** Local artificial attestor: only reads this test's private requests and signs fixture decisions. */
function watchRequests(input: Awaited<ReturnType<typeof setup>>, mode: "all" | "missing-first" | "kill" | "trust-change" | "reject-first" | "wrong-output" = "all") {
  const observed: BinaryAttestationRequest[] = [], seen = new Set<string>();
  let stopping = false, failure: unknown, killed = false, killedAt: number | undefined, changed = false;
  const task = (async () => {
    const deadline = Date.now() + 15000;
    while (!stopping) {
      if (Date.now() > deadline) throw new Error("fixture attestor deadline");
      for (const name of await readdir(input.runtime.binaryAttestation.stagingRoot)) {
        const directory = join(input.runtime.binaryAttestation.stagingRoot, name), requestsRoot = join(directory, "attestations/requests");
        let names: string[];
        try { names = (await readdir(requestsRoot)).filter(name => name.endsWith(".json")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        if (mode === "kill" && names.length >= 2 && !killed) {
          killed = true;
          const commandPath = join(input.runtime.controlFile, "0001.json");
          await writeFile(commandPath + ".tmp", JSON.stringify({ command: "kill", requestId: "fixture-kill" }));
          killedAt = Date.now(); await link(commandPath + ".tmp", commandPath); await unlink(commandPath + ".tmp");
        }
        for (const name of names) {
          if (seen.has(name)) continue;
          const request = JSON.parse(await readFile(join(requestsRoot, name), "utf8")) as BinaryAttestationRequest;
          seen.add(name); observed.push(request);
          if (mode === "trust-change" && !changed) {
            changed = true; await writeFile(input.runtime.attestationTrustStorePath, await readFile(input.runtime.attestationTrustStorePath, "utf8") + "\n");
          }
          const source = await readFile(join(directory, "sources", request.sourcePath));
          expect(source.length).toBe(request.sourceSize); expect("sha256:" + sha256(source)).toBe(request.sourceSha256);
          if (mode === "kill" || mode === "missing-first" && request.sourcePath.endsWith(".png")) continue;
          const rejected = mode === "reject-first" && request.mediaType === "image/png", sanitized = request.mediaType === "image/png" && !rejected;
          const unsigned: Omit<BinaryAttestationResponse, "signature"> = { schemaVersion: "lakda/binary-artifact-attestation/v2", request, requestSha256: attestationRequestDigest(request),
            sourcePath: request.sourcePath, sourceSize: request.sourceSize, sourceSha256: request.sourceSha256, decision: rejected ? "rejected" : sanitized ? "sanitized" : "no-sensitive-content",
            ...(sanitized ? { outputPath: request.outputPath, outputSize: png.length, outputSha256: "sha256:" + sha256(png) } : {}),
            secretScan: "pass", piiScan: "pass", redactionRuleVersion: "fixture/v1", completedAt: new Date().toISOString(), tool: { name: "fixture", version: "1", policyDigest: request.policyDigest } };
          if (sanitized) { await mkdir(dirname(join(directory, "outputs", request.outputPath)), { recursive: true }); await writeFile(join(directory, "outputs", request.outputPath), mode === "wrong-output" ? Buffer.alloc(png.length) : png); }
          const payload = canonicalJson(unsigned), response = { ...unsigned, signature: { algorithm: "ed25519", keyId: "fixture", signedPayloadDigest: "sha256:" + sha256(payload), valueBase64: sign(null, Buffer.from(payload), input.keys.privateKey).toString("base64") } };
          const path = join(directory, "attestations/responses", name), temporary = path + ".tmp";
          await writeFile(temporary, canonicalJson(response) + "\n", { flag: "wx" }); await link(temporary, path); await unlink(temporary);
        }
      }
      await wait(10);
    }
  })().catch(error => { failure = error; });
  return { observed, killedAt: () => killedAt, stop: async () => { stopping = true; await task; if (failure) throw failure; } };
}

test("a completed browser run hands off captured PNG and trace before sealing HATE", async () => {
  const input = await setup(), fixture = await startFixture();
  const watcher = watchRequests(input);
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(input.directory, "runs"), mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }] });
    config.artifacts.video = false;
    const result = await runLakda(config, undefined, input.runtime); await watcher.stop();
    expect(result.outcome, JSON.stringify(result)).toBe("failed"); expect(result.artifactManifestPath).toBeTruthy();
    const runDirectory = dirname(result.actionSequencePath!), metadata = JSON.parse(await readFile(join(runDirectory, "run-metadata.json"), "utf8"));
    expect(metadata.binaryAttestation).toMatchObject({ requested: 2, adopted: 2 });
    expect(metadata.artifactPolicy.binaryAttestationBinding).toMatchObject({ runId: result.runId, sessionId: "fixture-session", targetManifestSha256: input.runtime.binaryAttestation.targetManifestSha256 });
    expect(new Set(watcher.observed.map(request => request.createdAt)).size).toBe(1);
    expect(new Set(watcher.observed.map(request => request.expiresAt)).size).toBe(1);
    const manifest = JSON.parse(await readFile(result.artifactManifestPath!, "utf8"));
    const paths = manifest.artifacts.map((artifact: { path: string }) => artifact.path);
    expect(paths).not.toContain("artifacts/failure.png"); expect(paths).toContain("artifacts/trace.zip");
    expect(paths.filter((path: string) => path.startsWith("attestations/receipts/"))).toHaveLength(2);
    const request = watcher.observed.find(request => request.mediaType === "image/png")!;
    expect(await readFile(join(runDirectory, request.outputPath))).toEqual(png);
    expect((await readFile(join(runDirectory, "attestations/binary-artifacts.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
    const originalManifest = await readFile(result.artifactManifestPath!);
    const resultPath = join(runDirectory, "attestations/results", request.requestId + ".json");
    await rm(resultPath);
    await expect(exportHate(runDirectory, result.artifactManifestPath!)).rejects.toThrow(/result/);
    expect(await readFile(result.artifactManifestPath!)).toEqual(originalManifest);
    await expect(loadReportRun(runDirectory)).rejects.toThrow();
  } finally { await watcher.stop(); await fixture.close(); }
});

test("an unanswered first media request does not starve a ready later response", async ({ page }) => {
  const input = await setup(), fixture = await startFixture(); input.runtime.binaryAttestation.timeoutMs = 1000;
  const watcher = watchRequests(input, "missing-first");
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(input.directory, "runs"), mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }] });
    config.artifacts.video = false;
    const result = await runLakda(config, undefined, input.runtime); await watcher.stop();
    expect(result.outcome).toBe("error"); expect(result.artifactManifestPath).toBeTruthy();
    const metadata = JSON.parse(await readFile(join(dirname(result.actionSequencePath!), "run-metadata.json"), "utf8"));
    expect(metadata.binaryAttestation).toMatchObject({ requested: 2, adopted: 1 });
    expect(metadata.binaryAttestation.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "artifacts/failure.png", receiptStatus: "timeout", adoption: "not-attempted", reason: "request-expired" }),
      expect.objectContaining({ sourcePath: "artifacts/trace.zip", receiptStatus: "response-verified", adoption: "adopted" }),
    ]));
    const runDirectory = dirname(result.actionSequencePath!);
    expect(await readdir(join(runDirectory, "attestations/receipts"))).toHaveLength(2);
    expect(await readdir(join(runDirectory, "attestations/results"))).toHaveLength(2);
    const request = watcher.observed.find(request => request.mediaType === "image/png")!;
    const finalRecord = JSON.parse(await readFile(join(runDirectory, "attestations/results", request.requestId + ".json"), "utf8"));
    expect(finalRecord).toMatchObject({ schemaVersion: "lakda/binary-attestation-result/v1", request, adoption: "not-attempted", reason: "request-expired", artifact: null });
    await expect(readFile(join(runDirectory, "artifacts/failure.png"))).rejects.toMatchObject({ code: "ENOENT" });
    const reportInput = await loadReportRun(runDirectory);
    expect(reportInput.run?.outcome).toBe("error");
    expect(reportInput.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "attestation-media-unavailable", message: expect.stringContaining("request-expired") })]));
    const output = join(input.directory, "timeout-report");
    const generated = await generateReport({ runDir: runDirectory }, { output, profile: "local", producerVersion: "0.5.0-rc.1", timeoutMs: 10000, textOnly: true });
    expect(generated.receipt.generationStatus, JSON.stringify(generated.receipt)).toBe("ready");
    const externalRequests: string[] = [];
    await page.route(/^https?:/, route => { externalRequests.push(route.request().url()); return route.abort(); });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    await expect(page.getByText(/媒体を保持できませんでした: artifacts\/failure.png.*request-expired/)).toBeVisible();
    expect(externalRequests).toEqual([]);
  } finally { await watcher.stop(); await fixture.close(); }
});

for (const mode of ["reject-first", "wrong-output"] as const) test(`a ${mode} response records an error HATE and a separate adoption reason`, async () => {
  const input = await setup(), fixture = await startFixture(), watcher = watchRequests(input, mode);
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(input.directory, "runs"), mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }] });
    config.artifacts.video = false;
    const result = await runLakda(config, undefined, input.runtime); await watcher.stop();
    expect(result.outcome, JSON.stringify(result)).toBe("error"); expect(result.artifactManifestPath).toBeTruthy();
    const runDirectory = dirname(result.actionSequencePath!), request = watcher.observed.find(request => request.mediaType === "image/png")!;
    const record = JSON.parse(await readFile(join(runDirectory, "attestations/results", request.requestId + ".json"), "utf8"));
    expect(record.adoption).toBe(mode === "reject-first" ? "not-attempted" : "failed"); expect(record.reason).toBeTruthy(); expect(record.artifact).toBeNull();
    const receipt = JSON.parse(await readFile(join(runDirectory, "attestations/receipts", request.requestId + ".json"), "utf8"));
    expect(receipt.status).toBe(mode === "reject-first" ? "rejected" : "response-verified");
    const report = await loadReportRun(runDirectory);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "attestation-media-unavailable", message: expect.stringContaining(record.reason) })]));
    await expect(readFile(join(runDirectory, request.sourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(runDirectory, request.outputPath))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await watcher.stop(); await fixture.close(); }
});

test("native capture becomes stopped only after its stop or discard is accepted", async () => {
  const directory = await root();
  const config = loadConfig(undefined, { baseUrl: "http://127.0.0.1:3000", outputDir: directory, mode: "smoke" });
  for (const accepted of [true, false]) {
    const collector = await ArtifactCollector.create(config, config.mode);
    expect(Reflect.get(collector, "captureState")).toBe("not-started");
    collector.markCaptureAvailable({ screenshot: true, video: true });
    expect(Reflect.get(collector, "captureState")).toBe("active");
    const environment = { adapter: {}, activeTargets: () => [], capture: { mode: "video", control: async () => ({ accepted, artifactRefs: [], reason: "fixture-stop" }) } } as unknown as AdaptiveEnvironment;
    await closeAdaptiveEnvironment(config, environment, "passed", collector);
    expect(Reflect.get(collector, "captureState")).toBe(accepted ? "stopped" : "active");
  }
});

test("kill during handoff cancels every receipt within one second and retains private sources", async () => {
  const input = await setup(), fixture = await startFixture(), watcher = watchRequests(input, "kill");
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(input.directory, "runs"), mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }] });
    config.artifacts.video = false;
    const result = await runLakda(config, undefined, input.runtime); await watcher.stop();
    expect(result.outcome).toBe("error"); expect(result.artifactManifestPath).toBeTruthy();
    const runDirectory = dirname(result.actionSequencePath!), metadata = JSON.parse(await readFile(join(runDirectory, "run-metadata.json"), "utf8"));
    expect(metadata.operatorControl).toEqual({ command: "kill", requestId: "fixture-kill" });
    expect(metadata.binaryAttestation).toMatchObject({ requested: 2, adopted: 0 });
    expect(await readdir(input.runtime.controlFile)).toEqual([]);
    const [privateName] = await readdir(input.runtime.binaryAttestation.stagingRoot);
    for (const request of watcher.observed) {
      const receipt = JSON.parse(await readFile(join(runDirectory, "attestations/receipts", request.requestId + ".json"), "utf8"));
      expect(receipt.status).toBe("cancelled"); expect(Date.parse(receipt.finishedAt) - watcher.killedAt()!).toBeLessThan(1000);
      const bytes = await readFile(join(input.runtime.binaryAttestation.stagingRoot, privateName, "sources", request.sourcePath));
      expect("sha256:" + sha256(bytes)).toBe(request.sourceSha256);
    }
  } finally { await watcher.stop(); await fixture.close(); }
});

test("a pause already consumed by the adaptive loop also stops handoff", async () => {
  const input = await setup(), fixture = await startFixture();
  try {
    await writeFile(join(input.runtime.controlFile, "0001.json"), JSON.stringify({ command: "pause", requestId: "fixture-pause" }));
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(input.directory, "runs"), mode: "adaptive-explore", adaptive: {
      schemaVersion: "lakda/adaptive-config/v1", adapter: { id: "playwright" },
      generator: { strategy: "autonomous-uncovered", version: "autonomous-uncovered/v1" }, stopWhen: { any: [{ type: "actionCoverage", atLeast: 1 }] },
      settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 1000, stableWindowMs: 20 }, fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
      recovery: { maxBacktracks: 0, maxAttemptsPerState: 1 }, safety: { allowTargetKinds: ["page"], denyActionIds: [], allowMutationKinds: ["none"] },
    } });
    config.artifacts.video = false;
    const result = await runLakda(config, undefined, input.runtime);
    expect(result.outcome).toBe("error"); expect(result.artifactManifestPath).toBeUndefined();
    expect(result.failures.some(failure => failure.message === "binary-attestation: request-cancelled")).toBe(true);
    const runDirectory = dirname(result.actionSequencePath!), metadata = JSON.parse(await readFile(join(runDirectory, "run-metadata.json"), "utf8"));
    expect(metadata.operatorControl).toEqual({ command: "pause", requestId: "fixture-pause" });
    expect(await readdir(input.runtime.controlFile)).toEqual([]);
    expect((await readFile(join(runDirectory, "artifacts/failure.png"))).length).toBeGreaterThan(0);
    const [privateName] = await readdir(input.runtime.binaryAttestation.stagingRoot);
    expect(await readdir(join(input.runtime.binaryAttestation.stagingRoot, privateName, "attestations/requests"))).toEqual([]);
  } finally { await fixture.close(); }
});

test("changed trust during handoff prevents publishing the adopted proof records", async () => {
  const input = await setup(), fixture = await startFixture(), watcher = watchRequests(input, "trust-change");
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(input.directory, "runs"), mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }] });
    config.artifacts.video = false;
    const result = await runLakda(config, undefined, input.runtime); await watcher.stop();
    expect(result.outcome).toBe("error"); expect(result.artifactManifestPath).toBeUndefined();
    expect(result.failures.some(failure => failure.message === "binary-attestation: trust-changed")).toBe(true);
    const runDirectory = dirname(result.actionSequencePath!);
    await expect(readFile(join(runDirectory, "attestations/binary-artifacts.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    const [privateName] = await readdir(input.runtime.binaryAttestation.stagingRoot);
    expect(await readdir(join(input.runtime.binaryAttestation.stagingRoot, privateName, "sources/artifacts"))).toHaveLength(2);
  } finally { await watcher.stop(); await fixture.close(); }
});

test("unconfirmed browser closure preserves captured raw bytes without attempting handoff", async () => {
  const input = await setup(), fixture = await startFixture(), launch = chromium.launch;
  chromium.launch = async function (...args) {
    const browser = await Reflect.apply(launch, this, args), newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const context = await newContext(...args), close = context.close.bind(context);
      context.close = async (...args) => { await close(...args); throw new Error("fixture-close-unconfirmed"); };
      return context;
    };
    return browser;
  };
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(input.directory, "runs"), mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }] });
    config.artifacts.video = false;
    const result = await runLakda(config, undefined, input.runtime);
    expect(result.outcome).toBe("error"); expect(result.artifactManifestPath).toBeUndefined();
    expect(result.failures.some(failure => failure.message === "binary-attestation: capture-not-stopped")).toBe(true);
    expect((await readFile(join(dirname(result.actionSequencePath!), "artifacts/failure.png"))).length).toBeGreaterThan(0);
    const [privateName] = await readdir(input.runtime.binaryAttestation.stagingRoot);
    expect(await readdir(join(input.runtime.binaryAttestation.stagingRoot, privateName, "attestations/requests"))).toEqual([]);
  } finally { chromium.launch = launch; await fixture.close(); }
});

test("handoff preflight rejects missing trust before any target request", async () => {
  const directory = await root(), stagingRoot = join(directory, "private"); await mkdir(stagingRoot);
  let requests = 0;
  const fixture = await startFixture(() => { requests++; return { body: "<main>fixture</main>" }; });
  try {
    const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(directory, "runs"), mode: "smoke" });
    const runtime = { requireBinaryAttestation: true, attestationTrustStorePath: join(directory, "missing-keys.json"), artifactAttestorKeyIds: ["fixture"],
      binaryAttestation: { stagingRoot, targetManifestSha256: "sha256:" + "a".repeat(64), policyDigest: "sha256:" + "b".repeat(64), sessionId: "fixture-session" } };
    const result = await runLakda(config, undefined, runtime);
    expect(requests).toBe(0); expect(result.outcome).toBe("error");
    expect(result.failures.some(failure => failure.message.includes("binary-attestation"))).toBe(true);
    const metadata = JSON.parse(await readFile(join(dirname(result.actionSequencePath!), "run-metadata.json"), "utf8"));
    expect(metadata.outcome).toBe("error");
    await writeFile(join(directory, "result.json"), JSON.stringify(result));
  } finally { await fixture.close(); }
});

test("private staging cannot be placed inside current public storage or an archived HATE run", async () => {
  const input = await setup(); let requests = 0;
  const fixture = await startFixture(() => { requests++; return { body: "<main>fixture</main>" }; });
  try {
    const outputDir = join(input.directory, "runs"), archive = join(input.directory, "archive");
    await mkdir(join(outputDir, "private"), { recursive: true }); await mkdir(join(archive, "exports"), { recursive: true });
    await mkdir(join(archive, "private")); await writeFile(join(archive, "exports/artifact-manifest.json"), "{}");
    for (const stagingRoot of [join(outputDir, "private"), join(archive, "private")]) {
      const config = loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, mode: "smoke" });
      const result = await runLakda(config, undefined, { ...input.runtime, binaryAttestation: { ...input.runtime.binaryAttestation, stagingRoot } });
      expect(requests).toBe(0); expect(result.outcome).toBe("error");
      expect(result.failures.some(failure => failure.message === "binary-attestation: private-staging-in-public-storage")).toBe(true);
      expect(await readdir(stagingRoot)).toEqual([]);
    }
  } finally { await fixture.close(); }
});
