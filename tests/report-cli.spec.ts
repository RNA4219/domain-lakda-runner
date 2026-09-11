import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";
import { loadConfig } from "../src/core/config.js";
import { runLakda } from "../src/core/runner.js";
import { assertReportSchema } from "../src/reporting/contracts.js";
import { startFixture } from "./fixtures/server.js";

async function cli(args: string[]) {
  const stdout: string[] = []; const stderr: string[] = [];
  const original = { log: console.log, error: console.error };
  console.log = (...values: unknown[]) => { stdout.push(values.map(String).join(" ")); };
  console.error = (...values: unknown[]) => { stderr.push(values.map(String).join(" ")); };
  try { return { code: await runCli(args), stdout, stderr }; }
  finally { console.log = original.log; console.error = original.error; }
}

test("standalone generation returns one receipt, preserves a failed run and verifies its portable output", async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), "lakda-report-cli-"));
  try {
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir: join(root, "runs"), mode: "smoke", candidates: [{ id: "failure", kind: "navigate", path: "/failure" }], artifacts: { video: false } }));
    expect(result.outcome).toBe("failed");
    const input = dirname(result.actionSequencePath!); const out = join(root, "report");
    const metadata = await readFile(join(input, "run-metadata.json"));
    const generated = await cli(["report", "generate", "--run-dir", input, "--out", out, "--text-only"]);
    expect(generated.code, generated.stderr.join("\n")).toBe(0); expect(generated.stdout).toHaveLength(1);
    const receipt = JSON.parse(generated.stdout[0]); assertReportSchema("receipt", receipt);
    expect(receipt).toMatchObject({ generationStatus: "ready", output: "report/index.html", profile: "local" });
    expect(JSON.parse(await readFile(join(root, receipt.reportId + ".receipt.json"), "utf8"))).toEqual(receipt);
    const data = JSON.parse(await readFile(join(out, "report-data.json"), "utf8"));
    expect(data.runs[0].outcome).toBe("failed"); expect(data.counts.actions).toBe(1);
    expect(await readFile(join(input, "run-metadata.json"))).toEqual(metadata);
    expect(data.language).toBe("ja");
    const englishOut = join(root, "english");
    const english = await cli(["report", "generate", "--run-dir", input, "--out", englishOut, "--text-only", "--report-language", "en"]);
    expect(english.code).toBe(0);
    expect(JSON.parse(await readFile(join(englishOut, "report-data.json"), "utf8"))).toMatchObject({ language: "en", counts: data.counts, rows: data.rows });
    expect(await readFile(join(englishOut, "index.html"), "utf8")).toContain('<html lang="en">');
    expect((await cli(["report", "verify", "--report-dir", englishOut])).code).toBe(0);
    expect(await readFile(join(input, "run-metadata.json"))).toEqual(metadata);
    const verified = await cli(["report", "verify", "--report-dir", out]);
    expect(verified.code).toBe(0); expect(JSON.parse(verified.stdout[0])).toMatchObject({ valid: true, scope: "report-bundle-files", reportId: receipt.reportId });
    const repeated = await cli(["report", "generate", "--run-dir", input, "--out", out]);
    expect(repeated.code).toBe(2); expect(JSON.parse(repeated.stdout[0]).generationStatus).toBe("error");
    await writeFile(join(out, "report.css"), "changed");
    const invalid = await cli(["report", "verify", "--report-dir", out]);
    expect(invalid.code).toBe(2); expect(JSON.parse(invalid.stdout[0]).valid).toBe(false);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test("new report commands reject duplicate, conflicting and unrelated flags with input exit 2", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-cli-"));
  try {
    const out = join(root, "out");
    const cases = [
      ["--run-dir", root, "--out", out, "--out", out],
      ["--run-dir", root, "--session", root, "--out", out],
      ["--run-dir", root, "--out", out, "--seed", "7"],
      ["--run-dir", root, "--out", out, "--unknown-report-option"],
      ["--run-dir", root, "--out", out, "--report-language", "fr"],
    ];
    for (const flags of cases) {
      const result = await cli(["report", "generate", ...flags]);
      expect(result.code, result.stderr.join("\n")).toBe(2);
      expect(result.stdout).toHaveLength(1); assertReportSchema("receipt", JSON.parse(result.stdout[0]));
      expect(JSON.parse(result.stdout[0]).output).toBeNull();
    }
    expect((await readdir(root)).includes("out")).toBe(false);
    expect((await cli(["report", "verify", "--report-dir", root, "--out", out])).code).toBe(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
