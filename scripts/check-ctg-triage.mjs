import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

function flag(name, fallback) {
  return process.argv.slice(2).find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3) ?? fallback;
}

const findingsPath = resolve(flag("findings", ".qh/findings.json"));
const triagePath = resolve(flag("triage", ".ctg/finding-triage.json"));
const outputPath = flag("out") ? resolve(flag("out")) : undefined;
const findingsBytes = await readFile(findingsPath);
const triageBytes = await readFile(triagePath);
const findingsArtifact = JSON.parse(findingsBytes.toString("utf8"));
const triage = JSON.parse(triageBytes.toString("utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");
if (triage.schemaVersion !== "lakda/ctg-finding-triage/v1" || !Array.isArray(triage.entries)) throw new Error("triage schemaが不正です");
if (new Set(triage.entries.map(entry => entry.fingerprint)).size !== triage.entries.length) throw new Error("triage fingerprintが重複しています");
const findings = findingsArtifact.findings ?? [];
const blocking = findings.filter(finding => finding.severity === "critical" || finding.severity === "high");
if (blocking.length) throw new Error("unresolved Critical/Highがあります: " + blocking.map(finding => finding.fingerprint).join(","));
const medium = findings.filter(finding => finding.severity === "medium");
const byFingerprint = new Map(triage.entries.map(entry => [entry.fingerprint, entry]));
const today = new Date().toISOString().slice(0, 10);
for (const finding of medium) {
  const entry = byFingerprint.get(finding.fingerprint);
  const path = finding.evidence?.[0]?.path;
  if (!entry) throw new Error("Medium findingのtriageがありません: " + finding.fingerprint);
  if (entry.ruleId !== finding.ruleId || entry.path !== path) throw new Error("triage identity不一致: " + finding.fingerprint);
  if (!entry.owner || !entry.rationale || !["accepted-design", "planned-refactor"].includes(entry.disposition)) throw new Error("triage根拠が不足しています: " + finding.fingerprint);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) || entry.dueDate < today) throw new Error("triage期限が失効しています: " + finding.fingerprint);
}
const activeFingerprints = new Set(medium.map(finding => finding.fingerprint));
const stale = triage.entries.filter(entry => !activeFingerprints.has(entry.fingerprint));
if (stale.length) throw new Error("stale triageがあります: " + stale.map(entry => entry.fingerprint).join(","));
const result = {
  schemaVersion: "lakda/ctg-triage-verification/v1",
  status: "passed",
  subjectRevision: findingsArtifact.repo?.revision,
  counts: { critical: 0, high: 0, medium: medium.length, triaged: medium.length, unclassified: 0, stale: 0 },
  inputs: {
    findings: { path: basename(findingsPath), size: findingsBytes.length, sha256: sha256(findingsBytes) },
    triage: { path: basename(triagePath), size: triageBytes.length, sha256: sha256(triageBytes) },
  },
  entries: medium.map(finding => {
    const entry = byFingerprint.get(finding.fingerprint);
    return {
      fingerprint: entry.fingerprint,
      ruleId: entry.ruleId,
      path: entry.path.replaceAll("\\", "/"),
      disposition: entry.disposition,
      owner: entry.owner,
      dueDate: entry.dueDate,
      rationale: entry.rationale,
    };
  }).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
};
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify(result, null, 2));