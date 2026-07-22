import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { writeCanonicalJson } from "../core/artifact-store.js";
import { compareRuns, listRuns, showRun } from "../runs/catalog.js";

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(flag + " is required");
  return value;
}

function isContained(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

async function existingAncestor(path: string): Promise<{ requested: string; actual: string }> {
  let current = dirname(resolve(path));
  for (;;) {
    try {
      return { requested: current, actual: await realpath(current) };
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error("cannot resolve --out parent");
      current = parent;
    }
  }
}

async function assertOutputOutsideRuns(out: string, runDirs: string[]): Promise<string> {
  const target = resolve(out);
  const ancestor = await existingAncestor(target);
  const actualTarget = resolve(ancestor.actual, relative(ancestor.requested, target));
  for (const runDir of runDirs) {
    const root = await realpath(resolve(runDir));
    if (isContained(root, actualTarget)) throw new Error("--out must not modify a run directory");
  }
  return target;
}

export async function runsListCommand(options: { outputDir?: string }): Promise<number> {
  const result = await listRuns(required(options.outputDir, "--output-dir"));
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

export async function runsShowCommand(options: { runDir?: string }): Promise<number> {
  const result = await showRun(required(options.runDir, "--run-dir"));
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

export async function runsCompareCommand(options: {
  baseRunDir?: string;
  headRunDir?: string;
  out?: string;
}): Promise<number> {
  const baseRunDir = required(options.baseRunDir, "--base-run-dir");
  const headRunDir = required(options.headRunDir, "--head-run-dir");
  const result = await compareRuns(baseRunDir, headRunDir);
  if (options.out) {
    const out = await assertOutputOutsideRuns(options.out, [baseRunDir, headRunDir]);
    await writeCanonicalJson(out, result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  return 0;
}
