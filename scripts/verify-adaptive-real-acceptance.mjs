import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

class InputError extends Error {}
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedAcceptanceIds = ["AC-AE-001", "AC-AE-002", "AC-AE-003", "AC-AE-004", "AC-AE-005", "AC-AE-006", "AC-AE-007", "AC-AE-008", "AC-AE-009", "AC-AE-010", "AC-AE-011", "AC-AE-012", "AC-AE-013", "AC-AE-014", "AC-AE-015", "AC-AE-016"];
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new InputError("P7 suite verification requires " + name);
  return value;
}

function assertValid(validate, value, label, ajv) {
  if (validate(value)) return;
  throw new InputError(label + " is invalid: " + ajv.errorsText(validate.errors, { separator: "; " }));
}

async function readJson(path, label) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw new InputError(label + " is unavailable");
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    throw new InputError(label + " is not valid JSON");
  }
}

async function validators() {
  const [indexSchema, reportSchema, readinessSchema, hateSchema] = await Promise.all([
    readFile(resolve(repositoryRoot, "schemas", "adaptive-acceptance-suite-index-v1.schema.json"), "utf8").then(JSON.parse),
    readFile(resolve(repositoryRoot, "schemas", "adaptive-acceptance-case-v1.schema.json"), "utf8").then(JSON.parse),
    readFile(resolve(repositoryRoot, "schemas", "adaptive-acceptance-suite-readiness-v1.schema.json"), "utf8").then(JSON.parse),
    readFile(resolve(repositoryRoot, "vendor", "hate", "v1", "artifact-manifest.schema.json"), "utf8").then(JSON.parse),
  ]);
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(hateSchema);
  return {
    ajv,
    index: ajv.compile(indexSchema),
    report: ajv.compile(reportSchema),
    readiness: ajv.compile(readinessSchema),
    hate: ajv.getSchema(hateSchema.$id),
  };
}

async function verifyManifest(manifest, report, runDir, reportPath, reportBytes, validateHate, ajv) {
  assertValid(validateHate, manifest, "HATE manifest", ajv);
  if (manifest.run_id !== report.runId || manifest.run_attempt !== report.attempt || manifest.commit_sha !== report.runnerRevision) {
    throw new InputError("HATE manifest identity does not match case report");
  }
  const byPath = new Map();
  for (const artifact of manifest.artifacts) {
    if (byPath.has(artifact.path)) throw new InputError("HATE manifest contains duplicate artifact paths");
    const path = resolve(runDir, artifact.path);
    const artifactRelativePath = relative(runDir, path);
    if (artifactRelativePath.startsWith("..") || isAbsolute(artifactRelativePath)) throw new InputError("HATE artifact path escapes its declared root");
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      throw new InputError("HATE artifact is unavailable: " + artifact.path);
    }
    if ((await stat(path)).size !== artifact.size_bytes || digest(bytes) !== artifact.sha256) {
      throw new InputError("HATE artifact digest mismatch: " + artifact.path);
    }
    byPath.set(artifact.path, artifact);
  }
  const reportRelativePath = relative(runDir, reportPath).replaceAll("\\", "/");
  const reportArtifact = byPath.get(reportRelativePath);
  if (!reportArtifact || reportArtifact.sha256 !== digest(reportBytes) || reportArtifact.size_bytes !== reportBytes.length) {
    throw new InputError("case report is not bound to the final HATE manifest");
  }
  for (const ref of [...report.artifactRefs, ...report.oracleResultRefs]) {
    const finalRef = byPath.get(ref.path);
    if (!finalRef || finalRef.sha256 !== ref.sha256 || finalRef.size_bytes !== ref.size_bytes) {
      throw new InputError("case report artifact ref does not match final HATE manifest: " + ref.path);
    }
  }
}

async function main() {
  const indexPath = resolve(required("LAKDA_ADAPTIVE_SUITE_INDEX"));
  if (!existsSync(indexPath)) throw new InputError("P7 suite index is unavailable");
  const indexRoot = dirname(indexPath);
  const checks = await validators();
  const indexRecord = await readJson(indexPath, "P7 suite index");
  assertValid(checks.index, indexRecord.value, "P7 suite index", checks.ajv);

  const acceptanceIds = new Set();
  const caseIds = new Set();
  const reportPaths = new Set();
  for (const entry of indexRecord.value.reports) {
    const reportPath = resolve(indexRoot, entry.path);
    const reportRelativeToIndex = relative(indexRoot, reportPath);
    if (reportRelativeToIndex.startsWith("..") || isAbsolute(reportRelativeToIndex)) throw new InputError("case report path escapes its declared root");
    const canonicalReportPath = reportPath.toLowerCase();
    if (reportPaths.has(canonicalReportPath)) throw new InputError("P7 suite index contains a duplicate report path");
    reportPaths.add(canonicalReportPath);
    const reportRecord = await readJson(reportPath, "case report");
    if (digest(reportRecord.bytes) !== entry.sha256) throw new InputError("case report digest mismatch: " + entry.path);
    assertValid(checks.report, reportRecord.value, "case report", checks.ajv);
    const report = reportRecord.value;
    if (caseIds.has(report.caseId)) throw new InputError("P7 suite contains a duplicate case ID: " + report.caseId);
    caseIds.add(report.caseId);
    if (report.verdict !== "passed" || report.ineligibilityReason !== null) throw new InputError("P7 suite contains an ineligible case: " + report.caseId);
    if (report.revision !== report.corpus.targetRevision || report.configDigest !== report.corpus.caseConfigDigest) {
      throw new InputError("case report revision/config binding is inconsistent: " + report.caseId);
    }
    const runDir = dirname(dirname(reportPath));
    const manifestPath = join(runDir, "exports", "artifact-manifest.json");
    const manifestRecord = await readJson(manifestPath, "HATE manifest");
    await verifyManifest(manifestRecord.value, report, runDir, reportPath, reportRecord.bytes, checks.hate, checks.ajv);
    acceptanceIds.add(report.acceptanceId);
  }

  const missing = expectedAcceptanceIds.filter(id => !acceptanceIds.has(id));
  if (missing.length) throw new InputError("suite is missing acceptance IDs: " + missing.join(", "));
  const readiness = {
    schemaVersion: "lakda/adaptive-acceptance-suite-readiness/v1",
    suiteId: indexRecord.value.suiteId,
    version: indexRecord.value.version,
    indexDigest: digest(indexRecord.bytes),
    reportCount: indexRecord.value.reports.length,
    acceptanceIds: [...acceptanceIds].sort(),
    status: "ready_for_manual_bb_qeg",
    p7Status: "pending_external",
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
  };
  if (!checks.readiness(readiness)) throw new Error("suite readiness contract is invalid: " + checks.ajv.errorsText(checks.readiness.errors));
  console.log(JSON.stringify(readiness));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "P7 suite verification failed");
  process.exitCode = error instanceof InputError ? 2 : 1;
}
