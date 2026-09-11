import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { authStatePath, runLakda, runLakdaBatch } from "../core/runner.js";
import { exportHate } from "../core/hate.js";
import { loadConfig, parseMode } from "../core/config.js";
import { probeLlm } from "../core/llm.js";
import { assertLoopbackEndpoint } from "../core/safety.js";
import { configOverrides, stringFlag, type Flags } from "../cli/parser.js";
import type { LakdaConfig, RunBatchResult, RunResult } from "../core/types.js";
import { generateAutomaticReport } from "../reporting/automatic.js";
import { saveReportBatchSources } from "../reporting/batch-writer.js";
import { resolveReportConfig } from "../reporting/config.js";
import type { ReportConfig } from "../reporting/contracts.js";

async function reportResult(result: RunResult | RunBatchResult, config: LakdaConfig, reporting: ReportConfig): Promise<void> {
  if ("workerResults" in result) {
    await generateAutomaticReport(reporting, signal => saveReportBatchSources(result, { runOutputRoot: config.outputDir, classification: config.artifacts.classification, outputRoot: reporting.outputRoot, signal }));
  } else if (result.actionSequencePath) {
    await generateAutomaticReport(reporting, { runDir: dirname(result.actionSequencePath) });
  }
}

export async function runCommand(flags: Flags): Promise<number> {
  const reporting = await resolveReportConfig(flags);
  const baseUrl = stringFlag(flags, "base-url", true)!;
  const mode = stringFlag(flags, "mode", true)!;
  const config = loadConfig(
    stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"),
    { ...configOverrides(flags), baseUrl, mode: parseMode(mode) },
  );
  const result = config.workers > 1 ? await runLakdaBatch(config) : await runLakda(config);
  console.log(JSON.stringify(result, null, 2));
  await reportResult(result, config, reporting);
  return result.exitCode;
}

export async function replayCommand(flags: Flags): Promise<number> {
  const reporting = await resolveReportConfig(flags);
  const inputPath = stringFlag(flags, "input", true)!;
  const baseUrl = stringFlag(flags, "base-url", true)!;
  const config = loadConfig(
    stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"),
    { ...configOverrides(flags), baseUrl, mode: "regression-replay" },
  );
  const result = config.workers > 1
    ? await runLakdaBatch(config, inputPath)
    : await runLakda(config, inputPath);
  console.log(JSON.stringify(result, null, 2));
  await reportResult(result, config, reporting);
  return result.exitCode;
}

export async function exportHateCommand(flags: Flags): Promise<number> {
  const runDir = stringFlag(flags, "run-dir", true)!;
  const out = stringFlag(flags, "out", true)!;
  console.log(JSON.stringify(await exportHate(runDir, out), null, 2));
  return 0;
}

export async function doctorCommand(flags: Flags): Promise<number> {
  const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"));
  const executable = chromium.executablePath();
  const llm = (() => {
    try {
      assertLoopbackEndpoint(config.llm.baseUrl);
      return "valid_endpoint";
    } catch {
      return "invalid_endpoint";
    }
  })();
  const llmStatus = llm === "valid_endpoint" ? await probeLlm(config) : "invalid_endpoint";
  const report = {
    command: "doctor",
    readOnly: true,
    config: true,
    chromiumExecutable: existsSync(executable),
    authState: existsSync(authStatePath(config.persona)),
    llm: llmStatus,
    endpoint: config.llm.baseUrl,
  };
  console.log(JSON.stringify(report, null, 2));
  return report.chromiumExecutable ? 0 : 1;
}
