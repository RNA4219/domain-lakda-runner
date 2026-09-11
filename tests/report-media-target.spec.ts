import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { ADAPTIVE_SCHEMA_VERSION, type EvidenceArtifactRef, type OracleResult } from "../src/adaptive/contracts.js";
import { sha256 } from "../src/core/redaction.js";
import { assertExplorationCharter, capabilitySnapshotFromAdapter, type ExplorationCharter } from "../src/exploration/contracts.js";
import { createAttestationRequest, attestationRequestDigest, type AttestationReceipt } from "../src/exploration/attestation-contracts.js";
import { appendSessionEvent, buildExplorationReport, createExplorationSession, registerRunManifest, writeCapabilitySnapshot, writeFinding } from "../src/exploration/session.js";
import { targetManifestSigningPayload, type ExplorationTargetManifest } from "../src/exploration/target-manifest.js";
import { generateReport } from "../src/reporting/generation.js";
import { verifyReportBundle } from "../src/reporting/bundle-verifier.js";
import { assertReportViewSemantics } from "../src/reporting/view-validation.js";
import { loadReportSourceCollection } from "../src/reporting/source-collection.js";
import { loadReportTrustStore } from "../src/reporting/trust-store.js";
import { verifyReportMediaProofs } from "../src/reporting/media-proof.js";
import type { ReportRunInput } from "../src/reporting/run-source.js";

async function removeV2Fixture(root: string) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("lakda-report-v2-")) throw new Error("unexpected fixture root");
  await rm(root, { recursive: true, force: true });
}

