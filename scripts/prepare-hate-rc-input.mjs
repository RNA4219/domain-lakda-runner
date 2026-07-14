import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function flag(name, fallback) {
  return process.argv.slice(2).find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3) ?? fallback;
}

const required = ["junit", "lcov", "findings", "revision", "run-id", "actor", "ref", "out"];
const values = Object.fromEntries(required.map(name => [name, flag(name)]));
const missing = required.filter(name => !values[name]);
if (missing.length) throw new Error("不足している引数: " + missing.join(", "));
if (!/^[0-9a-f]{40}$/i.test(values.revision)) throw new Error("revisionは40桁Git SHAが必要です");

const findings = JSON.parse(await readFile(resolve(values.findings), "utf8"));
if (findings.completeness !== "complete") throw new Error("Code-to-gate findingsが不完全です");
const findingsRevision = findings.repo?.revision;
if (typeof findingsRevision !== "string" || !/^[0-9a-f]{7,40}$/i.test(findingsRevision) || !values.revision.startsWith(findingsRevision)) throw new Error("Code-to-gate findingsのrevision不一致");
const blocking = (findings.findings ?? []).filter(value => ["critical", "high"].includes(value.severity));
if (blocking.length) throw new Error("Critical/High findingがHATE handoff前に残っています");

const root = resolve(values.out);
const p0aInput = join(root, "p0a-input");
const p0bFixture = join(root, "p0b-fixture");
await mkdir(p0aInput, { recursive: true });
await mkdir(p0bFixture, { recursive: true });
await copyFile(resolve(values.junit), join(p0aInput, "junit.xml"));
await copyFile(resolve(values.lcov), join(p0aInput, "lcov.info"));
const now = flag("created-at", new Date().toISOString());
const context = {
  repository: flag("repository", "RNA4219/domain-lakda-runner"),
  workflow: "release-evidence.yml",
  job: "release-gate",
  event_name: "workflow_dispatch",
  run_id: values["run-id"],
  run_attempt: Number(flag("run-attempt", "1")),
  commit_sha: values.revision,
  base_sha: flag("base-revision", values.revision),
  started_at: flag("started-at", now),
  finished_at: now,
  actor: values.actor,
  ref: values.ref,
};
await writeFile(join(p0aInput, "github-context.json"), JSON.stringify(context, null, 2) + "\n", "utf8");

const changedEntities = [];
const risks = [];
for (const finding of findings.findings ?? []) {
  const evidence = finding.evidence?.[0];
  if (!evidence?.path || !Number.isInteger(evidence.startLine) || !Number.isInteger(evidence.endLine)) throw new Error("finding evidenceがHATE変換できません: " + finding.fingerprint);
  const riskId = "risk-" + finding.fingerprint;
  changedEntities.push({ entity_id: "changed-" + finding.fingerprint, path: evidence.path.replaceAll("\\", "/"), ranges: [{ start_line: evidence.startLine, end_line: evidence.endLine }], risk_refs: [riskId] });
  risks.push({ risk_id: riskId, severity: finding.severity, title: finding.title, required_test_layers: ["system"], source_refs: [`${evidence.path.replaceAll("\\", "/")}#L${evidence.startLine}-L${evidence.endLine}`] });
}
const handoff = { schema_version: "HATE/v1", source_tool: "code-to-gate", commit_sha: values.revision, changed_entities: changedEntities, risks, test_obligations: [] };
await writeFile(join(p0bFixture, "diff-risk-test.json"), JSON.stringify(handoff, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ schemaVersion: "lakda/hate-rc-input/v1", p0aInput, p0bFixture, findings: findings.findings?.length ?? 0 }));