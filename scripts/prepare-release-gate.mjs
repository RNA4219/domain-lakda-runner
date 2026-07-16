import { resolve } from "node:path";
import { assembleReleaseQegInput } from "./release-gate-evidence.mjs";

function flag(name) {
  return process.argv.slice(2).find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3);
}

const required = ["revision", "release-version", "staging-origin", "full-report", "full-bundle", "worker-report", "worker-bundle", "manual-record", "rand-audit", "reference-staging", "ctg-readiness", "ctg-triage", "ctg-qeg", "hate-bundle", "hate-upstream", "approver", "out"];
const values = Object.fromEntries(required.map(name => [name, flag(name)]));
const missing = required.filter(name => !values[name]);
if (missing.length) throw new Error("不足している引数: " + missing.join(", "));

const result = await assembleReleaseQegInput({
  revision: values.revision,
  releaseVersion: values["release-version"],
  stagingOrigin: values["staging-origin"],
  fullReport: resolve(values["full-report"]),
  fullBundle: resolve(values["full-bundle"]),
  workerReport: resolve(values["worker-report"]),
  workerBundle: resolve(values["worker-bundle"]),
  manualRecord: resolve(values["manual-record"]),
  randAudit: resolve(values["rand-audit"]),
  referenceStaging: resolve(values["reference-staging"]),
  ctgReadiness: resolve(values["ctg-readiness"]),
  ctgTriage: resolve(values["ctg-triage"]),
  ctgQeg: resolve(values["ctg-qeg"]),
  hateBundle: resolve(values["hate-bundle"]),
  hateUpstream: resolve(values["hate-upstream"]),
  approver: values.approver,
  workflowUrl: flag("workflow-url"),
  createdAt: flag("created-at"),
  outDir: resolve(values.out),
});
console.log(JSON.stringify({ schemaVersion: "lakda/release-gate-preparation/v2", status: "ready-for-qeg", qegInput: result.output, chainEvidenceHash: result.chainEvidenceHash, finalVerdictAuthority: "qeg" }, null, 2));
