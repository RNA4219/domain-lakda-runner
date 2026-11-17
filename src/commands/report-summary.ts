import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { findSensitive } from "../core/redaction.js";
import { stringFlag, type Flags } from "../cli/parser.js";

type Counts = Record<"passed" | "failed" | "partial" | "error", number>;
const empty = (): Counts => ({ passed: 0, failed: 0, partial: 0, error: 0 });
const isOutcome = (v: unknown): v is keyof Counts => typeof v === "string" && ["passed", "failed", "partial", "error"].includes(v);
function assertClean(value: unknown): void {
  if (findSensitive(JSON.stringify(value)).length) throw new Error("summary contains secret/PII; output refused");
}
async function loadJson(file: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid JSON object: " + file);
  return value as Record<string, unknown>;
}
async function collect(root: string) {
  const counts = empty(); let runs = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const location = join(root, entry.name);
    let metadata: Record<string, unknown>;
    try { metadata = await loadJson(join(location, "run-metadata.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!isOutcome(metadata.outcome)) throw new Error("unknown run outcome: " + location);
    counts[metadata.outcome]++; runs++;

  }
  return { runs, counts };
}

/** Exploration reports are archived in .lakda/explorations/<sessionId>/report.json,
 * not in .lakda/runs/<runId>. Never infer them from a run outcome. */
async function collectExplorationReports(root: string): Promise<{ findingCount: number; severities: Record<string, number> }> {
  let findingCount = 0;
  const severities: Record<string, number> = {};
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let report: Record<string, unknown>;
    try { report = await loadJson(join(root, entry.name, "report.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (report.schemaVersion !== "lakda/exploration-report/v1" || !Array.isArray(report.findings)) {
      throw new Error("Invalid saved exploration report: " + entry.name);
    }
    findingCount += report.findings.length;
    for (const item of report.findings) {
      if (!item || typeof item !== "object" || !["info", "warning", "major", "critical"].includes(String(item.severity))) {
        throw new Error("Invalid saved exploration finding: " + entry.name);
      }
      const severity = String(item.severity);
      severities[severity] = (severities[severity] ?? 0) + 1;
    }
  }
  return { findingCount, severities };
}
export async function reportSummaryCommand(flags: Flags): Promise<number> {
  const root = resolve(stringFlag(flags, "runs-dir", true)!);
  const destination = resolve(stringFlag(flags, "out", true)!);
  const format = stringFlag(flags, "format") ?? (destination.endsWith(".json") ? "json" : "md");
  if (format !== "md" && format !== "json") throw new Error("--format must be md or json");
  const sessions = resolve(stringFlag(flags, "sessions-dir") ?? join(root, "..", "explorations"));
  const result = { ...await collect(root), ...await collectExplorationReports(sessions) };
  const baseDir = stringFlag(flags, "base-runs-dir");
  const base = baseDir ? { ...await collect(resolve(baseDir)), ...await collectExplorationReports(resolve(baseDir, "..", "explorations")) } : undefined;
  const diff = base ? Object.fromEntries(Object.keys(result.counts).map(key => [key, result.counts[key as keyof Counts] - base.counts[key as keyof Counts]])) : undefined;
  const data = { schemaVersion: "lakda/report-summary/v1", targetRevision: stringFlag(flags, "target-revision") ?? "unspecified", ...result,
    ...(diff ? { delta: { runs: result.runs - base!.runs, counts: diff, findings: result.findingCount - base!.findingCount } } : {}),
    reportsDir: stringFlag(flags, "reports-dir") ?? ".lakda/reports", gate: "external-qeg-required" };
  assertClean(data);
  const output = format === "json" ? JSON.stringify(data, null, 2) + "\n" :
    ["# Lakda run summary", "", "Target revision: " + data.targetRevision,
      "Runs: " + data.runs, ...Object.entries(data.counts).map(([key, value]) => key + ": " + value),
      "Findings: " + data.findingCount, ...Object.entries(data.severities).map(([key, value]) => "Finding " + key + ": " + value),
      "Reports: " + data.reportsDir, ...(data.delta ? ["Difference: " + JSON.stringify(data.delta)] : []),
      "Gate: external-qeg-required (Lakda is not a Go/No-Go decision)", ""].join("\n");
  assertClean(output);
  // Output file is new-only. Never replace an existing summary.
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ output: destination, ...result }));
  return 0;
}