/** Artificial signed archives only: no adapter, device or target is contacted. */
async function fixture(root: string, mode: "valid" | "key-denied" | "bridge-mismatch" | "target-mismatch", protocol: "v1" | "v2" | "required-v2-with-v1" = "v1", sanitized = false, runMedia = false) {
  const pair = generateKeyPairSync("ed25519"); const keyId = "fixture-operator"; const trustStorePath = join(root, "keys.json");
  await writeFile(trustStorePath, JSON.stringify([{ keyId, publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }]));
  const charter = JSON.parse(await readFile(resolve(import.meta.dirname, "../examples/exploration-charter.playwright.json"), "utf8")) as ExplorationCharter;
  charter.executionMode = "real"; charter.baseUrl = "https://fixture.invalid"; charter.scope.allowHosts = ["fixture.invalid"];
  charter.trustStorePath = trustStorePath; charter.targetManifestPath = join(root, "target.json");
  if (protocol !== "v1") Object.assign(charter.capture, { binaryAttestation: { stagingRoot: join(root, "private"), policyDigest: "sha256:" + sha256("fixture-policy") } });
  const created = await createExplorationSession(charter, { fixture: true }, join(root, "sessions"));
  const runId = runMedia ? "masked-run-fixture" : created.session.sessionId, mediaRoot = runMedia ? join(root, "run") : created.paths.root;
  const capability = capabilitySnapshotFromAdapter({ charter, adapterId: "playwright", revision: "fixture-v1", observedTargetRevision: charter.targetRevision, targetKinds: ["web"], observationCapabilities: ["screen"], actionCapabilities: [], evidenceCapabilities: ["screenshot"], bridgeDigest: "sha256:" + sha256("fixture-bridge") });
  await writeCapabilitySnapshot(created.paths, capability);
  const manifest: ExplorationTargetManifest = {
    schemaVersion: "lakda/exploration-target-manifest/v1", manifestId: "fixture-target", owner: "fixture", status: "ready", charterDigest: created.session.charterDigest, configDigest: created.session.configDigest,
    targetRevision: charter.targetRevision, platform: charter.platform, adapterId: "playwright", executionMode: "real", target: { identity: { kind: "web", origin: charter.baseUrl, pathPrefixes: ["/"] } },
    safety: { allowMutationKinds: ["none"], resetProcedureRef: "fixture/reset", killSwitchRef: "fixture/kill" },
    bridgeBinding: { capabilityDigest: capability.rawCapabilityDigest!, bridgeDigest: mode === "bridge-mismatch" ? "sha256:" + sha256("other-bridge") : capability.bridgeDigest! },
    artifactAttestorKeyIds: mode === "key-denied" ? [] : [keyId],
    signature: { algorithm: "ed25519", keyId, validFrom: new Date(Date.now() - 60_000).toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString(), approvalEvidenceRef: "fixture/approval", signedPayloadDigest: "", valueBase64: "" },
  };
  const payload = targetManifestSigningPayload(manifest); manifest.signature.signedPayloadDigest = "sha256:" + sha256(payload); manifest.signature.valueBase64 = sign(null, Buffer.from(payload), pair.privateKey).toString("base64");
  const target = Buffer.from(JSON.stringify(manifest)); await writeFile(created.paths.targetManifest, target);
  await appendSessionEvent(created.paths, { type: "session-started", status: "running", payload: { targetManifestDigest: "sha256:" + sha256(mode === "target-mismatch" ? "other-target" : target) } });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5K0AAAAASUVORK5CYII=", "base64");
  const raw = sanitized ? Buffer.concat([png, Buffer.from("fixture-original")]) : png;
  const base = { schemaVersion: "lakda/binary-artifact-attestation/v1", sourcePath: "artifacts/fixture.png", sourceSha256: "sha256:" + sha256(raw), sourceSize: raw.length, decision: "no-sensitive-content", secretScan: "pass", piiScan: "pass", redactionRuleVersion: "fixture/v1", tool: { name: "fixture", version: "1", policyDigest: "sha256:" + sha256("fixture-policy") } };
  const request = protocol === "v2" ? createAttestationRequest({ runId, sessionId: created.session.sessionId,
    targetManifestSha256: "sha256:" + sha256(target), sourcePath: base.sourcePath, sourceSize: base.sourceSize, sourceSha256: base.sourceSha256,
    mediaType: "image/png", policyDigest: base.tool.policyDigest }, { now: Date.parse("2020-01-01T00:00:00.000Z") }) : undefined;
  const outputPath = sanitized ? request?.outputPath ?? "artifacts/sanitized.png" : base.sourcePath;
  const mediaProof = { ...base, ...(sanitized ? { decision: "sanitized", outputPath, outputSize: png.length, outputSha256: "sha256:" + sha256(png) } : {}) };
  const unsigned = request ? { ...mediaProof, schemaVersion: "lakda/binary-artifact-attestation/v2", request, requestSha256: attestationRequestDigest(request), completedAt: request.createdAt } : mediaProof;
  const proofPayload = canonicalJson(unsigned);
  const proof = Buffer.from(canonicalJson({ ...unsigned, signature: { algorithm: "ed25519", keyId, signedPayloadDigest: "sha256:" + sha256(proofPayload), valueBase64: sign(null, Buffer.from(proofPayload), pair.privateKey).toString("base64") } }) + "\n");
  const reference: EvidenceArtifactRef = { schemaVersion: ADAPTIVE_SCHEMA_VERSION, artifactId: "adapter:original-picture", path: base.sourcePath, size: base.sourceSize, sha256: base.sourceSha256,
    classification: "internal", redactionStatus: "pending", securityStatus: "not_applicable" };
  const oracle: OracleResult = { schemaVersion: ADAPTIVE_SCHEMA_VERSION, oracleId: "exploration:fixture-mask", oracleClass: "generic", verdict: "candidate", severity: "warning",
    sourceRefs: [], requirementRefs: [], evidenceRefs: [reference], message: "fixture finding" };
  if (sanitized) await writeFinding(created.paths, { schemaVersion: "lakda/exploration-finding/v1", findingId: "masked-finding", sessionId: created.session.sessionId,
    platform: charter.platform, kind: "freeze", status: "exploratory-finding", severity: "warning", message: "fixture finding", observedAt: new Date().toISOString(), targetRevision: charter.targetRevision,
    oracleRefs: [oracle.oracleId], evidenceRefs: [reference.artifactId], requirementRefs: [] });
  await appendSessionEvent(created.paths, { type: "session-paused", status: "paused" }); await buildExplorationReport(created.paths);
  const hate = JSON.parse(await readFile(created.paths.hateManifest, "utf8"));
  const receipt: AttestationReceipt | undefined = request && { schemaVersion: "lakda/binary-attestation-receipt/v1", requestId: request.requestId, requestSha256: attestationRequestDigest(request),
    runId: request.runId, targetManifestSha256: request.targetManifestSha256, status: "response-verified", reason: null,
    responseSha256: "sha256:" + sha256(proof), receivedAt: request.createdAt, finishedAt: request.createdAt };
  const receiptRef = request && `attestations/receipts/${request.requestId}.json`;
  const files: Array<[string, Buffer]> = [[outputPath, png], ["attestations/binary-artifacts.jsonl", proof]];
  if (runMedia) {
    hate.run_id = runId; hate.artifacts = [];
    const metadata = { schemaVersion: "lakda/run-metadata/v1", runId, attempt: 1, mode: "adaptive-explore", seed: 7, outcome: "failed", terminationReason: "machine_failure",
      startedAt: "2026-09-10T00:00:00.000Z", endedAt: "2026-09-10T00:00:01.000Z", producerVersion: "fixture", commitSha: hate.commit_sha };
    files.push(["run-metadata.json", Buffer.from(JSON.stringify(metadata))], ["failure-report.json", Buffer.from('{"failures":[]}')],
      ["adaptive/trace.json", Buffer.from(JSON.stringify({ schemaVersion: "lakda/adaptive-trace/v1", seed: 7, actions: 0, trace: [
        { type: "oracle", result: oracle }, { type: "operator-bookmark", requestId: "bookmark", evidenceRefs: [reference.artifactId], actionCount: 0 },
      ] }))]);
  }
  if (sanitized) files.push(["adaptive/oracle-results.jsonl", Buffer.from(JSON.stringify(oracle) + "\n")]);
  if (receipt && receiptRef) files.push([receiptRef, Buffer.from(canonicalJson(receipt) + "\n")]);
  // Eligible HATE flags are deliberate fixture input; the report must independently check target permission.
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(mediaRoot, path)), { recursive: true }); await writeFile(join(mediaRoot, path), bytes);
    hate.artifacts.push({ artifact_id: "lakda:fixture-" + hate.artifacts.length, kind: path.endsWith(".png") ? "screenshot" : "log", path, sha256: "sha256:" + sha256(bytes), size_bytes: bytes.length, classification: "internal", redaction_status: "not_required", redaction_rule_version: "fixture/v1", safe_for_summary: false, public_exposure: "none", retention: {}, security_checks: { secrets_scan: "pass", pii_scan: "pass" } });
  }
  const mediaManifest = runMedia ? join(mediaRoot, "exports/artifact-manifest.json") : created.paths.hateManifest;
  await mkdir(dirname(mediaManifest), { recursive: true }); await writeFile(mediaManifest, JSON.stringify(hate));
  if (runMedia) {
    await appendSessionEvent(created.paths, { type: "checkpoint", payload: { runId } });
    await registerRunManifest(created.paths, runId, mediaManifest); await buildExplorationReport(created.paths);
  }
  const signedProof = (value: object) => {
    const payload = canonicalJson(value);
    return Buffer.from(canonicalJson({ ...value, signature: { algorithm: "ed25519", keyId, signedPayloadDigest: "sha256:" + sha256(payload), valueBase64: sign(null, Buffer.from(payload), pair.privateKey).toString("base64") } }) + "\n");
  };
  return { ...created, trustStorePath, targetSha256: "sha256:" + sha256(target), request, receipt, receiptRef, signedProof, reference, mediaRoot, mediaManifest, runId };
}

