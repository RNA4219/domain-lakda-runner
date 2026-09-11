import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");

const prefix = join(tmpdir(), "lakda-package-install-");
const temp = await mkdtemp(prefix);
const resolvedTemp = resolve(temp);
if (!resolvedTemp.startsWith(resolve(tmpdir()) + sep) || !basename(resolvedTemp).startsWith("lakda-package-install-")) {
  throw new Error("temporary package directory is outside the expected boundary");
}

try {
  const packed = JSON.parse(execFileSync(process.execPath, [
    npmCli,
    "pack",
    "--json",
    "--pack-destination",
    resolvedTemp,
  ], { cwd: root, encoding: "utf8" }));
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
    throw new Error("npm pack output is invalid");
  }
  const tarball = join(resolvedTemp, packed[0].filename);
  const consumer = join(resolvedTemp, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "lakda-package-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
  }), "utf8");
  execFileSync(process.execPath, [
    npmCli,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefer-offline",
    tarball,
  ], { cwd: consumer, encoding: "utf8" });

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const cli = join(consumer, "node_modules", "domain-lakda-runner", "dist", "cli.js");
  const bridgeRoot = join(consumer, "node_modules", "domain-lakda-runner", "tools", "airtest-poco-bridge");
  await Promise.all([
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-executor.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-capture.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-capture-executor.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-capture-evidence.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-capture-verifier.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-bridge.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-runtime.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-evidence.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-evidence-io.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-evidence-store.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "exploration", "native-identity-evidence-target.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "dist", "reporting", "native-evidence.js")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "schemas", "lakda-native-execution-evidence-v1.schema.json")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "schemas", "lakda-native-execution-evidence-v2.schema.json")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "schemas", "lakda-native-capture-evidence-v1.schema.json")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "schemas", "lakda-native-action-v2.schema.json")),
    access(join(consumer, "node_modules", "domain-lakda-runner", "schemas", "lakda-native-capture-v1.schema.json")),
    access(join(bridgeRoot, "README.md")),
    access(join(bridgeRoot, "requirements.top-level-attestation.txt")),
    access(join(bridgeRoot, "requirements.txt")),
    access(join(bridgeRoot, "server.py")),
    access(join(bridgeRoot, "native_identity.py")),
    access(join(bridgeRoot, "native_identity_exchange.py")),
    access(join(bridgeRoot, "native_identity_actions.py")),
    access(join(bridgeRoot, "native_identity_capture.py")),
    access(join(bridgeRoot, "native_identity_capture_video.py")),
    access(join(bridgeRoot, "native_identity_capture_contract.py")),
    access(join(bridgeRoot, "native_identity_capture_exchange.py")),
    access(join(bridgeRoot, "native_identity_clock.py")),
    access(join(bridgeRoot, "native_identity_transport.py")),
    access(join(bridgeRoot, "native_identity_transport_protocol.py")),
  ]);
  const help = execFileSync(process.execPath, [cli, "--help"], { cwd: consumer, encoding: "utf8" });
  if (!help.includes("lakda") || !help.includes("runs list") || !help.includes("runs compare") || !help.includes("report generate") || !help.includes("report verify")) {
    throw new Error("installed package CLI help is incomplete");
  }
  const importedVersion = execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    "import { LAKDA_VERSION } from 'domain-lakda-runner'; process.stdout.write(LAKDA_VERSION);",
  ], { cwd: consumer, encoding: "utf8" });
  if (importedVersion !== packageJson.version) {
    throw new Error("installed package export version mismatch");
  }
  // A schema-backed empty-run fixture exercises installed readers without a browser or target.
  const fixtureScript = join(consumer, "report-fixture.mjs");
  await writeFile(fixtureScript, [
    'import { join } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    'import { generateKeyPairSync, sign } from "node:crypto";',
    'import { mkdir, writeFile } from "node:fs/promises";',
    'const installed = process.argv[2];',
    'const { ArtifactCollector } = await import(pathToFileURL(join(installed, "dist/core/artifacts.js")).href);',
    'const { loadConfig } = await import(pathToFileURL(join(installed, "dist/core/config.js")).href);',
    'const { exportHate } = await import(pathToFileURL(join(installed, "dist/core/hate.js")).href);',
    'const { saveReportBatchSources } = await import(pathToFileURL(join(installed, "dist/reporting/batch-writer.js")).href);',
    'const { canonicalJson } = await import(pathToFileURL(join(installed, "dist/core/plan.js")).href);',
    'const { sha256 } = await import(pathToFileURL(join(installed, "dist/core/redaction.js")).href);',
    'const nativeEvidence = await import(pathToFileURL(join(installed, "dist/exploration/native-identity-evidence-store.js")).href);',
    'const nativeBridge = await import(pathToFileURL(join(installed, "dist/exploration/native-identity-bridge.js")).href);',
    'const nativeRuntime = await import(pathToFileURL(join(installed, "dist/exploration/native-identity-runtime.js")).href);',
    'const nativeCapture = await import(pathToFileURL(join(installed, "dist/exploration/native-identity-capture.js")).href);',
    'if (typeof nativeCapture.requestNativeCapture !== "function" || typeof nativeCapture.validateNativeCaptureResult !== "function") throw new Error("native capture package import failed");',
    'const nativeCaptureExecutor = await import(pathToFileURL(join(installed, "dist/exploration/native-identity-capture-executor.js")).href);',
    'if (typeof nativeCaptureExecutor.createNativeCaptureExecutor !== "function") throw new Error("native capture executor import failed");',
    'if (typeof nativeRuntime.prepareNativeIdentityRuntime !== "function") throw new Error("native runtime import failed");',
    'if (typeof nativeBridge.createNativeIdentityBridge !== "function") throw new Error("native runner bridge package import failed");',
    'if (typeof nativeEvidence.createSessionNativeEvidenceSink !== "function" || typeof nativeEvidence.readSessionNativeEvidence !== "function") throw new Error("native evidence package import failed");',
    'const signedNative = await import(pathToFileURL(join(installed, "dist/exploration/native-identity-evidence-target.js")).href);',
    'const nativeReport = await import(pathToFileURL(join(installed, "dist/reporting/native-evidence.js")).href);',
    'if (typeof signedNative.readSignedSessionNativeEvidence !== "function" || typeof signedNative.verifyNativeEvidenceArtifactIndex !== "function" || typeof nativeReport.verifyReportNativeEvidence !== "function") throw new Error("signed native report package import failed");',
    'const config = loadConfig(undefined, { mode: "smoke", baseUrl: "http://127.0.0.1:9", outputDir: "inputs", artifacts: { video: false } });',
    'const collector = await ArtifactCollector.create(config, "smoke", { workerIndex: 0, batchId: "package-batch" });',
    'const result = await collector.finalize({ schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: config.seed, baseUrl: config.baseUrl, actions: [] }, "passed", 0, "not_requested", "completed");',
    'await exportHate(result.runDir, result.manifestPath);',
    'const selector = await saveReportBatchSources({ schemaVersion: "lakda/run-batch/v1", batchId: "package-batch", outcome: "passed", exitCode: 0, requestedWorkers: 1, completedWorkers: 1, workerResults: [{ workerIndex: 0, seed: config.seed, status: "completed", result: { runId: collector.metadata.runId, attempt: 1, outcome: "passed", exitCode: 0, terminationReason: "completed", workerIndex: 0, batchId: "package-batch", actionSequencePath: collector.paths.actionSequence, artifactManifestPath: result.manifestPath, failures: [], llmStatus: "not_requested" } }] }, { runOutputRoot: config.outputDir, outputRoot: "batch-inputs", classification: "internal" });',
    'const incomplete = await ArtifactCollector.create(config, "smoke");',
    'const pair = generateKeyPairSync("ed25519"); const keyId = "package-fixture"; const trustPath = join(process.cwd(), "report-trust.json");',
    'await writeFile(trustPath, JSON.stringify([{ keyId, publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }]));',
    'const signedCollector = await ArtifactCollector.create(config, "smoke", { requireBinaryAttestation: true, attestationTrustStorePath: trustPath, artifactAttestorKeyIds: [keyId] });',
    'const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5K0AAAAASUVORK5CYII=", "base64");',
    'const proof = { schemaVersion: "lakda/binary-artifact-attestation/v1", sourcePath: "artifacts/fixture.png", sourceSha256: "sha256:" + sha256(png), sourceSize: png.length, decision: "no-sensitive-content", redactionRuleVersion: "fixture/v1", secretScan: "pass", piiScan: "pass", tool: { name: "fixture", version: "1", policyDigest: "sha256:" + sha256("fixture-policy") } };',
    'const payload = canonicalJson(proof); proof.signature = { algorithm: "ed25519", keyId, signedPayloadDigest: "sha256:" + sha256(payload), valueBase64: sign(null, Buffer.from(payload), pair.privateKey).toString("base64") };',
    'await writeFile(join(signedCollector.paths.runDir, "artifacts/fixture.png"), png); await mkdir(join(signedCollector.paths.runDir, "attestations"));',
    'await writeFile(join(signedCollector.paths.runDir, "attestations/binary-artifacts.jsonl"), JSON.stringify(proof));',
    'const signedResult = await signedCollector.finalize({ schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: config.seed, baseUrl: config.baseUrl, actions: [] }, "passed", 0, "not_requested", "completed"); await exportHate(signedResult.runDir, signedResult.manifestPath);',
    'const reportConfig = join(process.cwd(), "signed-report.config.json"); await writeFile(reportConfig, JSON.stringify({ schemaVersion: "lakda/report-config/v1", profile: "share", trustStorePath: "report-trust.json" }));',
    'const linkedCollector = await ArtifactCollector.create(config, "adaptive-explore", { requireBinaryAttestation: true, attestationTrustStorePath: trustPath, artifactAttestorKeyIds: [keyId] }); linkedCollector.markFinding();',
    'await mkdir(join(linkedCollector.paths.runDir, "adaptive")); await mkdir(join(linkedCollector.paths.runDir, "attestations"));',
    'await writeFile(join(linkedCollector.paths.runDir, "artifacts/fixture.png"), png); await writeFile(join(linkedCollector.paths.runDir, "attestations/binary-artifacts.jsonl"), JSON.stringify(proof));',
    'const evidence = { schemaVersion: "lakda/adaptive-contracts/v1", artifactId: "adapter:package-picture", path: "artifacts/fixture.png", sha256: sha256(png), size: png.length, classification: "internal", redactionStatus: "redacted", securityStatus: "pass" };',
    'const oracle = { schemaVersion: "lakda/adaptive-contracts/v1", oracleId: "fixture:oracle", oracleClass: "generic", verdict: "candidate", severity: "info", sourceRefs: [], requirementRefs: [], evidenceRefs: [evidence], message: "package fixture" };',
    'await writeFile(join(linkedCollector.paths.runDir, "adaptive/trace.json"), JSON.stringify({ schemaVersion: "lakda/adaptive-trace/v1", seed: config.seed, actions: 0, trace: [{ type: "oracle", result: oracle }] }));',
    'await writeFile(join(linkedCollector.paths.runDir, "adaptive/oracle-results.jsonl"), JSON.stringify(oracle) + "\\n");',
    'const linkedResult = await linkedCollector.finalize({ schemaVersion: "lakda/action-plan/v1", mode: "adaptive-explore", seed: config.seed, baseUrl: config.baseUrl, actions: [] }, "passed", 0, "not_requested", "completed"); await exportHate(linkedResult.runDir, linkedResult.manifestPath);',
    'process.stdout.write(JSON.stringify({ runDir: result.runDir, sources: selector.sources, incompleteRunDir: incomplete.paths.runDir, signedRunDir: signedResult.runDir, linkedRunDir: linkedResult.runDir, reportConfig }));',
  ].join("\n"));
  const input = JSON.parse(execFileSync(process.execPath, [fixtureScript, join(consumer, "node_modules", "domain-lakda-runner")], { cwd: consumer, encoding: "utf8" }));
  const inputRun = input.runDir;
  const reportDirectory = join(consumer, "report-preview");
  const receipt = JSON.parse(execFileSync(process.execPath, [cli, "report", "generate", "--run-dir", inputRun, "--out", reportDirectory, "--text-only", "--report-language", "en"], { cwd: consumer, encoding: "utf8" }));
  const verification = JSON.parse(execFileSync(process.execPath, [cli, "report", "verify", "--report-dir", reportDirectory], { cwd: consumer, encoding: "utf8" }));
  if (receipt.schemaVersion !== "lakda/report-receipt/v1" || receipt.generationStatus !== "ready" || !verification.valid || verification.manifestSha256 !== receipt.manifestSha256 || verification.fileCount !== 5) {
    throw new Error("installed report generation or verification failed");
  }
  const reportHtml = await readFile(join(reportDirectory, "index.html"), "utf8");
  if (!reportHtml.includes('id="lakda-report-data"') || !reportHtml.includes('src="report.js"')) throw new Error("installed report renderer is incomplete");
  if (!reportHtml.includes('<html lang="en">') || !reportHtml.includes("Lakda Execution Report") || JSON.parse(await readFile(join(reportDirectory, "report-data.json"), "utf8")).language !== "en") throw new Error("installed English report contract failed");
  const batchDirectory = join(consumer, "batch-report");
  execFileSync(process.execPath, [cli, "report", "generate", "--sources", input.sources, "--out", batchDirectory, "--text-only"], { cwd: consumer, encoding: "utf8" });
  const batchVerification = JSON.parse(execFileSync(process.execPath, [cli, "report", "verify", "--report-dir", batchDirectory], { cwd: consumer, encoding: "utf8" }));
  const batchView = JSON.parse(await readFile(join(batchDirectory, "report-data.json"), "utf8"));
  if (batchView.language !== "ja") throw new Error("installed report language default changed");
  if (!batchVerification.valid || batchView.batches?.[0]?.batchId !== "package-batch" || batchView.counts.sources !== 1 || batchView.counts.runs !== 1) throw new Error("installed batch report contract failed");
  const incompleteDirectory = join(consumer, "incomplete-report");
  const incompleteResult = spawnSync(process.execPath, [cli, "report", "generate", "--run-dir", input.incompleteRunDir, "--out", incompleteDirectory, "--text-only"], { cwd: consumer, encoding: "utf8", timeout: 30_000 });
  if (incompleteResult.error) throw incompleteResult.error;
  const incompleteReceipt = JSON.parse(incompleteResult.stdout);
  if (incompleteResult.status !== 2 || incompleteReceipt.generationStatus !== "degraded") throw new Error("installed incomplete report generation failed");
  const incompleteVerification = JSON.parse(execFileSync(process.execPath, [cli, "report", "verify", "--report-dir", incompleteDirectory], { cwd: consumer, encoding: "utf8" }));
  const incompleteView = JSON.parse(await readFile(join(incompleteDirectory, "report-data.json"), "utf8"));
  if (!incompleteVerification.valid || incompleteVerification.manifestSha256 !== incompleteReceipt.manifestSha256 || incompleteVerification.fileCount !== 5 || incompleteView.counts.runs !== 0 || incompleteView.counts.incompleteRuns !== 1 || incompleteView.incompleteRuns?.[0]?.status !== "unfinalized" || Object.values(incompleteView.counts.outcomes).some(count => count !== 0)) {
    throw new Error("installed incomplete report contract failed");
  }
  const signedDirectory = join(consumer, "signed-report");
  const signedReceipt = JSON.parse(execFileSync(process.execPath, [cli, "report", "generate", "--run-dir", input.signedRunDir, "--out", signedDirectory, "--report-config", input.reportConfig], { cwd: consumer, encoding: "utf8" }));
  const signedVerification = JSON.parse(execFileSync(process.execPath, [cli, "report", "verify", "--report-dir", signedDirectory], { cwd: consumer, encoding: "utf8" }));
  const signedView = JSON.parse(await readFile(join(signedDirectory, "report-data.json"), "utf8"));
  if (signedReceipt.generationStatus !== "ready" || !signedVerification.valid || signedVerification.manifestSha256 !== signedReceipt.manifestSha256 || signedVerification.fileCount !== 6 || signedView.media.length !== 1 || signedView.media[0].verification !== "verified" || signedView.media[0].proof?.schemaVersion !== "lakda/binary-artifact-attestation/v1") throw new Error("installed signed-media report contract failed");
  const linkedDirectory = join(consumer, "linked-report");
  const linkedResult = spawnSync(process.execPath, [cli, "report", "generate", "--run-dir", input.linkedRunDir, "--out", linkedDirectory, "--profile", "local"], { cwd: consumer, encoding: "utf8", timeout: 30_000 });
  if (linkedResult.error) throw linkedResult.error;
  const linkedReceipt = JSON.parse(linkedResult.stdout);
  const linkedView = JSON.parse(await readFile(join(linkedDirectory, "report-data.json"), "utf8"));
  const linkedVerification = JSON.parse(execFileSync(process.execPath, [cli, "report", "verify", "--report-dir", linkedDirectory], { cwd: consumer, encoding: "utf8" }));
  if (linkedResult.status !== 2 || linkedReceipt.generationStatus !== "degraded" || !linkedVerification.valid || linkedVerification.manifestSha256 !== linkedReceipt.manifestSha256 || linkedView.media.length !== 1 || linkedView.timeline.length !== 1 || linkedView.timeline[0].evidenceIds[0] !== linkedView.media[0].id || linkedView.media[0].recordIds[0] !== linkedView.timeline[0].id || linkedView.media[0].scope !== "record" || linkedView.media[0].path === null) throw new Error("installed linked-media report contract failed");
  console.log(JSON.stringify({
    status: "passed",
    packageVersion: packageJson.version,
    isolatedInstall: true,
    cliHelp: true,
    packageImport: true,
    nativeEvidenceImport: true,
    signedNativeReportImport: true,
    nativeRunnerBridgeImport: true,
    nativeRuntimeImport: true,
    airtestBridge: true,
    reportCli: true,
    batchReport: true,
    incompleteReport: true,
    signedMediaReport: true,
    linkedMediaReport: true,
    reportBundleFiles: verification.fileCount,
  }));
} finally {
  if (resolvedTemp.startsWith(resolve(tmpdir()) + sep) && basename(resolvedTemp).startsWith("lakda-package-install-")) {
    await rm(resolvedTemp, { recursive: true, force: true });
  }
}
