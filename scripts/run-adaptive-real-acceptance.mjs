import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

class InputError extends Error {}
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outcomeValues = new Set(["passed", "failed", "partial", "error"]);
const acceptanceIdPattern = /^AC-AE-(00[1-9]|01[0-6])$/;
const caseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = value => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" : value && typeof value === "object" ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value);

async function assertJsonSchema(value, schemaName, label, inputContract) {
  const [schema, hateSchema] = await Promise.all([
    readFile(resolve(repositoryRoot, "schemas", schemaName), "utf8").then(JSON.parse),
    readFile(resolve(repositoryRoot, "vendor", "hate", "v1", "artifact-manifest.schema.json"), "utf8").then(JSON.parse),
  ]);
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(hateSchema);
  const validate = ajv.compile(schema);
  if (validate(value)) return;
  const detail = ajv.errorsText(validate.errors, { separator: "; " });
  const message = label + " is invalid: " + detail;
  if (inputContract) throw new InputError(message);
  throw new Error(message);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new InputError(`real adaptive acceptance requires ${name}`);
  return value;
}

function loadInputs() {
  if (process.env.LAKDA_ADAPTIVE_REAL_CONFIRM !== "I_UNDERSTAND") {
    throw new InputError("real adaptive acceptance requires LAKDA_ADAPTIVE_REAL_CONFIRM=I_UNDERSTAND");
  }
  const configPath = resolve(required("LAKDA_ADAPTIVE_REAL_CONFIG"));
  const corpusPath = resolve(required("LAKDA_ADAPTIVE_CORPUS_PATH"));
  const caseId = required("LAKDA_ADAPTIVE_CASE_ID");
  if (!caseIdPattern.test(caseId)) throw new InputError("LAKDA_ADAPTIVE_CASE_ID is invalid");
  if (!existsSync(configPath)) throw new InputError("real adaptive acceptance config is unavailable");
  if (!existsSync(corpusPath)) throw new InputError("real adaptive acceptance corpus is unavailable");
  return {
    configPath, corpusPath, caseId,
    environment: required("LAKDA_ADAPTIVE_ENVIRONMENT"),
    targetRevision: required("LAKDA_ADAPTIVE_TARGET_REVISION"),
  };
}

async function loadCorpus(path, caseId, assertedTargetRevision) {
  const bytes = await readFile(path);
  let corpus;
  try { corpus = JSON.parse(bytes.toString("utf8")); }
  catch { throw new InputError("adaptive acceptance corpus is not valid JSON"); }
  if (corpus.schemaVersion !== "lakda/adaptive-acceptance-corpus/v1" || typeof corpus.corpusId !== "string" || !corpus.corpusId.trim() || typeof corpus.version !== "string" || !corpus.version.trim() || typeof corpus.targetRevision !== "string" || !corpus.targetRevision.trim() || !Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    throw new InputError("adaptive acceptance corpus contract is invalid");
  }
  if (corpus.targetRevision !== assertedTargetRevision) throw new InputError("target revision does not match immutable corpus");
  const caseIds = new Set();
  for (const entry of corpus.cases) {
    if (!caseIdPattern.test(entry?.caseId) || caseIds.has(entry.caseId) || !acceptanceIdPattern.test(entry.acceptanceId) || typeof entry.configDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(entry.configDigest) || !outcomeValues.has(entry.expected?.outcome)) {
      throw new InputError("adaptive acceptance case contract is invalid");
    }
    caseIds.add(entry.caseId);
  }
  const selected = corpus.cases.find(entry => entry.caseId === caseId);
  if (!selected) throw new InputError("requested case is absent from adaptive acceptance corpus");
  await assertJsonSchema(corpus, "adaptive-acceptance-corpus-v1.schema.json", "adaptive acceptance corpus schema", true);
  return { corpus, selected, sha256: digest(bytes) };
}

async function loadTargetManifest() {
  const path = resolve(required("LAKDA_ADAPTIVE_TARGET_MANIFEST"));
  if (!existsSync(path)) throw new InputError("target manifest is unavailable");
  const bytes = await readFile(path);
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); }
  catch { throw new InputError("target manifest is not valid JSON"); }
  await assertJsonSchema(manifest, "lakda-target-manifest-v1.schema.json", "target manifest schema", true);
  if (manifest.status !== "ready") throw new InputError("target manifest remains pending_external");
  return { manifest, sha256: digest(bytes) };
}
function assertTargetManifestMatchesConfig(target, config) {
  const origin = new URL(config.baseUrl).origin;
  const host = new URL(origin).hostname;
  if (target.environment.baseUrlOrigin !== origin) throw new InputError("target manifest origin does not match config");
  if (!target.scope.allowHosts.includes(host) || !config.safety.allowHosts.includes(host)) throw new InputError("target manifest host scope does not match config");
  if (target.settleProfile.policyVersion !== config.adaptive.settlePolicy.policyVersion) throw new InputError("target manifest settle policy does not match config");
  if (canonical(target.settleProfile.readiness ?? null) !== canonical(config.adaptive.settlePolicy.readiness ?? null)) throw new InputError("target manifest readiness does not match config");
  config.adaptive.settlePolicy.networkQuietExclusions = [...target.settleProfile.networkQuietExclusions];
  for (const kind of config.adaptive.safety.allowMutationKinds) if (!target.safety.allowMutationKinds.includes(kind)) throw new InputError("target manifest mutation allowlist does not cover config");
  if (JSON.stringify(config.adaptive.actionContracts ?? []) !== JSON.stringify(target.actionContracts)) throw new InputError("target manifest action contracts do not match config");
}
async function verifyManifest(manifest, result, runDir, assertHateManifest) {
  assertHateManifest(manifest);
  if (manifest.run_id !== result.runId || manifest.run_attempt !== result.attempt) throw new Error("HATE manifest run identity mismatch");
  for (const artifact of manifest.artifacts) {
    const path = resolve(runDir, artifact.path);
    const runRelativePath = relative(runDir, path);
    if (runRelativePath.startsWith("..") || isAbsolute(runRelativePath)) throw new Error("HATE manifest contains an out-of-run artifact path");
    const bytes = await readFile(path);
    if ((await stat(path)).size !== artifact.size_bytes || digest(bytes) !== artifact.sha256) throw new Error(`HATE artifact digest mismatch: ${artifact.path}`);
  }
}