test("finding and event references reach the signed sanitized output without the original image", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-v2-links-"));
  try {
    for (const protocol of ["v1", "v2"] as const) {
      const directory = join(root, protocol); await mkdir(directory);
      const input = await fixture(directory, "valid", protocol, true), output = join(directory, "report");
      const originalManifest = await readFile(input.paths.hateManifest);
      const generated = await generateReport({ session: input.paths.root }, { output, producerVersion: "fixture", profile: "share", timeoutMs: 10000, trustStorePath: input.trustStorePath });
      expect(generated.receipt.generationStatus, JSON.stringify(generated.receipt)).not.toBe("error");
      const view = JSON.parse(await readFile(join(output, "report-data.json"), "utf8"));
      const finding = view.rows.find((row: { kind: string }) => row.kind === "finding"), media = view.media[0];
      expect(media).toMatchObject({ verification: "verified", scope: "record" }); expect(finding.evidenceIds).toEqual([media.id]);
      const event = view.timeline.find((entry: { relatedIds: string[] }) => entry.relatedIds.includes(finding.id));
      expect(event.evidenceIds).toEqual([media.id]); expect(media.recordIds.sort()).toEqual([finding.id, event.id].sort());
      await verifyReportBundle(output); expect(await readFile(input.paths.hateManifest)).toEqual(originalManifest);
      await expect(readFile(join(input.paths.root, input.reference.path))).rejects.toMatchObject({ code: "ENOENT" });
      const requests: string[] = []; await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
      await page.goto(pathToFileURL(join(output, "index.html")).href);
      await page.getByRole("button", { name: "表示する: masked-finding", exact: true }).click();
      const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
      await expect(detail.locator(".media-card img")).toHaveJSProperty("naturalWidth", 1);
      expect(requests).toEqual([]);
    }
  } finally { await removeV2Fixture(root); }
});

