import { readdir, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectRun, METADATA_REF, type InspectedRun } from "./catalog-reader.js";
import { compareInspectedRuns } from "./catalog-comparison.js";
import { RUN_INDEX_SCHEMA_VERSION, type RunComparison, type RunDetail, type RunIndex } from "./types.js";

const RUN_LIMIT = 100;

async function hasRunMetadata(path: string): Promise<boolean> {
  try {
    return (await stat(resolve(path, METADATA_REF))).isFile();
  } catch {
    return false;
  }
}

export async function listRuns(outputDir: string): Promise<RunIndex> {
  const root = await realpath(resolve(outputDir)).catch(() => { throw new Error("output directory does not exist"); });
  if (!(await stat(root)).isDirectory()) throw new Error("output directory is not a directory");
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const inspected: InspectedRun[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (await hasRunMetadata(path)) inspected.push(await inspectRun(path));
  }
  inspected.sort((left, right) => {
    const byStart = Date.parse(right.detail.run.startedAt) - Date.parse(left.detail.run.startedAt);
    return byStart || left.detail.run.runId.localeCompare(right.detail.run.runId) || left.detail.run.runRef.localeCompare(right.detail.run.runRef);
  });
  const runs = inspected.slice(0, RUN_LIMIT).map(value => value.detail.run);
  return {
    schemaVersion: RUN_INDEX_SCHEMA_VERSION,
    total: inspected.length,
    returned: runs.length,
    truncated: inspected.length > RUN_LIMIT,
    runs,
  };
}

export async function showRun(runDir: string): Promise<RunDetail> {
  return (await inspectRun(runDir)).detail;
}

export async function compareRuns(baseRunDir: string, headRunDir: string): Promise<RunComparison> {
  return compareInspectedRuns(await inspectRun(baseRunDir), await inspectRun(headRunDir));
}