async function main() {
  const input = loadInputs();
  const corpusRecord = await loadCorpus(input.corpusPath, input.caseId, input.targetRevision);
  const configBytes = await readFile(input.configPath);
  if (digest(configBytes) !== corpusRecord.selected.configDigest) throw new InputError("config digest does not match immutable corpus case");
  const targetManifest = await loadTargetManifest();
  const [{ loadConfig }, { runLakda }, { assertHateManifest, exportHate }, { writeJsonAtomic }] = await Promise.all([
    import("../dist/core/config.js"), import("../dist/core/runner.js"), import("../dist/core/hate.js"), import("../dist/core/artifact-store.js"),
  ]);
  const config = loadConfig(input.configPath);
  if (config.mode !== "adaptive-explore" || !config.baseUrl) throw new InputError("real adaptive acceptance requires mode=adaptive-explore and baseUrl");
  assertTargetManifestMatchesConfig(targetManifest.manifest, config);
  const result = await runLakda(config);
  if (!result.artifactManifestPath) throw new Error("real adaptive acceptance requires a HATE manifest");
  const manifestPath = resolve(result.artifactManifestPath);
  const runDir = dirname(dirname(manifestPath));
  const initialManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await verifyManifest(initialManifest, result, runDir, assertHateManifest);
  const oracleResultRefs = initialManifest.artifacts.filter(artifact => artifact.path === "adaptive/oracle-results.jsonl");
  if (oracleResultRefs.length !== 1) throw new Error("real adaptive acceptance requires exactly one OracleResult artifact");
  const passed = result.outcome === corpusRecord.selected.expected.outcome;
  const reportPath = resolve(runDir, "adaptive", `acceptance-case-${input.caseId}.json`);
  const report = {
    schemaVersion: "lakda/adaptive-acceptance-case/v1", acceptanceId: corpusRecord.selected.acceptanceId, caseId: input.caseId,
    runId: result.runId, attempt: result.attempt, revision: corpusRecord.corpus.targetRevision, runnerRevision: initialManifest.commit_sha,
    executionMode: "real", environment: { label: input.environment, origin: new URL(config.baseUrl).origin, adapterId: config.adaptive.adapter.id },
    runtime: { nodeVersion: process.version, platform: process.platform, arch: process.arch },
    seed: config.seed, configDigest: digest(configBytes), targetManifest: { manifestId: targetManifest.manifest.manifestId, sha256: targetManifest.sha256 }, corpus: { corpusId: corpusRecord.corpus.corpusId, version: corpusRecord.corpus.version, sha256: corpusRecord.sha256, targetRevision: corpusRecord.corpus.targetRevision, caseConfigDigest: corpusRecord.selected.configDigest },
    expected: corpusRecord.selected.expected, actual: { outcome: result.outcome, terminationReason: result.terminationReason, exitCode: result.exitCode },
    oracleResultRefs, artifactRefs: initialManifest.artifacts, verdict: passed ? "passed" : "failed", ineligibilityReason: passed ? null : "outcome_mismatch",
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false }, generatedAt: new Date().toISOString(),
  };
  await assertJsonSchema(report, "adaptive-acceptance-case-v1.schema.json", "adaptive acceptance case report schema", false);
  await writeJsonAtomic(reportPath, report);
  await exportHate(runDir, manifestPath);
  const finalManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await verifyManifest(finalManifest, result, runDir, assertHateManifest);
  if (!finalManifest.artifacts.some(artifact => resolve(runDir, artifact.path) === reportPath)) throw new Error("acceptance case report is absent from final HATE manifest");
  console.log(JSON.stringify({ caseReportPath: reportPath, artifactManifestPath: manifestPath, acceptanceId: report.acceptanceId, caseId: report.caseId, verdict: report.verdict }));
  process.exitCode = passed ? 0 : 2;
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : "real adaptive acceptance failed");
  process.exitCode = error instanceof InputError ? 2 : 1;
}