test("bound run history and session findings open the same signed sanitized image offline", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-v2-run-links-"));
  try {
    const input = await fixture(root, "valid", "v2", true, true), output = join(root, "report"), sources = join(root, "sources.json");
    await writeFile(sources, JSON.stringify({ schemaVersion: "lakda/report-sources/v1", root: ".", entries: [
      { kind: "run", path: relative(root, input.mediaRoot).replaceAll("\\", "/") }, { kind: "session", path: relative(root, input.paths.root).replaceAll("\\", "/") },
    ] }));
    const original = await readFile(input.mediaManifest);
    const generated = await generateReport({ sources }, { output, producerVersion: "fixture", profile: "share", timeoutMs: 10000, trustStorePath: input.trustStorePath });
    expect(generated.receipt.generationStatus, JSON.stringify(generated.receipt)).not.toBe("error");
    const view = JSON.parse(await readFile(join(output, "report-data.json"), "utf8")), media = view.media[0];
    expect(media).toMatchObject({ verification: "verified", scope: "record", runKey: `run:${input.runId}:1` });
    const history = view.timeline.filter((entry: { sourceId: string }) => entry.sourceId === media.sourceId);
    expect(history).toHaveLength(2);
    for (const entry of history) { expect(entry.evidenceIds).toEqual([media.id]); expect(media.recordIds).toContain(entry.id); }
    expect(view.rows.find((row: { kind: string }) => row.kind === "finding").evidenceIds).toEqual([media.id]);
    expect(media.recordIds).toHaveLength(4); await verifyReportBundle(output);
    expect(await readFile(input.mediaManifest)).toEqual(original);
    await expect(readFile(join(input.mediaRoot, input.reference.path))).rejects.toMatchObject({ code: "ENOENT" });
    const requests: string[] = []; await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    await page.getByRole("button", { name: "表示する: " + input.runId, exact: true }).click();
    const detail = page.getByRole("dialog", { name: "結果の詳細", exact: true });
    await detail.getByRole("button", { name: "#1 の証跡を見る (1件)", exact: true }).click();
    await expect(detail.locator(".media-card img")).toHaveJSProperty("naturalWidth", 1); expect(requests).toEqual([]);
  } finally { await removeV2Fixture(root); }
});

