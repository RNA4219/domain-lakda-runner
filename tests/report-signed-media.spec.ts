import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import type { BinaryArtifactAttestation } from "../src/exploration/binary-attestation.js";
import { generateReport } from "../src/reporting/generation.js";
import { verifyReportBundle } from "../src/reporting/bundle-verifier.js";
import { runCli } from "../src/cli.js";
import { generateAutomaticReport } from "../src/reporting/automatic.js";
import { assertReportViewSemantics } from "../src/reporting/view-validation.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5K0AAAAASUVORK5CYII=", "base64");
async function signedFixture(root: string) {
  const runDir = join(root, "run"); const trustStorePath = join(root, "trust.json");
  const pair = generateKeyPairSync("ed25519"); const keyId = "fixture-sanitizer";
  await writeFile(trustStorePath, JSON.stringify({ keys: [{ keyId, publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }] }));
  const metadata = { schemaVersion: "lakda/run-metadata/v1", runId: "signed-fixture", attempt: 1, mode: "smoke", seed: 4, outcome: "failed", terminationReason: "machine_failure", startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", producerVersion: "0.5.0-rc.1", commitSha: "a".repeat(40), artifactPolicy: { attestationTrustStorePath: trustStorePath, artifactAttestorKeyIds: [keyId] } };
  const files = new Map<string, Buffer>([
    ["run-metadata.json", Buffer.from(JSON.stringify(metadata))],
    ["action-sequence.json", Buffer.from(JSON.stringify({ schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: 4, baseUrl: "http://fixture.invalid", actions: [] }))],
    ["failure-report.json", Buffer.from(JSON.stringify({ failures: [] }))], ["artifacts/safe.png", png],
  ]);
  const base: BinaryArtifactAttestation = { schemaVersion: "lakda/binary-artifact-attestation/v1", sourcePath: "artifacts/raw.png", sourceSha256: "sha256:" + sha256("raw"), sourceSize: 3,
    outputPath: "artifacts/safe.png", outputSha256: "sha256:" + sha256(png), outputSize: png.length, decision: "sanitized", secretScan: "pass", piiScan: "pass", redactionRuleVersion: "fixture/v1", tool: { name: "fixture", version: "1", policyDigest: "sha256:" + sha256("policy") } };
  const signed = (value: BinaryArtifactAttestation) => { const unsigned = { ...value }; delete unsigned.signature; const payload = canonicalJson(unsigned); return { ...unsigned, signature: { algorithm: "ed25519" as const, keyId, signedPayloadDigest: "sha256:" + sha256(payload), valueBase64: sign(null, Buffer.from(payload), pair.privateKey).toString("base64") } }; };
  const proof = signed(base); files.set("attestations/binary-artifacts.jsonl", Buffer.from(JSON.stringify(proof) + "\n"));
  const save = async () => {
    const artifacts = [];
    for (const [path, bytes] of files) {
      await mkdir(dirname(join(runDir, path)), { recursive: true }); await writeFile(join(runDir, path), bytes);
      artifacts.push({ artifact_id: "lakda:" + artifacts.length, kind: path.endsWith(".png") ? "screenshot" : "report", path, sha256: "sha256:" + sha256(bytes), size_bytes: bytes.length, classification: "internal", redaction_status: "redacted", redaction_rule_version: "fixture/v1", safe_for_summary: true, public_exposure: "none", retention: {}, security_checks: { secrets_scan: "pass", pii_scan: "pass" } });
    }
    await mkdir(join(runDir, "exports"), { recursive: true });
    await writeFile(join(runDir, "exports/artifact-manifest.json"), JSON.stringify({ schema_version: "HATE/v1", run_id: metadata.runId, run_attempt: 1, commit_sha: metadata.commitSha, artifacts }));
  };
  await save(); return { runDir, trustStorePath, proof, files, save, signed };
}

test("generation includes trusted signed output, ignores archived trust paths and rejects retained raw bytes", async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-signed-"));
  try {
    const fixture = await signedFixture(root);
    const options = { producerVersion: "fixture", timeoutMs: 10_000, profile: "share" as const };
    const manifestBefore = await readFile(join(fixture.runDir, "exports/artifact-manifest.json"));
    const out = join(root, "verified");
    const result = await generateReport({ runDir: fixture.runDir }, { ...options, output: out, trustStorePath: fixture.trustStorePath });
    expect(result.receipt.generationStatus, JSON.stringify(result.receipt)).not.toBe("error");
    const view = JSON.parse(await readFile(join(out, "report-data.json"), "utf8"));
    expect(view.media).toHaveLength(1); expect(view.media[0].verification).toBe("verified");
    expect(view.media[0].proof).toMatchObject({ schemaVersion: "lakda/binary-artifact-attestation/v1", decision: "sanitized", signedPayloadDigest: fixture.proof.signature.signedPayloadDigest,
      attestationSha256: "sha256:" + sha256(fixture.files.get("attestations/binary-artifacts.jsonl")!), trustStoreSha256: "sha256:" + sha256(await readFile(fixture.trustStorePath)), keyIdDigest: "sha256:" + sha256("fixture-sanitizer"), targetManifestSha256s: [] });
    expect(await readFile(join(out, view.media[0].path))).toEqual(png);
    await verifyReportBundle(out);
    expect(() => assertReportViewSemantics({ ...view, profile: "local", media: [{ ...view.media[0], verification: "pending", reason: "unverified-media" }] })).toThrow();
    const requests: string[] = []; page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.context().setOffline(true); await page.goto(pathToFileURL(join(out, "index.html")).href);
    await page.getByRole("button", { name: /signed-fixture/ }).click();
    await expect(page.getByText("検証済み媒体", { exact: true })).toBeVisible();
    await page.getByText("媒体の詳細", { exact: true }).click();
    await page.getByText("検証に使った記録", { exact: true }).click();
    await expect(page.getByText(fixture.proof.signature.signedPayloadDigest, { exact: true })).toBeVisible();
    await expect(page.locator(".media-card img")).toHaveJSProperty("naturalWidth", 1); expect(requests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("signed-media-proof.png"), fullPage: true });
    expect(await readFile(join(fixture.runDir, "exports/artifact-manifest.json"))).toEqual(manifestBefore);
    const untrusted = join(root, "untrusted");
    await generateReport({ runDir: fixture.runDir }, { ...options, output: untrusted });
    expect(JSON.parse(await readFile(join(untrusted, "report-data.json"), "utf8")).media[0]).toMatchObject({ verification: "excluded", path: null });
    for (const text of [JSON.stringify({ ...fixture.proof, outputSize: png.length + 1 }), JSON.stringify(fixture.proof) + "\n" + JSON.stringify(fixture.proof)]) {
      fixture.files.set("attestations/binary-artifacts.jsonl", Buffer.from(text)); await fixture.save();
      const bad = await generateReport({ runDir: fixture.runDir }, { ...options, output: join(root, "bad-" + sha256(text)), trustStorePath: fixture.trustStorePath });
      expect(bad.receipt.generationStatus).toBe("degraded");
      expect(bad.receipt.issues.some(issue => issue.code === "invalid-media-proof")).toBe(true);
      const badView = JSON.parse(await readFile(join(root, "bad-" + sha256(text), "report-data.json"), "utf8"));
      expect(badView.media[0]).toMatchObject({ verification: "excluded", path: null });
    }
    fixture.files.set("attestations/binary-artifacts.jsonl", Buffer.from(JSON.stringify(fixture.proof)));
    for (const path of ["artifacts/raw.png", "artifacts/renamed-raw.png"]) {
      fixture.files.set(path, Buffer.from("raw")); await fixture.save();
      const raw = await generateReport({ runDir: fixture.runDir }, { ...options, output: join(root, "raw-" + sha256(path)), trustStorePath: fixture.trustStorePath });
      expect(raw.receipt).toMatchObject({ generationStatus: "error", output: null, issues: [expect.objectContaining({ code: "retained-raw-media" })] });
      fixture.files.delete(path);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("standalone and automatic reporting use the report config trust store", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-signed-cli-"));
  const original = { log: console.log, error: console.error }; const stdout: string[] = []; const stderr: string[] = [];
  try {
    const fixture = await signedFixture(root); const output = join(root, "standalone"); const configPath = join(root, "lakda.report.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: "lakda/report-config/v1", profile: "share", trustStorePath: "trust.json" }));
    console.log = (...values: unknown[]) => { stdout.push(values.map(String).join(" ")); };
    console.error = (...values: unknown[]) => { stderr.push(values.map(String).join(" ")); };
    await runCli(["report", "generate", "--run-dir", fixture.runDir, "--out", output, "--report-config", configPath]);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(await readFile(join(output, "report-data.json"), "utf8")).media[0].verification).toBe("verified");
    await generateAutomaticReport({ schemaVersion: "lakda/report-config/v1", auto: "html", outputRoot: join(root, "automatic"), profile: "share", timeoutMs: 10_000, trustStorePath: fixture.trustStorePath }, { runDir: fixture.runDir });
    const notification = JSON.parse(stderr.at(-1)!);
    expect(notification.directory).not.toBeNull(); expect(notification.receiptPath).not.toBeNull();
    expect(JSON.parse(await readFile(join(notification.directory, "report-data.json"), "utf8")).media[0].verification).toBe("verified");
  } finally { console.log = original.log; console.error = original.error; await rm(root, { recursive: true, force: true }); }
});

test("publication rechecks operator keys after copying media and protects the trust file", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-trust-change-"));
  const probePath = join(root, "probe"); const probe = await open(probePath, "wx");
  const prototype = Object.getPrototypeOf(probe) as FileHandle; const original = prototype.write;
  await probe.close(); await rm(probePath);
  try {
    const fixture = await signedFixture(root); const output = join(root, "report"); const before = await readFile(fixture.trustStorePath, "utf8");
    const options = { producerVersion: "fixture", profile: "share" as const, timeoutMs: 10_000, trustStorePath: fixture.trustStorePath };
    const overlap = await generateReport({ runDir: fixture.runDir }, { ...options, output: fixture.trustStorePath });
    expect(overlap.receipt.issues[0].code).toBe("output-overlap"); expect(await readFile(fixture.trustStorePath, "utf8")).toBe(before);
    let changed = false;
    prototype.write = async function(this: FileHandle, ...args: unknown[]) {
      const result = await Reflect.apply(original, this, args);
      if (!changed) { changed = true; await writeFile(fixture.trustStorePath, before + " "); }
      return result;
    } as FileHandle["write"];
    const result = await generateReport({ runDir: fixture.runDir }, { ...options, output });
    expect(changed).toBe(true); expect(result.receipt).toMatchObject({ generationStatus: "error", output: null, issues: [expect.objectContaining({ code: "source-not-finalized" })] });
    expect((await readdir(root)).some(name => name === "report" || name.startsWith(".lakda-report-"))).toBe(false);
  } finally { prototype.write = original; await rm(root, { recursive: true, force: true }); }
});
