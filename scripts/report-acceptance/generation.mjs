import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { summarize } from "./metrics.mjs";

const execute = promisify(execFile);
async function cli(args) {
  const start = performance.now();
  let result;
  try { result = { ...await execute(process.execPath, ["dist/cli.js", "report", ...args], { windowsHide: true, timeout: 130_000, maxBuffer: 2 * 1024 * 1024 }), exitCode: 0 }; }
  catch (error) { result = { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? null, error: error.message }; }
  const elapsedMs = performance.now() - start;
  let receipt = null;
  try { receipt = JSON.parse(result.stdout); } catch { /* Retain malformed output as failure evidence. */ }
  return { ...result, receipt, elapsedMs };
}

export async function measureGeneration(root, corpus) {
  const samples = [], bundles = [];
  for (let index = 0; index < 5; index += 1) {
    const output = join(root, "bundle-" + index);
    const sample = await cli(["generate", "--sources", corpus.sources, "--out", output, "--text-only"]);
    sample.output = output;
    sample.valid = sample.exitCode === 0 && sample.receipt?.generationStatus === "ready" && !sample.stderr;
    if (sample.valid) {
      try {
        sample.savedReceipt = join(root, sample.receipt.reportId + ".receipt.json");
        assert.deepEqual(JSON.parse(await readFile(sample.savedReceipt, "utf8")), sample.receipt);
      } catch (error) { sample.receiptError = error.message; sample.valid = false; }
    }
    if (sample.valid) {
      sample.verification = await cli(["verify", "--report-dir", output]);
      sample.valid = sample.verification.exitCode === 0 && sample.verification.receipt?.valid === true;
      if (sample.valid) bundles.push(output);
    }
    samples.push(sample);
    await writeFile(join(root, "generation.json"), JSON.stringify({ samples }, null, 2));
    console.log(corpus.distribution + " generation " + (index + 1) + ": " + sample.elapsedMs.toFixed(1) + " ms, valid=" + sample.valid);
  }
  const result = { samples, timing: summarize(samples.map(sample => sample.elapsedMs)), passed: samples.every(sample => sample.valid && sample.elapsedMs <= 10_000), viewerBundle: null };
  if (bundles.length) {
    const moved = join(root, "moved-bundle");
    await rename(bundles[0], moved);
    result.movedVerification = await cli(["verify", "--report-dir", moved]);
    assert.equal(result.movedVerification.receipt?.valid, true);
    result.viewerBundle = moved;
    const view = JSON.parse(await readFile(join(moved, "report-data.json"), "utf8"));
    assert.equal(view.runs.length, 100); assert.equal(view.timeline.length, 10_000);
    assert.equal(view.rows.filter(row => row.kind === "failure").length, 1_000);
    result.viewCounts = view.counts;
    result.viewBytes = (await readFile(join(moved, "report-data.json"))).length;
  }
  await writeFile(join(root, "generation.json"), JSON.stringify(result, null, 2));
  return result;
}
