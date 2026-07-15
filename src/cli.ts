#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
import { exportHate } from "./core/hate.js";
import { readJson, writeCanonicalJson } from "./core/artifact-store.js";
import { assertCombinationFactorModel, assertCombinationSuite, generateCombinationSuite, verifyCombinationSuite } from "./adaptive/combinations.js";
import { loadConfig, parseMode } from "./core/config.js";
import { authStatePath, runLakda, runLakdaBatch } from "./core/runner.js";
import { LocalLlmClient, probeLlm } from "./core/llm.js";
import { assertLoopbackEndpoint } from "./core/safety.js";
import { LAKDA_VERSION } from "./index.js";
import { buildScoutContext, groupLeadsRuleOnly, signalsFromTrace, scoutWithLoopback, writeScoutEvidence, type ExplorationLead } from "./adaptive/scouting.js";
import { createInvestigation, promoteInvestigation, runStrictReplay, type Investigation } from "./adaptive/investigation.js";

const usage = `lakda ${LAKDA_VERSION}

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
  lakda investigate --lead <lead.json> --reviewer <ref> --out <investigation.json>
  lakda promote --investigation <investigation.json> --kind trace|suite --out <promotion.json>
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
      "factor-model": { type: "string" }, suite: { type: "string" }, strength: { type: "string" }, "case-budget": { type: "string" }, "factor-group": { type: "string" },
      lead: { type: "string" }, reviewer: { type: "string" }, investigation: { type: "string" }, kind: { type: "string" }, format: { type: "string" }, "out-dir": { type: "string" }, "scout-mode": { type: "string" },
    },
  });
  return { positionals: parsed.positionals, flags: parsed.values };
}
function stringFlag(flags: Flags, key: string, required = false): string | undefined { const value = flags[key]; if (required && typeof value !== "string") throw new Error(`--${key} は必須です`); return typeof value === "string" ? value : undefined; }
function integerFlag(flags: Flags, key: string, fallback?: number): number | undefined {
  const value = stringFlag(flags, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("--"+key+" は整数で指定してください");
  return parsed;
}
function overrides(flags: Flags) {
  const baseUrl = stringFlag(flags, "base-url"); const mode = stringFlag(flags, "mode"); const seed = stringFlag(flags, "seed");
  const values = { baseUrl, mode: mode ? parseMode(mode) : undefined, seed: seed ? Number(seed) : undefined, outputDir: stringFlag(flags, "output-dir"), persona: stringFlag(flags, "persona"), ...(flags.headed === true ? { headed: true } : {}) };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
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

async function scoutCommand(flags: Flags): Promise<number> {
  const suitePath = stringFlag(flags, "suite", true)!;
  const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"));
  const input = await readJson(suitePath);
  const trace = input && typeof input === "object" && Array.isArray((input as Record<string, unknown>).trace) ? (input as Record<string, unknown>).trace : [input];
  const runId = input && typeof input === "object" && typeof (input as Record<string, unknown>).runId === "string" ? (input as Record<string, string>).runId : "scout-" + config.seed;
  const signals = signalsFromTrace(trace, runId);
  const leadCap = config.extensions?.scouting?.leadCap ?? 3;
  const leads = groupLeadsRuleOnly(signals, leadCap);
  const context = buildScoutContext(leads, ["trace", "oracle", "timeout", "topology", "coverage", "safety"], leadCap);
  const requestedMode = stringFlag(flags, "scout-mode") ?? stringFlag(flags, "mode");
  const configuredMode = config.extensions?.scouting?.mode;
  const mode = requestedMode === "loopback" || (!requestedMode && configuredMode === "loopback") ? "llm" : requestedMode ?? configuredMode ?? "rule-only";
  let selectedLeads = leads;
  if (mode === "llm") {
    if (!config.llm.enabled || !config.llm.modelPath || !config.llm.modelSha256) throw new Error("LLM scoutは明示的なloopback設定とmodel証跡が必要です");
    const client = new LocalLlmClient(config); await client.preflight();
    const response = await scoutWithLoopback(client, context, leads, { signalCount: signals.length });
    selectedLeads = leads.map(lead => lead.leadId === response.leadId ? { ...lead, priority: response.priority } : lead).sort((left, right) => right.priority - left.priority || left.leadId.localeCompare(right.leadId)).slice(0, leadCap);
  } else if (mode !== "rule-only") throw new Error("scout modeはrule-onlyまたはllmだけを許可します");
  const result = { schemaVersion: "lakda/lead-report-index/v1", runId, leadCount: selectedLeads.length, leads: selectedLeads.map(lead => lead.leadId), generatedAt: new Date().toISOString(), signals, leadObjects: selectedLeads, context };
  const out = stringFlag(flags, "out") ?? resolve(stringFlag(flags, "out-dir") ?? config.outputDir, "leads.json");
  await writeCanonicalJson(out, result);
  await writeScoutEvidence(resolve(out, "..", "scout-evidence.jsonl"), { context, accepted: true });
  console.log(JSON.stringify({ command: "scout", mode, out, leadCount: selectedLeads.length }, null, 2)); return 0;
}

async function reportLeads(flags: Flags): Promise<number> {
  const runDir = stringFlag(flags, "run-dir", true)!; const format = stringFlag(flags, "format", true);
  if (format !== "json" && format !== "html") throw new Error("--formatはjsonまたはhtmlです");
  const candidates = [resolve(runDir, "adaptive", "leads.json"), resolve(runDir, "leads.json")]; const source = candidates.find(path => existsSync(path)); if (!source) throw new Error("leads.jsonがありません");
  const report = await readJson(source); if (format === "json") { console.log(JSON.stringify(report, null, 2)); return 0; }
  const escape = (value: string) => value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
  const leads = report && typeof report === "object" && Array.isArray((report as Record<string, unknown>).leadObjects) ? (report as Record<string, unknown>).leadObjects as ExplorationLead[] : [];
  const html = "<!doctype html><meta charset=\"utf-8\"><title>Lakda Leads</title><h1>Lakda Leads</h1><ul>" + leads.map(lead => "<li>" + escape(lead.leadId) + " priority=" + String(lead.priority) + " status=" + escape(lead.status) + "</li>").join("") + "</ul>";
  const out = stringFlag(flags, "out"); if (out) await writeTextArtifact(out, html); else console.log(html); return 0;
}

async function investigateCommand(flags: Flags): Promise<number> {
  const leadPath = stringFlag(flags, "lead", true)!; const reviewer = stringFlag(flags, "reviewer", true)!;
  const lead = await readJson(leadPath) as ExplorationLead; const investigation = createInvestigation(lead, reviewer);
  const result = await runStrictReplay(investigation, () => ({ reproduced: false, divergence: "replay-context-unavailable" }));
  const out = stringFlag(flags, "out") ?? resolve(dirnameFor(leadPath), result.investigationId + ".json");
  await writeCanonicalJson(out, result); console.log(JSON.stringify({ command: "investigate", out, status: result.status, replayCount: result.replayCount }, null, 2)); return result.status === "reproduced" ? 0 : 2;
}

async function promoteCommand(flags: Flags): Promise<number> {
  const investigationPath = stringFlag(flags, "investigation", true)!; const kind = stringFlag(flags, "kind", true);
  if (kind !== "trace" && kind !== "suite") throw new Error("--kindはtraceまたはsuiteです");
  const investigation = await readJson(investigationPath) as Investigation; const refs = investigation.evidenceRefs ?? investigation.oracleRefs ?? [];
  const promotion = promoteInvestigation(investigation, kind, refs); const out = stringFlag(flags, "out") ?? resolve(dirnameFor(investigationPath), promotion.promotionId + ".json");
  await writeCanonicalJson(out, promotion); console.log(JSON.stringify({ command: "promote", out, promotionId: promotion.promotionId }, null, 2)); return 0;
}
function dirnameFor(path: string): string { return resolve(path, ".."); }
async function writeTextArtifact(path: string, text: string): Promise<void> { const { writeText } = await import("./core/artifact-store.js"); await writeText(path, text); }
async function comboGen(flags: Flags): Promise<number> {
  const modelPath = stringFlag(flags, "factor-model", true)!;
  const out = stringFlag(flags, "out", true)!;
  const model = await readJson(modelPath);
  assertCombinationFactorModel(model);
  const suite = generateCombinationSuite(model, {
    seed: integerFlag(flags, "seed"),
    strength: integerFlag(flags, "strength"),
    caseBudget: integerFlag(flags, "case-budget"),
    factorGroup: stringFlag(flags, "factor-group"),
  });
  await writeCanonicalJson(out, suite);
  console.log(JSON.stringify({ command: "combo gen", out, suiteId: suite.suiteId, caseCount: suite.cases.length, strength: suite.strength }, null, 2));
  return 0;
}

async function comboVerify(flags: Flags): Promise<number> {
  const modelPath = stringFlag(flags, "factor-model", true)!;
  const suitePath = stringFlag(flags, "suite", true)!;
  const out = stringFlag(flags, "out", true)!;
  const model = await readJson(modelPath);
  const suite = await readJson(suitePath);
  assertCombinationFactorModel(model);
  assertCombinationSuite(suite);
  const report = verifyCombinationSuite(model, suite);
  await writeCanonicalJson(out, report);
  console.log(JSON.stringify(report, null, 2));
  return report.valid ? 0 : 1;
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
      const result = config.workers > 1 ? await runLakdaBatch(config) : await runLakda(config); console.log(JSON.stringify(result, null, 2)); return result.exitCode;
    }
    if (command === "replay") {
      const flags = parsed.flags; const inputPath = stringFlag(flags, "input", true)!; const baseUrl = stringFlag(flags, "base-url", true)!;
      const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"), { ...overrides(flags), baseUrl, mode: "regression-replay" });
      const result = config.workers > 1 ? await runLakdaBatch(config, inputPath) : await runLakda(config, inputPath); console.log(JSON.stringify(result, null, 2)); return result.exitCode;
    }
    if (command === "export hate") { const runDir = stringFlag(parsed.flags, "run-dir", true)!; const out = stringFlag(parsed.flags, "out", true)!; console.log(JSON.stringify(await exportHate(runDir, out), null, 2)); return 0; }
    if (command === "doctor") return doctor(parsed.flags);
    if (command === "auth capture") return capture(parsed.flags);
    if (command === "auth validate") return validateAuth(parsed.flags);
    if (command === "combo gen") return comboGen(parsed.flags);
    if (command === "combo verify") return comboVerify(parsed.flags);
    if (command === "scout") return scoutCommand(parsed.flags);
    if (command === "report leads") return reportLeads(parsed.flags);
    if (command === "investigate") return investigateCommand(parsed.flags);
    if (command === "promote") return promoteCommand(parsed.flags);
    throw new Error(`未対応command: ${command}`);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
