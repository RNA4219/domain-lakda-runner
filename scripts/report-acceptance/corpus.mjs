import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const digest = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");

/** Artificial stored evidence only: none of these actions is executed. */
export async function createCorpus(root, distribution) {
  if (!["distributed", "concentrated"].includes(distribution)) throw new Error("Unknown corpus distribution");
  await mkdir(join(root, "runs")); // Exclusive input root: never overwrite a previous corpus.
  const entries = [], manifests = [];
  let inputBytes = 0;
  for (let index = 0; index < 100; index += 1) {
    const runId = "benchmark-" + String(index).padStart(3, "0");
    const path = "runs/" + runId, runRoot = join(root, path);
    await mkdir(join(runRoot, "exports"), { recursive: true });
    const actionCount = distribution === "distributed" ? 100 : index === 0 ? 10_000 : 0;
    const failureCount = distribution === "distributed" ? 10 : index === 0 ? 1_000 : 0;
    const startedAt = "2026-09-10T00:00:00.000Z", endedAt = "2026-09-10T00:00:10.000Z";
    const metadata = { schemaVersion: "lakda/run-metadata/v1", runId, attempt: 1, mode: "smoke", seed: index, outcome: failureCount ? "failed" : "passed", terminationReason: failureCount ? "machine_failure" : "completed", startedAt, endedAt, producerVersion: "report-acceptance-fixture", commitSha: "a".repeat(40) };
    const actions = Array.from({ length: actionCount }, (_, i) => ({ id: "action-" + i, kind: "navigate", path: "/" }));
    const executions = actions.map((action, i) => ({ sequence: i + 1, actionId: action.id, kind: action.kind, startedAt: new Date(Date.parse(startedAt) + i).toISOString(), endedAt: new Date(Date.parse(startedAt) + i + 1).toISOString(), durationMs: 1, status: "completed" }));
    const failures = Array.from({ length: failureCount }, (_, i) => ({ failureId: runId + "-failure-" + i, ruleId: "BENCH-" + String(i).padStart(4, "0"), severity: "failure", message: ((i % 2 ? "group-odd " : "group-even ") + "人工保存証跡。長文の折返しを確認します。\n" + "長文".repeat(1100)).slice(0, 2048) }));
    const values = { "run-metadata.json": metadata, "action-sequence.json": { schemaVersion: "lakda/action-plan/v1", mode: "smoke", seed: index, baseUrl: "http://benchmark.invalid", actions }, "action-execution.json": { schemaVersion: "lakda/action-execution/v1", runId, attempt: 1, executions }, "failure-report.json": { failures } };
    const artifacts = [];
    for (const [file, value] of Object.entries(values)) {
      const bytes = Buffer.from(JSON.stringify(value));
      await writeFile(join(runRoot, file), bytes, { flag: "wx" });
      inputBytes += bytes.length;
      artifacts.push({ artifact_id: "lakda:" + artifacts.length, kind: "report", path: file, sha256: digest(bytes), size_bytes: bytes.length, classification: "internal", redaction_status: "not_required", redaction_rule_version: "artificial-fixture/v1", safe_for_summary: true, public_exposure: "none", retention: {}, security_checks: { secrets_scan: "pass", pii_scan: "pass" } });
    }
    const manifest = Buffer.from(JSON.stringify({ schema_version: "HATE/v1", run_id: runId, run_attempt: 1, commit_sha: metadata.commitSha, artifacts }));
    await writeFile(join(runRoot, "exports/artifact-manifest.json"), manifest, { flag: "wx" });
    inputBytes += manifest.length;
    manifests.push({ path: path + "/exports/artifact-manifest.json", sha256: digest(manifest) });
    entries.push({ kind: "run", path });
  }
  const sources = join(root, "sources.json");
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: "lakda/report-sources/v1", root: ".", entries }));
  await writeFile(sources, bytes, { flag: "wx" });
  return { distribution, sources, inputBytes: inputBytes + bytes.length, sourcesSha256: digest(bytes), manifests, runs: 100, actions: 10_000, failures: 1_000, messageCharacters: 2048 };
}