test("sanitized references require trust and target permission and preserve stronger classification", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-v2-link-policy-"));
  try {
    for (const mode of ["no-trust", "key-denied", "invalid-signature", "confidential", "restricted", "mismatch", "text-only"] as const) {
      const directory = join(root, mode); await mkdir(directory);
      const input = await fixture(directory, mode === "key-denied" ? mode : "valid", mode === "invalid-signature" ? "v1" : "v2", true), output = join(directory, "report");
      if (mode === "invalid-signature") {
        const path = "attestations/binary-artifacts.jsonl", proof = JSON.parse(await readFile(join(input.paths.root, path), "utf8"));
        proof.signature.valueBase64 = Buffer.alloc(64).toString("base64");
        const bytes = Buffer.from(canonicalJson(proof) + "\n"), hate = JSON.parse(await readFile(input.paths.hateManifest, "utf8"));
        Object.assign(hate.artifacts.find((entry: { path: string }) => entry.path === path), { size_bytes: bytes.length, sha256: "sha256:" + sha256(bytes) });
        await writeFile(join(input.paths.root, path), bytes); await writeFile(input.paths.hateManifest, JSON.stringify(hate));
      }
      if (["confidential", "restricted", "mismatch"].includes(mode)) {
        const path = "adaptive/oracle-results.jsonl", oracle = JSON.parse(await readFile(join(input.paths.root, path), "utf8"));
        if (mode === "mismatch") oracle.evidenceRefs[0].size += 1; else oracle.evidenceRefs[0].classification = mode;
        const bytes = Buffer.from(JSON.stringify(oracle) + "\n"), hate = JSON.parse(await readFile(input.paths.hateManifest, "utf8"));
        Object.assign(hate.artifacts.find((entry: { path: string }) => entry.path === path), { size_bytes: bytes.length, sha256: "sha256:" + sha256(bytes) });
        await writeFile(join(input.paths.root, path), bytes); await writeFile(input.paths.hateManifest, JSON.stringify(hate));
      }
      const generated = await generateReport({ session: input.paths.root }, { output, producerVersion: "fixture", profile: "share", timeoutMs: 10000,
        textOnly: mode === "text-only", ...(mode === "no-trust" ? {} : { trustStorePath: input.trustStorePath }) });
      if (mode === "mismatch") { expect(generated.receipt.issues[0].code).toBe("evidence-reference-mismatch"); continue; }
      expect(generated.receipt.generationStatus, JSON.stringify(generated.receipt)).not.toBe("error");
      const view = JSON.parse(await readFile(join(output, "report-data.json"), "utf8")), media = view.media[0], finding = view.rows.find((row: { kind: string }) => row.kind === "finding");
      if (mode === "confidential" || mode === "text-only") expect(finding.evidenceIds).toEqual([media.id]);
      else expect(finding.evidenceIds).toEqual([]);
      if (mode === "confidential") expect(media).toMatchObject({ verification: "verified", classification: "confidential" });
      else expect(media).toMatchObject({ verification: "excluded", path: null });
      await verifyReportBundle(output);
    }
  } finally { await removeV2Fixture(root); }
});

test("handoff charter accepts bounded real settings and rejects unsupported lanes and values", async () => {
  const charter = JSON.parse(await readFile(resolve(import.meta.dirname, "../examples/exploration-charter.playwright.json"), "utf8"));
  Object.assign(charter, { executionMode: "real", targetManifestPath: "target.json", trustStorePath: "keys.json" });
  const settings = { stagingRoot: "private", policyDigest: "sha256:" + sha256("policy") };
  for (const timeoutMs of [undefined, 1000, 300000]) {
    charter.capture.binaryAttestation = { ...settings, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
    expect(() => assertExplorationCharter(charter)).not.toThrow();
  }
  for (const change of [{ timeoutMs: 999 }, { timeoutMs: 300001 }, { timeoutMs: 1500.5 }, { policyDigest: "unknown" }, { stagingRoot: "" }, { stagingRoot: "a".repeat(4097) }, { unknown: true }]) {
    charter.capture.binaryAttestation = { ...settings, ...change };
    expect(() => assertExplorationCharter(charter)).toThrow();
  }
  charter.capture.binaryAttestation = settings;
  for (const executionMode of ["fixture", "mock", "emulator"]) expect(() => assertExplorationCharter({ ...charter, executionMode })).toThrow();
});

test("historical v2 report requires a target-bound handoff and retains receipt digests", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-v2-"));
  try {
    for (const protocol of ["v2", "required-v2-with-v1"] as const) {
      const directory = join(root, protocol); await mkdir(directory); const input = await fixture(directory, "valid", protocol); const output = join(directory, "report");
      const result = await generateReport({ session: input.paths.root }, { output, producerVersion: "fixture", profile: "share", timeoutMs: 10000, trustStorePath: input.trustStorePath });
      expect(result.receipt.generationStatus, JSON.stringify(result.receipt)).not.toBe("error");
      const view = JSON.parse(await readFile(join(output, "report-data.json"), "utf8"));
      if (protocol === "v2") {
        expect(Date.now()).toBeGreaterThan(Date.parse(input.request!.expiresAt));
        expect(view.media[0]).toMatchObject({ verification: "verified", proof: { schemaVersion: "lakda/binary-artifact-attestation/v2", targetManifestSha256s: [input.targetSha256],
          requestSha256: attestationRequestDigest(input.request!), receiptSha256: "sha256:" + sha256(canonicalJson(input.receipt) + "\n") } });
        await verifyReportBundle(output);
        for (const field of ["requestSha256", "receiptSha256"]) {
          const changed = structuredClone(view); delete changed.media[0].proof[field]; expect(() => assertReportViewSemantics(changed)).toThrow();
        }
        const downgraded = structuredClone(view); downgraded.media[0].proof.schemaVersion = "lakda/binary-artifact-attestation/v1";
        expect(() => assertReportViewSemantics(downgraded)).toThrow();
        const requests: string[] = []; page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
        await page.context().setOffline(true); await page.goto(pathToFileURL(join(output, "index.html")).href);
        await page.getByRole("button", { name: "表示する: " + view.rows.find((row: { kind: string }) => row.kind === "session").title, exact: true }).click();
        await page.getByText("媒体の詳細", { exact: true }).click();
        await page.getByText("検証に使った記録", { exact: true }).click();
        await expect(page.getByText(view.media[0].proof.requestSha256, { exact: true })).toBeVisible();
        await expect(page.getByText(view.media[0].proof.receiptSha256, { exact: true })).toBeVisible();
        expect(requests).toEqual([]);
      } else expect(view.media[0]).toMatchObject({ verification: "excluded", path: null });
    }
  } finally { await removeV2Fixture(root); }
});

