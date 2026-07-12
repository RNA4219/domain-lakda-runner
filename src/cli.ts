#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
import { exportHate } from "./core/hate.js";
import { loadConfig, parseMode } from "./core/config.js";
import { authStatePath, runLakda } from "./core/runner.js";
import { probeLlm } from "./core/llm.js";
import { assertLoopbackEndpoint } from "./core/safety.js";
import { LAKDA_VERSION } from "./index.js";

const usage = `lakda ${LAKDA_VERSION}

Commands:
  lakda run --base-url <url> --mode <smoke|seeded-random|llm-explore> [--seed <int>] [--headed]
  lakda replay --input <action-sequence.json> --base-url <url>
  lakda export hate --run-dir <run-dir> --out <artifact-manifest.json>
  lakda doctor [--config <path>]
  lakda auth capture --persona <name> --browser chromium --base-url <url>
  lakda auth validate --persona <name> --base-url <url>
`;

type Flags = Record<string, string | boolean | undefined>;
function args(argv: string[]): { positionals: string[]; flags: Flags } {
  const parsed = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "base-url": { type: "string" }, mode: { type: "string" }, seed: { type: "string" }, headed: { type: "boolean" },
      "output-dir": { type: "string" }, persona: { type: "string" }, config: { type: "string" }, input: { type: "string" },
      "run-dir": { type: "string" }, out: { type: "string" }, browser: { type: "string" }, help: { type: "boolean" }, version: { type: "boolean" },
    },
  });
  return { positionals: parsed.positionals, flags: parsed.values };
}
function stringFlag(flags: Flags, key: string, required = false): string | undefined { const value = flags[key]; if (required && typeof value !== "string") throw new Error(`--${key} は必須です`); return typeof value === "string" ? value : undefined; }
function overrides(flags: Flags) {
  const baseUrl = stringFlag(flags, "base-url"); const mode = stringFlag(flags, "mode"); const seed = stringFlag(flags, "seed");
  return { baseUrl, mode: mode ? parseMode(mode) : undefined, seed: seed ? Number(seed) : undefined, headed: flags.headed === true, outputDir: stringFlag(flags, "output-dir"), persona: stringFlag(flags, "persona") };
}

async function doctor(flags: Flags): Promise<number> {
  const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"));
  const executable = chromium.executablePath();
  const llm = (() => { try { assertLoopbackEndpoint(config.llm.baseUrl); return "valid_endpoint"; } catch { return "invalid_endpoint"; } })();
  const llmStatus = llm === "valid_endpoint" ? await probeLlm(config) : "invalid_endpoint";
  const report = { command: "doctor", readOnly: true, config: true, chromiumExecutable: existsSync(executable), authState: existsSync(authStatePath(config.persona)), llm: llmStatus, endpoint: config.llm.baseUrl };
  console.log(JSON.stringify(report, null, 2));
  return report.chromiumExecutable ? 0 : 1;
}

async function capture(flags: Flags): Promise<number> {
  const persona = stringFlag(flags, "persona", true)!; const browserName = stringFlag(flags, "browser", true); const baseUrl = stringFlag(flags, "base-url", true)!;
  if (browserName !== "chromium") throw new Error("v1 は --browser chromium だけを許可します");
  const browser = await chromium.launch({ headless: false }); const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const terminal = createInterface({ input, output }); await terminal.question("ブラウザで認証後、Enterを押してください: "); terminal.close();
    const destination = authStatePath(persona); mkdirSync(resolve(destination, ".."), { recursive: true }); await context.storageState({ path: destination });
    console.log(JSON.stringify({ persona, storageState: destination })); return 0;
  } finally { await context.close(); await browser.close(); }
}

async function validateAuth(flags: Flags): Promise<number> {
  const persona = stringFlag(flags, "persona", true)!; const baseUrl = stringFlag(flags, "base-url", true)!;
  const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"), { ...overrides(flags), baseUrl, persona });
  const declaration = config.personas[persona];
  const state = declaration.storageStatePath ?? authStatePath(persona);
  if (!existsSync(state)) throw new Error(`storageStateがありません: ${state}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: state }); const page = await context.newPage();
    const response = await page.goto(new URL(declaration.validationPath ?? "/", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    let ok = Boolean(response && response.status() < 400);
    if (declaration.loginUrlPattern && new RegExp(declaration.loginUrlPattern).test(page.url())) ok = false;
    if (declaration.requiredLocator) {
      const locator = declaration.requiredLocator.testId
        ? page.getByTestId(declaration.requiredLocator.testId)
        : page.getByRole(declaration.requiredLocator.role!, { name: declaration.requiredLocator.name!, exact: true });
      ok = ok && await locator.isVisible({ timeout: 1_000 });
    }
    await context.close(); console.log(JSON.stringify({ persona, valid: ok, status: response?.status(), validationPath: declaration.validationPath ?? "/" })); return ok ? 0 : 2;
  } finally { await browser.close(); }
}

export async function runCli(argv: string[]): Promise<number> {
  try {
    const parsed = args(argv);
    if (parsed.flags.version) { console.log(LAKDA_VERSION); return 0; }
    if (parsed.flags.help || parsed.positionals.length === 0) { console.log(usage); return 0; }
    const command = parsed.positionals.join(" ");
    if (command === "run") {
      const flags = parsed.flags; const baseUrl = stringFlag(flags, "base-url", true)!; const mode = stringFlag(flags, "mode", true)!;
      const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"), { ...overrides(flags), baseUrl, mode: parseMode(mode) });
      const result = await runLakda(config); console.log(JSON.stringify(result, null, 2)); return result.exitCode;
    }
    if (command === "replay") {
      const flags = parsed.flags; const inputPath = stringFlag(flags, "input", true)!; const baseUrl = stringFlag(flags, "base-url", true)!;
      const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"), { ...overrides(flags), baseUrl, mode: "regression-replay" });
      const result = await runLakda(config, inputPath); console.log(JSON.stringify(result, null, 2)); return result.exitCode;
    }
    if (command === "export hate") { const runDir = stringFlag(parsed.flags, "run-dir", true)!; const out = stringFlag(parsed.flags, "out", true)!; console.log(JSON.stringify(await exportHate(runDir, out), null, 2)); return 0; }
    if (command === "doctor") return doctor(parsed.flags);
    if (command === "auth capture") return capture(parsed.flags);
    if (command === "auth validate") return validateAuth(parsed.flags);
    throw new Error(`未対応command: ${command}`);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
