import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli/dispatcher.js";

test("summary counts only saved completed runs and never confuses run with Gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-summary-"));
  try {
    await mkdir(join(root, "runs", "a"), { recursive: true });
    await mkdir(join(root, "runs", "b"), { recursive: true });
    await writeFile(join(root, "runs", "a", "run-metadata.json"), JSON.stringify({ outcome: "passed" }));
    await writeFile(join(root, "runs", "b", "run-metadata.json"), JSON.stringify({ outcome: "failed" }));
    expect(await runCli(["report", "summary", "--runs-dir", join(root, "runs"), "--out", join(root, "summary.json"), "--format", "json"])).toBe(0);
    const value = JSON.parse(await readFile(join(root, "summary.json"), "utf8")) as { runs: number; counts: { passed: number; failed: number }; gate: string };
    expect(value.runs).toBe(2);
    expect(value.counts.passed).toBe(1);
    expect(value.counts.failed).toBe(1);
    expect(value.gate).toBe("external-qeg-required");
    expect(await runCli(["report", "summary", "--runs-dir", join(root, "runs"), "--out", join(root, "summary.json")])).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
