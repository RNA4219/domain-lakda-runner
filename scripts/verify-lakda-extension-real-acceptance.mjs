import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url); const Ajv = require("ajv/dist/2020").default; const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
function pending(reason) { console.error(JSON.stringify({ schemaVersion: "lakda/extension-acceptance-pending/v1", status: "pending_external", reason, qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false } })); process.exitCode = 2; }
async function main() {
  const reportPath = (process.env.LAKDA_EXTENSION_REAL_REPORT ?? process.env.LAKDA_EXTENSION_REAL_REPORT_PATH)?.trim(); if (!reportPath) { pending("LAKDA_EXTENSION_REAL_REPORT is required"); return; }
  if (!existsSync(reportPath)) { pending("extension case report is unavailable"); return; }
  let report, reportBytes; try { reportBytes = await readFile(reportPath); report = JSON.parse(reportBytes.toString("utf8")); } catch { pending("extension case report is invalid JSON"); return; }
  const schema = JSON.parse(await readFile(resolve(root, "schemas", "lakda-extension-acceptance-case-v1.schema.json"), "utf8")); const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false }); const validate = ajv.compile(schema);
  if (!validate(report)) { pending("extension case report contract is invalid: " + ajv.errorsText(validate.errors)); return; }
  if (report.executionMode !== "real" || report.qegHandoff.status !== "pending_external" || report.qegHandoff.verdictGeneratedByLakda !== false) { pending("report is not eligible for external handoff"); return; }
  const expectedRevision = process.env.LAKDA_EXTENSION_REAL_TARGET_REVISION?.trim(); if (expectedRevision && expectedRevision !== report.revision) { pending("target revision mismatch"); return; }
  const reportAbsolute = resolve(reportPath); const runDir = dirname(dirname(reportAbsolute)); const manifestPath = resolve(runDir, report.artifactManifestPath);
  if (!existsSync(manifestPath)) { pending("HATE manifest is unavailable"); return; }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")); const byPath = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    if (byPath.has(artifact.path)) { pending("HATE manifest contains duplicate artifact path"); return; }
    const path = resolve(runDir, artifact.path); const rel = relative(runDir, path); if (rel.startsWith("..") || isAbsolute(rel)) { pending("HATE artifact path escapes run directory"); return; }
    const bytes = await readFile(path); if (artifact.size_bytes !== bytes.length || artifact.sha256 !== digest(bytes)) { pending("HATE artifact digest mismatch: " + artifact.path); return; }
    byPath.set(artifact.path, { path: artifact.path, sha256: artifact.sha256, size: artifact.size_bytes });
  }
  const reportRelative = relative(runDir, reportAbsolute).replaceAll("\\", "/"); const reportRef = byPath.get(reportRelative);
  if (!reportRef || reportRef.sha256 !== digest(reportBytes) || reportRef.size !== reportBytes.length) { pending("case report is not bound to final HATE manifest"); return; }
  for (const ref of [...report.oracleResultRefs, ...report.hateArtifactRefs]) { const actual = byPath.get(ref.path); if (!actual || actual.sha256 !== ref.sha256 || actual.size !== ref.size) { pending("artifact reference mismatch: " + ref.path); return; } }
  console.log(JSON.stringify({ status: "pending_external", readiness: "ready_for_manual_bb_qeg", caseId: report.caseId, acceptanceId: report.acceptanceId, qegHandoff: report.qegHandoff }));
  process.exitCode = 0;
}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "extension acceptance verification failed"); process.exitCode = 1; }