test("v2 media excludes missing, restricted, changed and noncanonical HATE receipt snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-v2-receipt-"));
  try {
    const input = await fixture(root, "valid", "v2"), trust = await loadReportTrustStore(input.trustStorePath);
    for (const mode of ["unlisted", "missing-bytes", "restricted", "scan-fail", "noncanonical", "wrong-run", "wrong-response", "oversize", "confidential"] as const) {
      const collection = await loadReportSourceCollection({ entries: [{ kind: "session", root: input.paths.root }], duplicatePaths: 0, indexBytes: 0 });
      const session = collection.sessions[0], artifact = session.snapshot.artifacts.find(item => item.path === input.receiptRef)!;
      const snapshot = session.snapshot.snapshots.get(input.receiptRef!)!;
      if (mode === "unlisted") session.snapshot.artifacts = session.snapshot.artifacts.filter(item => item !== artifact);
      if (mode === "missing-bytes") delete snapshot.bytes;
      if (mode === "restricted" || mode === "confidential") artifact.classification = mode;
      if (mode === "scan-fail") artifact.security_checks.secrets_scan = "fail";
      const changed = { ...input.receipt! };
      if (mode === "wrong-run") changed.runId = "other-run";
      if (mode === "wrong-response") changed.responseSha256 = "sha256:" + sha256("different-response");
      if (["noncanonical", "wrong-run", "wrong-response", "oversize"].includes(mode)) {
        snapshot.bytes = Buffer.from(canonicalJson(changed) + "\n" + (mode === "noncanonical" ? "\n" : mode === "oversize" ? " ".repeat(65536) : ""));
        snapshot.size = snapshot.bytes.length; snapshot.sha256 = "sha256:" + sha256(snapshot.bytes);
      }
      const result = await verifyReportMediaProofs(collection, trust);
      expect(result.verifiedIds.size, mode).toBe(mode === "confidential" ? 1 : 0);
      if (mode === "confidential") expect(session.source.classification).toBe("confidential");
      else expect(result.issues.some(issue => issue.code === "invalid-media-proof"), mode).toBe(true);
    }
  } finally { await removeV2Fixture(root); }
});

test("v2 report binds the actual retaining run and referencing session after input validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-v2-binding-"));
  try {
    const input = await fixture(root, "valid", "v2"), trust = await loadReportTrustStore(input.trustStorePath);
    for (const mode of ["valid", "other-run", "other-session", "without-target"] as const) {
      const collection = await loadReportSourceCollection({ entries: [{ kind: "session", root: input.paths.root }], duplicatePaths: 0, indexBytes: 0 });
      const session = collection.sessions[0];
      if (mode === "other-run") session.snapshot.manifest.run_id = "other-run";
      if (mode === "other-session") session.session.sessionId = "other-session";
      if (mode === "without-target") session.charter.executionMode = "fixture";
      expect((await verifyReportMediaProofs(collection, trust)).verifiedIds.size, mode).toBe(mode === "valid" ? 1 : 0);
    }
  } finally { await removeV2Fixture(root); }
});

