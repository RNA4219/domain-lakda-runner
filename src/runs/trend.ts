/** Read-only, verified cross-run trend aggregation; not a Gate verdict. */
import { readFile, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { showRun } from "./catalog.js";
import { readManifestSnapshot } from "./manifest-snapshot.js";
import { hateArtifact } from "./catalog-values.js";
import { findSensitive } from "../core/redaction.js";

export type TrendEntry = {
  runRef: string;
  scenarioId: string;
  caseRevision: string;
  environment: string;
  browser: "chromium";
  evidenceKind: "real" | "fixture" | "mock" | "emulator" | "unknown";
};
export type TrendRun = TrendEntry & {
  runId: string;
  attempt: number;
  outcome: "passed" | "failed" | "partial" | "error";
  startedAt: string;
  endedAt: string;
  manifestSha256: string;
  durationMs: number | null;
};
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function safeKey(value: unknown, name: string): asserts value is string {
  requireValue(typeof value === "string" && keyPattern.test(value), "invalid " + name);
}
function validDuration(start: string, end: string): number | null {
  const a = Date.parse(start), b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}
function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
function safeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function within(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

export function summarizeTrend(runs: readonly TrendRun[]) {
  const groups = new Map<string, TrendRun[]>();
  for (const run of runs) {
    const key = [run.scenarioId, run.caseRevision, run.environment, run.browser, run.evidenceKind];
    const groupKey = JSON.stringify(key);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), run]);
  }
  const series = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([groupKey, entries]) => {
    const [scenarioId, caseRevision, environment, browser, evidenceKind] = JSON.parse(groupKey) as string[];
    const completed = entries.filter(run => run.outcome === "passed" || run.outcome === "failed");
    const passed = completed.filter(run => run.outcome === "passed").length;
    const failed = completed.length - passed;
    const partial = entries.filter(run => run.outcome === "partial").length;
    const errors = entries.filter(run => run.outcome === "error").length;
    const durations = entries.map(run => run.durationMs).filter((n): n is number => n !== null);
    const samples = [...entries].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));
    return {
      scenarioId, caseRevision, environment, browser, evidenceKind,
      total: entries.length, passed, failed, partial, errors,
      evaluated: completed.length, successRate: completed.length ? passed / completed.length : null,
      flakyCandidate: passed > 0 && failed > 0,
      duration: {
        count: durations.length,
        medianMs: percentile(durations, .5),
        p95Ms: durations.length >= 20 ? percentile(durations, .95) : null,
      },
      runs: samples.map(run => ({
        runId: run.runId, attempt: run.attempt, runRef: run.runRef,
        outcome: run.outcome, startedAt: run.startedAt,
        manifestSha256: run.manifestSha256, durationMs: run.durationMs,
      })),
    };
  });
  return { schemaVersion: "lakda/cross-run-trend/v1" as const, scope: "local-verified-runs", gate: "external-qeg-required", series };
}

export async function generateTrend(indexPath: string, runsDir: string, outDir: string): Promise<ReturnType<typeof summarizeTrend>> {
  const source = JSON.parse(await readFile(indexPath, "utf8")) as unknown;
  requireValue(!!source && typeof source === "object" && !Array.isArray(source), "invalid index");
  const index = source as Record<string, unknown>;
  requireValue(index.schemaVersion === "lakda/trend-index/v1" && Array.isArray(index.runs) && index.runs.length <= 1000,
    "invalid or oversized index");
  const root = await realpath(resolve(runsDir));
  requireValue((await stat(root)).isDirectory(), "runs root is not a directory");
  const target = resolve(outDir);
  requireValue(!within(root, target), "trend output must not modify run storage");
  const seen = new Set<string>();
  const rows: TrendRun[] = [];
  for (const raw of index.runs) {
    requireValue(!!raw && typeof raw === "object" && !Array.isArray(raw), "invalid run record");
    const entry = raw as Record<string, unknown>;
    for (const field of ["runRef", "scenarioId", "caseRevision", "environment"]) safeKey(entry[field], field);
    requireValue(entry.browser === "chromium", "unsupported browser");
    requireValue(["real", "fixture", "mock", "emulator", "unknown"].includes(String(entry.evidenceKind)),
      "unsupported evidence kind");
    const runRef = entry.runRef as string;
    requireValue(!isAbsolute(runRef) && basename(runRef) === runRef && runRef !== "." && runRef !== "..", "invalid run reference");
    const runDir = await realpath(join(root, runRef));
    requireValue(within(root, runDir), "run reference escapes storage root");
    const detail = await showRun(runDir);
    const verified = await readManifestSnapshot(runDir, { retain: ref => ref === "run-metadata.json", policy: hateArtifact });
    const metadataBytes = verified.snapshots.get("run-metadata.json")?.bytes;
    requireValue(!!metadataBytes, "run metadata is unverified");
    const metadata = JSON.parse(metadataBytes.toString("utf8")) as Record<string, unknown>;
    const identity = detail.run.runId + ":" + String(metadata.attempt);
    requireValue(!seen.has(identity), "duplicate run identity");
    seen.add(identity);
    // Caller labeling cannot elevate a fixture or unknown run into verified real evidence.
    requireValue(entry.evidenceKind !== "real" || metadata.executionMode === "real",
      "real classification lacks explicit real execution evidence");
    requireValue(detail.integrity.manifestSha256 === verified.manifestSha256, "run changed during inspection");
    const row: TrendRun = {
      runRef, scenarioId: entry.scenarioId as string, caseRevision: entry.caseRevision as string,
      environment: entry.environment as string, browser: "chromium",
      evidenceKind: entry.evidenceKind as TrendRun["evidenceKind"],
      runId: detail.run.runId, attempt: Number(metadata.attempt), outcome: detail.run.outcome,
      startedAt: detail.run.startedAt, endedAt: detail.run.endedAt,
      manifestSha256: detail.integrity.manifestSha256,
      durationMs: validDuration(detail.run.startedAt, detail.run.endedAt),
    };
    rows.push(row);
  }
  const output = summarizeTrend(rows);
  requireValue(findSensitive(JSON.stringify(output)).length === 0, "trend contains sensitive data");
  const html = '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Lakda cross-run trends</title>' +
    '<h1>Lakda cross-run trends</h1><p>Machine-verified local runs only. No Gate decision.</p>' +
    '<table border="1"><thead><tr><th>Scenario</th><th>Revision</th><th>Environment</th><th>Evidence</th>' +
    '<th>Passed / Evaluated</th><th>Partial</th><th>Error</th><th>Flaky candidate</th><th>Median ms</th><th>P95 ms</th></tr></thead><tbody>' +
    output.series.map(group => '<tr>' + [
      group.scenarioId, group.caseRevision, group.environment, group.evidenceKind,
      String(group.passed) + " / " + String(group.evaluated), String(group.partial),
      String(group.errors), group.flakyCandidate ? "candidate" : "no",
      String(group.duration.medianMs ?? "n/a"), String(group.duration.p95Ms ?? "n/a"),
    ].map(cell => '<td>' + safeHtml(cell) + '</td>').join("") + '</tr>').join("") + '</tbody></table></html>\n';
  await mkdir(target, { recursive: false });
  await writeFile(join(target, "trend.json"), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(target, "index.html"), html, { flag: "wx" });
  return output;
}
