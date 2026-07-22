import { expect, test } from "@playwright/test";

import { runCli } from "../src/cli.js";
import { runCli as runCliFromDispatcher } from "../src/cli/dispatcher.js";
import { usage } from "../src/cli/help.js";
import { LAKDA_VERSION } from "../src/index.js";

test("CLI facade preserves the dispatcher binding and help contract", async () => {
  expect(runCli).toBe(runCliFromDispatcher);
  expect(usage).toBe(`lakda ${LAKDA_VERSION}

Commands:
  lakda run --base-url <url> --mode <smoke|seeded-random|llm-explore|adaptive-explore> [--seed <int>] [--headed]
  lakda replay --input <action-sequence-or-adaptive-replay.json> --base-url <url>
  lakda export hate --run-dir <run-dir> --out <artifact-manifest.json>
  lakda doctor [--config <path>]
  lakda auth capture --persona <name> --browser chromium --base-url <url>
  lakda auth validate --persona <name> --base-url <url>
  lakda combo gen --factor-model <path> [--seed <int>] [--strength <int>] [--case-budget <int>] --out <suite.json>
  lakda combo verify --factor-model <path> --suite <suite.json> --out <coverage.json>
  lakda scout --config <path> --suite <trace-or-suite.json> [--scout-mode rule-only|llm] [--out <leads.json>]
  lakda report leads --run-dir <run-dir> --format json|html
  lakda investigate --lead <lead.json> --trace <adaptive-trace.json> --config <lakda.config.json> --reviewer <ref> --out <investigation.json>
  lakda promote --investigation <investigation.json> --kind trace|suite --out <promotion.json>
  lakda runs list --output-dir <runs-dir>
  lakda runs show --run-dir <run-dir>
  lakda runs compare --base-run-dir <run-dir> --head-run-dir <run-dir> [--out <comparison.json>]
`);
  const output: unknown[][] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => {
    output.push(values);
  };
  try {
    await expect(runCli(["--help"])).resolves.toBe(0);
  } finally {
    console.log = original;
  }
  expect(output).toEqual([[usage]]);
});
