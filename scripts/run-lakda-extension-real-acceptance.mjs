import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

class InputError extends Error {}
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const caseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function pending(reason) { console.error(JSON.stringify({ schemaVersion: "lakda/extension-acceptance-pending/v1", status: "pending_external", reason, qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false } })); process.exitCode = 2; }
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new InputError(name + " is required"); return value; }
function requiredAny(names) { for (const name of names) { const value = process.env[name]?.trim(); if (value) return value; } throw new InputError(names.join(" or ") + " is required"); }
async function json(path, label) { let bytes; try { bytes = await readFile(path); } catch { throw new InputError(label + " is unavailable"); } try { return { bytes, value: JSON.parse(bytes.toString("utf8")) }; } catch { throw new InputError(label + " is invalid JSON"); } }
async function validateCorpus(value) {
  const schema = JSON.parse(await readFile(resolve(root, "schemas", "lakda-extension-acceptance-corpus-v1.schema.json"), "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false }); const validate = ajv.compile(schema);
  if (!validate(value)) throw new InputError("extension acceptance corpus contract is invalid: " + ajv.errorsText(validate.errors));
}
function loadInputs() {
  if (process.env.LAKDA_EXTENSION_REAL_CONFIRM !== "I_UNDERSTAND") throw new InputError("LAKDA_EXTENSION_REAL_CONFIRM=I_UNDERSTAND is required");
  const configPath = resolve(requiredAny(["LAKDA_EXTENSION_REAL_CONFIG", "LAKDA_EXTENSION_REAL_CONFIG_PATH"])); const corpusPath = resolve(requiredAny(["LAKDA_EXTENSION_REAL_CORPUS", "LAKDA_EXTENSION_REAL_CORPUS_PATH"])); const caseId = required("LAKDA_EXTENSION_REAL_CASE_ID");
  if (!caseIdPattern.test(caseId)) throw new InputError("case ID is invalid");
  if (!existsSync(configPath) || !existsSync(corpusPath)) throw new InputError("real extension environment input is unavailable");
  return { configPath, corpusPath, caseId, environment: required("LAKDA_EXTENSION_REAL_ENVIRONMENT"), targetRevision: required("LAKDA_EXTENSION_REAL_TARGET_REVISION") };
}
async function manifestRefs(manifestPath, runDir) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const refs = [];
  for (const artifact of manifest.artifacts ?? []) {
    const path = resolve(runDir, artifact.path); const rel = relative(runDir, path);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("HATE artifact path escapes run directory");
    const bytes = await readFile(path); if (artifact.size_bytes !== bytes.length || artifact.sha256 !== digest(bytes)) throw new Error("HATE artifact digest mismatch: " + artifact.path);
    refs.push({ path: artifact.path, sha256: artifact.sha256, size: artifact.size_bytes });
  }
  return { manifest, refs };
}
async function main() {
  let input; try { input = loadInputs(); } catch (error) { pending(error.message); return; }
  let corpusRecord; try { corpusRecord = await json(input.corpusPath, "corpus"); await validateCorpus(corpusRecord.value); } catch (error) { pending(error.message); return; }
  const corpus = corpusRecord.value; if (corpus.targetRevision !== input.targetRevision) { pending("target revision does not match immutable corpus"); return; }
  const selected = corpus.cases.find(entry => entry.caseId === input.caseId); if (!selected) { pending("case is absent from immutable corpus"); return; }
  const configRecord = await json(input.configPath, "config"); if (digest(configRecord.bytes) !== selected.configDigest) { pending("config digest does not match immutable corpus case"); return; }
  let config, result;
  try {
    const [{ loadConfig }, { runLakda }] = await Promise.all([import("../dist/core/config.js"), import("../dist/core/runner.js")]);
    config = loadConfig(input.configPath); if (!config.baseUrl || !config.adaptive) throw new InputError("real extension acceptance requires adaptive config and baseUrl");
    result = await runLakda(config);
  } catch (error) { pending(error instanceof Error ? error.message : "real execution failed"); return; }
  if (!result.artifactManifestPath) { pending("real execution did not produce HATE manifest"); return; }
  const manifestPath = resolve(result.artifactManifestPath); const runDir = dirname(dirname(manifestPath));
  const initial = await manifestRefs(manifestPath, runDir);
  const oracleResultRefs = initial.refs.filter(ref => ref.path === "adaptive/oracle-results.jsonl");
  if (oracleResultRefs.length !== 1) throw new Error("exactly one OracleResult artifact is required");
  const reportPath = resolve(runDir, "adaptive", "extension-acceptance-case-" + input.caseId + ".json");
  const report = {
    schemaVersion: "lakda/extension-acceptance-case/v1", acceptanceId: "AC-LX-014", caseId: input.caseId, runId: result.runId, attempt: result.attempt,
    revision: input.targetRevision, configDigest: selected.configDigest, executionMode: "real",
    environment: { label: input.environment, origin: new URL(config.baseUrl).origin, adapterId: config.adaptive.adapter.id },
    corpus: { corpusId: corpus.corpusId, version: corpus.version, sha256: digest(corpusRecord.bytes), targetRevision: corpus.targetRevision, caseConfigDigest: selected.configDigest },
    expected: selected.expected, actual: { outcome: result.outcome, terminationReason: result.terminationReason, exitCode: result.exitCode },
    oracleResultRefs, hateArtifactRefs: initial.refs, artifactManifestPath: relative(runDir, manifestPath).replaceAll("\\", "/"),
    verdict: result.outcome === selected.expected.outcome ? "passed" : "failed", qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false }, generatedAt: new Date().toISOString(),
  };
  const schema = JSON.parse(await readFile(resolve(root, "schemas", "lakda-extension-acceptance-case-v1.schema.json"), "utf8")); const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false }); const validate = ajv.compile(schema);
  if (!validate(report)) throw new Error("extension case report schema invalid: " + ajv.errorsText(validate.errors));
  const { writeJsonAtomic } = await import("../dist/core/artifact-store.js"); await writeJsonAtomic(reportPath, report);
  const { exportHate } = await import("../dist/core/hate.js"); await exportHate(runDir, manifestPath);
  const final = await manifestRefs(manifestPath, runDir); const reportRef = final.refs.find(ref => ref.path === relative(runDir, reportPath).replaceAll("\\", "/"));
  if (!reportRef) throw new Error("extension case report is absent from final HATE manifest");
  console.log(JSON.stringify({ status: "pending_external", caseReportPath: reportPath, artifactManifestPath: manifestPath, caseId: input.caseId, verdict: report.verdict }));
  process.exitCode = report.verdict === "passed" ? 0 : 2;
}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "extension real acceptance failed"); process.exitCode = error instanceof InputError ? 2 : 1; }