test("denied target permission does not bypass legacy raw-source rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-v2-raw-"));
  try {
    const input = await fixture(root, "key-denied"), trust = await loadReportTrustStore(input.trustStorePath);
    const collection = await loadReportSourceCollection({ entries: [{ kind: "session", root: input.paths.root }], duplicatePaths: 0, indexBytes: 0 });
    const session = collection.sessions[0], media = session.mediaCandidates[0], record = session.snapshot.snapshots.get("attestations/binary-artifacts.jsonl")!;
    const original = JSON.parse(record.bytes!.toString("utf8")); delete original.signature;
    const raw = Buffer.from("private fixture bytes"), rawPath = "artifacts/renamed-original.png", rawSha256 = "sha256:" + sha256(raw);
    record.bytes = input.signedProof({ ...original, decision: "sanitized", sourcePath: "artifacts/original.png", sourceSha256: rawSha256, sourceSize: raw.length,
      outputPath: media.artifact.path, outputSize: media.snapshot.size, outputSha256: media.snapshot.sha256 });
    record.size = record.bytes.length; record.sha256 = "sha256:" + sha256(record.bytes);
    session.snapshot.artifacts.push({ ...media.artifact, path: rawPath, size_bytes: raw.length, sha256: rawSha256 });
    session.snapshot.snapshots.set(rawPath, { path: join(session.snapshot.root, rawPath), size: raw.length, sha256: rawSha256, bytes: raw });
    await expect(verifyReportMediaProofs(collection, trust)).rejects.toMatchObject({ issueCode: "retained-raw-media" });
  } finally { await removeV2Fixture(root); }
});

test("session media requires target key permission and matching capability and session digests", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-media-target-"));
  try {
    for (const mode of ["valid", "key-denied", "bridge-mismatch", "target-mismatch"] as const) {
      const directory = join(root, mode); await mkdir(directory); const input = await fixture(directory, mode); const output = join(directory, "report");
      const result = await generateReport({ session: input.paths.root }, { output, producerVersion: "fixture", profile: "share", timeoutMs: 10_000, trustStorePath: input.trustStorePath });
      expect(result.receipt.generationStatus, JSON.stringify(result.receipt)).not.toBe("error");
      const view = JSON.parse(await readFile(join(output, "report-data.json"), "utf8"));
      expect(view.media).toHaveLength(1);
      if (mode === "valid") {
        expect(view.media[0]).toMatchObject({ verification: "verified", proof: { targetManifestSha256s: [input.targetSha256] } });
        expect(view.sessions[0].acceptanceStatus).toBe("pending_external");
      } else {
        expect(view.media[0]).toMatchObject({ verification: "excluded", path: null });
        expect(result.receipt.issues.some(issue => issue.code === "invalid-media-target")).toBe(true);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("adaptive media needs every supplied target context, including restricted references", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-context-"));
  try {
    const input = await fixture(root, "valid"); const trust = await loadReportTrustStore(input.trustStorePath);
    const collection = await loadReportSourceCollection({ entries: [{ kind: "session", root: input.paths.root }], duplicatePaths: 0, indexBytes: 0 });
    const session = collection.sessions[0];
    // Exercise the post-binding verifier with an artificial child; source binding has separate integration tests.
    const run: ReportRunInput = { snapshot: session.snapshot, metadata: { mode: "adaptive-explore" }, source: { ...session.source, id: "fixture-child", kind: "run" }, rows: [], timeline: [], issues: [],
      mediaCandidates: session.mediaCandidates.map(candidate => ({ ...candidate, id: "fixture-child-media", sourceId: "fixture-child", runKey: "fixture-child" })) };
    const source = { ...collection, runs: [run], sessions: [] };
    expect((await verifyReportMediaProofs(source, trust)).verifiedIds.has("fixture-child-media")).toBe(false);
    session.summary!.runKeys = [run.source.id];
    session.runReferences = [{ runId: String(run.snapshot.manifest.run_id), attempt: Number(run.snapshot.manifest.run_attempt), manifestSha256: run.snapshot.manifestSha256, manifestSize: 1 }];
    expect((await verifyReportMediaProofs({ ...source, sessions: [session] }, trust)).verifiedIds.has("fixture-child-media")).toBe(true);
    const restricted = { ...session, source: { ...session.source, id: "restricted-reference", status: "restricted" as const }, summary: undefined, mediaCandidates: [] };
    expect((await verifyReportMediaProofs({ ...source, sessions: [session, restricted] }, trust)).verifiedIds.has("fixture-child-media")).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
