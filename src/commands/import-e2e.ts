import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringFlag, type Flags } from "../cli/parser.js";
import { writeJsonAtomic, writeVerifiedText } from "../core/artifact-store.js";
import { currentExecutionRevision } from "../core/artifacts.js";
import { buildAndValidateManifest } from "../core/hate.js";
import { reportTimestamp } from "../reporting/source-values.js";
import { object, stringValue } from "../runs/catalog-values.js";
import { importedBrowser, importedMode, scenarioDurations } from "../runs/measurements.js";

/** Project only the public result fields. Caller-supplied execution, approval and artifact fields never enter a run. */
export async function importE2eCommand(flags: Flags, producerVersion: string): Promise<number> {
  const resultPath = stringFlag(flags, "result", true)!;
  const root = resolve(stringFlag(flags, "output-dir", true)!);
  const bytes = await readFile(resultPath, "utf8");
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { throw new Error("invalid E2E result JSON"); }
  const result = object(value, "E2E result");
  const startedAt = reportTimestamp(stringValue(result.generated_at, "generated_at"));
  const rows = result.scenario_results;
  if (!Array.isArray(rows) || !rows.length) throw new Error("scenario_results must contain at least one scenario");
  const durations = scenarioDurations(rows);
  const layer = result.layer === "device" || result.layer === "browser" ? result.layer : "unknown";
  const scenarios = rows.map((row, i) => {
    if (row?.status !== "passed" && row?.status !== "failed") throw new Error("unsupported scenario status");
    const browser = layer === "browser" && (row.layer === undefined || row.layer === "browser") && row.browser === "chromium";
    return { status: row.status as "passed" | "failed", duration_ms: durations[i], ...(browser && { browser: "chromium" }) };
  });
  const measurement = { integration: { layer }, scenario_results: scenarios };
  const outcome = scenarios.some(row => row.status === "failed") ? "failed" : "passed";
  if (result.status !== undefined && result.status !== outcome) throw new Error("inconsistent E2E result status");
  const runId = "lakda:run-" + randomUUID(), runRef = runId.replace(":", "-");
  const endedAt = new Date().toISOString(), commitSha = currentExecutionRevision();
  const metadata = { schemaVersion: "lakda/run-metadata/v1", runId, attempt: 1, mode: importedMode, startedAt, endedAt,
    seed: null, producerVersion, commitSha, outcome, terminationReason: "external-test-" + outcome,
    browser: importedBrowser(measurement), ...measurement };
  const stagingRoot = join(root, ".imports");
  await mkdir(stagingRoot, { recursive: true });
  const stage = await mkdtemp(join(stagingRoot, "run-"));
  try {
    const path = "run-metadata.json";
    const security = await writeVerifiedText(join(stage, path), JSON.stringify(metadata));
    const manifest = await buildAndValidateManifest(stage, runId, 1, commitSha, "internal", { producerVersion, createdAt: endedAt },
      {}, [], [{ path, size: security.size, sha256: security.sha256, security }]);
    await writeJsonAtomic(join(stage, "exports", "artifact-manifest.json"), manifest);
    await rename(stage, join(root, runRef));
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  console.log(JSON.stringify({ runRef, runId, outcome }));
  return 0;
}
