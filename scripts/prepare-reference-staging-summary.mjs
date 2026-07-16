import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { findSensitive } from "../dist/core/redaction.js";

function flag(name) {
  return process.argv.slice(2).find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const required = ["revision", "report", "verification", "out"];
const values = Object.fromEntries(required.map(name => [name, flag(name)]));
const missing = required.filter(name => !values[name]);
if (missing.length) throw new Error("不足している引数: " + missing.join(", "));
if (!/^[0-9a-f]{40}$/i.test(values.revision)) throw new Error("revisionは40桁Git SHAが必要です");

const reportPath = resolve(values.report);
const verificationPath = resolve(values.verification);
const reportBytes = await readFile(reportPath);
const verificationBytes = await readFile(verificationPath);
const report = JSON.parse(reportBytes.toString("utf8"));
const verification = JSON.parse(verificationBytes.toString("utf8"));
if (report?.schemaVersion !== "lakda/extension-acceptance-case/v1" || report.executionMode !== "real" || report.verdict !== "passed") throw new Error("reference staging reportはpassed real caseである必要があります");
if (!report.qegHandoff || report.qegHandoff.status !== "pending_external" || report.qegHandoff.verdictGeneratedByLakda !== false) throw new Error("reference staging reportのQEG責務境界が不正です");
if (verification?.status !== "pending_external" || verification.readiness !== "ready_for_manual_bb_qeg") throw new Error("reference staging verificationがexternal handoff readyではありません");
if (verification.caseId !== report.caseId || verification.acceptanceId !== report.acceptanceId) throw new Error("reference staging verificationのcase参照が一致しません");
const summary = {
  schemaVersion: "lakda/reference-staging-summary/v1",
  status: "ready",
  subjectRevision: values.revision,
  targetRevision: report.revision,
  acceptanceId: report.acceptanceId,
  caseId: report.caseId,
  configDigest: report.configDigest,
  corpus: { corpusId: report.corpus.corpusId, version: report.corpus.version, sha256: report.corpus.sha256, targetRevision: report.corpus.targetRevision },
  report: basename(reportPath),
  reportSha256: sha256(reportBytes),
  verification: basename(verificationPath),
  verificationSha256: sha256(verificationBytes),
};
const text = JSON.stringify(summary, null, 2) + "\n";
if (findSensitive(text).length) throw new Error("reference staging summaryに機微情報が含まれています");
await writeFile(resolve(values.out), text, "utf8");
console.log(JSON.stringify(summary, null, 2));