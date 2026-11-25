import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringFlag, type Flags } from "../cli/parser.js";
import { reserveReportOutput } from "../reporting/output-transaction.js";
import { check, id, lane, loadCatalog } from "../surface-coverage/catalog.js";
import { renderSurfaces } from "../surface-coverage/html.js";
import { readSurfaceIndex, surfaceReport } from "../surface-coverage/report.js";
import type { SurfaceRuntime } from "../surface-coverage/observer.js";

export async function surfaceRuntimeFromFlags(flags: Flags): Promise<SurfaceRuntime | undefined> {
  const file = stringFlag(flags, "surface-catalog");
  if (!file) { check(!flags["surface-lane"] && !flags["test-id"] && !flags["test-revision"]); return; }
  const catalog = await loadCatalog(file);
  const testRevision = stringFlag(flags, "test-revision", true)!;
  check(/^[A-Za-z0-9._-]{1,80}$/.test(testRevision));
  return { catalog, testId: id(stringFlag(flags, "test-id", true)), testRevision, lane: lane(stringFlag(flags, "surface-lane") ?? "unknown") };
}
export async function surfaceCoverageCommand(flags: Flags): Promise<number> {
  const config = stringFlag(flags, "config", true)!, input = stringFlag(flags, "input"), runs = stringFlag(flags, "runs-dir");
  const format = stringFlag(flags, "format") ?? "json", out = stringFlag(flags, "out");
  check(["json", "html"].includes(format) && Boolean(input) === Boolean(runs));
  const catalog = await loadCatalog(config);
  let tests;
  if (input) {
    try { const bytes = await readFile(input); check(bytes.length <= 8 * 1024 * 1024); tests = await readSurfaceIndex(catalog, JSON.parse(bytes.toString("utf8")), runs!); }
    catch { throw new Error("Cannot verify surface evidence for this execution attempt"); }
  }
  const report = surfaceReport(catalog, tests);
  const output = (format === "json" ? JSON.stringify(report, null, 2) : renderSurfaces(report)) + "\n";
  if (!out) process.stdout.write(output);
  else {
    const transaction = await reserveReportOutput(out, [config, ...(input ? [input, runs!] : [])]);
    try { await writeFile(join(transaction.stage, "surfaces"), output, { flag: "wx" }); await transaction.publishFile("surfaces"); }
    finally { await transaction.dispose(); }
  }
  return 0;
}
