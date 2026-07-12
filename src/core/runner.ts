import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { chromium, type BrowserContext, type Locator as PlaywrightLocator, type Page } from "playwright";
import { ArtifactCollector, readJson } from "./artifacts.js";
import { loadConfig } from "./config.js";
import { LocalLlmClient, LlmContractError, probeLlm } from "./llm.js";
import { createActionPlan, validateActionPlan } from "./plan.js";
import { assertSafeAction, safeActions } from "./safety.js";
import type { Action, ActionPlan, LakdaConfig, Locator, LlmStatus, RunOutcome, RunResult } from "./types.js";

export function exitCode(outcome: RunOutcome): 0 | 1 | 2 { return outcome === "passed" ? 0 : outcome === "error" ? 1 : 2; }

export function authStatePath(persona: string): string {
  const base = process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "lakda", "auth") : resolve(homedir(), ".lakda", "auth");
  if (!/^[A-Za-z0-9._-]+$/.test(persona)) throw new Error("persona は英数字、.、_、-だけを許可します");
  return resolve(base, `${persona}.json`);
}

function configuredAuthStatePath(config: LakdaConfig): string {
  return config.personas[config.persona]?.storageStatePath ?? authStatePath(config.persona);
}

function timebox<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error("action timeout")), timeoutMs))]);
}

function locatorFor(page: Page, locator: Locator, actionId: string): PlaywrightLocator {
  if (locator.testId) return page.getByTestId(locator.testId);
  if (!locator.role || !locator.name) throw new Error(`宣言型locatorが不正です: ${actionId}`);
  return page.getByRole(locator.role, { name: locator.name, exact: true });
}

async function redactBeforeScreenshot(page: Page): Promise<void> {
  try {
    await page.addStyleTag({ content: '[data-lakda-sensitive], input[type="password"], input[name*="token" i], input[name*="secret" i] { color: transparent !important; text-shadow: 0 0 12px #000 !important; background: #000 !important; }' });
  } catch { /* screenshot path must not mask a primary run error */ }
}

async function executeAction(page: Page, action: Action, plan: ActionPlan, config: LakdaConfig, timeoutMs: number): Promise<void> {
  if (action.kind === "navigate" || action.kind === "goto") {
    await timebox(page.goto(new URL(action.path ?? "/", plan.baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs }), timeoutMs);
    return;
  }
  const locator = locatorFor(page, action.locator!, action.id);
  if (action.kind === "click") await timebox(locator.click({ timeout: timeoutMs }), timeoutMs);
  else if (action.kind === "fill") await timebox(locator.fill(config.inputProfiles[action.inputProfileId!], { timeout: timeoutMs }), timeoutMs);
  else if (action.kind === "check") await timebox(locator.check({ timeout: timeoutMs }), timeoutMs);
  else if (action.kind === "select") await timebox(locator.selectOption(config.inputProfiles[action.inputProfileId!], { timeout: timeoutMs }), timeoutMs);
  else if (action.kind === "press") await timebox(locator.press(action.key!, { timeout: timeoutMs }), timeoutMs);
  else throw new Error(`未対応action: ${action.id}`);
}

async function resetFixture(config: LakdaConfig): Promise<void> {
  if (!config.fixtureReset) return;
  const response = await fetch(new URL(config.fixtureReset.url, config.baseUrl).toString(), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`fixture reset failed: HTTP ${response.status}`);
}

async function verifyPersona(page: Page, config: LakdaConfig, collector: ArtifactCollector): Promise<void> {
  if (config.persona === "guest") return;
  const persona = config.personas[config.persona];
  if (!persona) { collector.addFailure("UI-007", `persona設定がありません: ${config.persona}`); return; }
  if (persona.loginUrlPattern && new RegExp(persona.loginUrlPattern).test(page.url())) {
    collector.addFailure("UI-007", `unexpected logout: ${page.url()}`);
    return;
  }
  if (persona.requiredLocator) {
    try {
      if (!await locatorFor(page, persona.requiredLocator, `persona:${config.persona}`).isVisible({ timeout: 1_000 })) collector.addFailure("UI-007", `authentication locator not visible: ${config.persona}`);
    } catch { collector.addFailure("UI-007", `authentication locator not visible: ${config.persona}`); }
  }
}

async function obligationsMet(page: Page, config: LakdaConfig): Promise<boolean> {
  for (const obligation of config.obligations) {
    if (obligation.expectedUrl && page.url() !== new URL(obligation.expectedUrl, config.baseUrl).toString()) return false;
    if (obligation.visible && !await locatorFor(page, obligation.visible, "obligation").isVisible({ timeout: 1_000 })) return false;
  }
  return true;
}

function attachRules(page: Page, context: BrowserContext, collector: ArtifactCollector, config: LakdaConfig): void {
  page.on("pageerror", error => collector.addFailure("UI-001", error.message));
  page.on("crash", () => collector.addFailure("UI-002", "page crash"));
  page.on("console", message => {
    const suppressed = config.classifier.consoleErrorAllowPatterns.some(pattern => new RegExp(pattern).test(message.text()));
    if (message.type() === "error" && !suppressed) collector.addFailure("UI-003", message.text());
    collector.log(message.type(), message.text());
  });
  page.on("response", response => {
    const status = response.status(); const host = new URL(response.url()).hostname;
    const major = config.classifier.majorRequestUrlPatterns.length === 0 || config.classifier.majorRequestUrlPatterns.some(pattern => new RegExp(pattern).test(response.url()));
    if (status >= 500 && major) collector.addFailure("UI-004", `${status} ${response.url()}`);
    if ([401, 403, 404].includes(status) && config.safety.allowHosts.includes(host)) collector.addFailure("UI-005", `${status} ${response.url()}`);
  });
  context.on("page", newPage => newPage.on("crash", () => collector.addFailure("UI-002", "page crash")));
}

type LiveSelection = { kind: "action"; action: Action } | { kind: "stop" } | { kind: "hold" };
type LiveSelector = (page: Page, priorAction: Action | undefined) => Promise<LiveSelection>;

async function visibleRoleSummary(page: Page): Promise<string[]> {
  const texts = await page.locator("button, a, input, select, [role]").allTextContents();
  return texts.map(value => value.trim()).filter(Boolean).slice(0, 20);
}

async function executePlan(config: LakdaConfig, plan: ActionPlan, collector: ArtifactCollector, forcedOutcome?: RunOutcome, selector?: LiveSelector): Promise<RunOutcome> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let finalOutcome: RunOutcome = "error";
  const requiresReset = plan.actions.some(action => action.mutates) || Boolean(selector && config.actionCatalog.some(action => action.mutates));
  try {
    if (requiresReset) await resetFixture(config);
    browser = await chromium.launch({ headless: !config.headed });
    const storageState = configuredAuthStatePath(config);
    context = await browser.newContext({ storageState: existsSync(storageState) ? storageState : undefined, recordVideo: config.artifacts.video ? { dir: resolve(collector.paths.runDir, "artifacts", "video") } : undefined, recordHar: config.artifacts.har ? { path: resolve(collector.paths.runDir, "artifacts", "network.har") } : undefined });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage();
    attachRules(page, context, collector, config);
    if (config.persona !== "guest") {
      const persona = config.personas[config.persona];
      try {
        const validation = await page.goto(new URL(persona.validationPath!, plan.baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!validation || validation.status() >= 400) collector.addFailure("UI-007", `authentication validation failed: ${config.persona}`);
        await verifyPersona(page, config, collector);
      } catch (error) { collector.addFailure("UI-007", error instanceof Error ? error.message : "authentication validation failed"); }
    }
    const deadline = Date.now() + config.durationMs;
    let index = 0; let priorAction: Action | undefined;
    while (index < config.maxActions) {
      let action = plan.actions[index];
      if (!action && selector) {
        const next = await selector(page, priorAction);
        if (next.kind === "hold") { finalOutcome = "partial"; return finalOutcome; }
        if (next.kind === "stop") break;
        action = next.action;
        plan.actions.push(action);
      }
      if (!action) break;
      assertSafeAction(action, config);
      if (Date.now() >= deadline) { finalOutcome = "partial"; return finalOutcome; }
      try {
        await executeAction(page, action, plan, config, Math.min(30_000, Math.max(1, deadline - Date.now())));
        await verifyPersona(page, config, collector);
      } catch (error) { collector.addFailure("UI-006", error instanceof Error ? error.message : "action timeout"); break; }
      priorAction = action;
      index += 1;
    }
    if (forcedOutcome) { finalOutcome = forcedOutcome; return finalOutcome; }
    if (!await obligationsMet(page, config)) { finalOutcome = "partial"; return finalOutcome; }
    finalOutcome = collector.failures.length ? "failed" : "passed";
    return finalOutcome;
  } catch (error) {
    collector.addFailure("UI-008", error instanceof Error ? error.message : "executor infrastructure error");
    finalOutcome = "error";
    return finalOutcome;
  } finally {
    if (context) {
      const nonPass = finalOutcome === "failed" || finalOutcome === "partial" || finalOutcome === "error" || collector.failures.length > 0;
      if (nonPass && page) {
        try { await redactBeforeScreenshot(page); await page.screenshot({ path: collector.paths.screenshot, fullPage: true }); } catch (error) { collector.addFailure("UI-008", error instanceof Error ? error.message : "screenshot failure"); }
        try { await context.tracing.stop({ path: collector.paths.trace }); } catch (error) { collector.addFailure("UI-008", error instanceof Error ? error.message : "trace failure"); }
      } else { await context.tracing.stop().catch(() => undefined); }
      await context.close().catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
    if (requiresReset) {
      try { await resetFixture(config); } catch (error) { collector.addFailure("UI-008", error instanceof Error ? error.message : "fixture reset failure"); }
    }
  }
}
export async function runLakda(config: LakdaConfig, replayInput?: string): Promise<RunResult> {
  const collector = await ArtifactCollector.create(config, config.mode);
  let plan: ActionPlan;
  let llmStatus: LlmStatus = "not_requested";
  let outcome!: RunOutcome;
  try {
    if (replayInput) {
      const raw = await readJson(replayInput);
      plan = validateActionPlan(raw, config);
      plan.mode = "regression-replay";
      outcome = await executePlan(config, plan, collector);
    } else if (config.mode === "llm-explore") {
      const available = safeActions(config.actionCatalog, config);
      const client = new LocalLlmClient(config);
      try {
        await client.preflight(); llmStatus = "available";
        plan = { schemaVersion: "lakda/action-plan/v1", mode: "llm-explore", seed: config.seed, baseUrl: config.baseUrl!, actions: [] };
        outcome = await executePlan(config, plan, collector, undefined, async (page, priorAction) => {
          if (available.length === 0) return { kind: "stop" };
          const { decision, evidence } = await client.decide(available, {
            currentUrl: page.url(),
            visibleRoles: await visibleRoleSummary(page),
            priorAction: priorAction?.id ?? null,
            machineFailures: collector.failures.map(failure => failure.ruleId),
            risk: "select only one supplied safe candidate",
          });
          collector.addLlmEvidence(evidence);
          if (!("candidateId" in decision)) return { kind: decision.decision };
          const index = available.findIndex(candidate => candidate.id === decision.candidateId);
          if (index < 0) throw new LlmContractError("candidate IDがallowlistにありません");
          const action = available[index];
          available.splice(index, 1);
          return { kind: "action", action };
        });
      } catch (error) {
        llmStatus = /model|GGUF/i.test(error instanceof Error ? error.message : "") ? "mismatch" : "unavailable";
        if (error instanceof LlmContractError && error.evidence) collector.addLlmEvidence(error.evidence);
        collector.addFailure("UI-008", error instanceof Error ? error.message : "LLM provider error");
        plan = { schemaVersion: "lakda/action-plan/v1", mode: "llm-explore", seed: config.seed, baseUrl: config.baseUrl!, actions: [] };
        outcome = "error";
      }    } else {
      plan = createActionPlan(config, config.mode);
      llmStatus = config.llm.enabled ? await probeLlm(config) : "not_requested";
      outcome = await executePlan(config, plan, collector);
    }
  } catch (error) {
    collector.addFailure("UI-008", error instanceof Error ? error.message : "run error");
    plan = { schemaVersion: "lakda/action-plan/v1", mode: config.mode, seed: config.seed, baseUrl: config.baseUrl ?? "", actions: [] };
    outcome = "error";
  }
  if (outcome !== "error" && collector.failures.some(failure => failure.ruleId === "UI-008")) outcome = "error";
  const code = exitCode(outcome);
  try {
    const finalized = await collector.finalize(plan!, outcome, code, llmStatus, config.artifacts.maxRunBytes, config.artifacts.classification);
    outcome = finalized.outcome;
    return { runId: collector.metadata.runId, attempt: 1, outcome, exitCode: exitCode(outcome), artifactManifestPath: finalized.manifestPath, actionSequencePath: collector.paths.actionSequence, failures: collector.failures, llmStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : "artifact failure";
    collector.addFailure("UI-008", message);
    return { runId: collector.metadata.runId, attempt: 1, outcome: "error", exitCode: 1, actionSequencePath: collector.paths.actionSequence, failures: collector.failures, llmStatus };
  }
}

export async function loadRunConfig(overrides: Partial<LakdaConfig>): Promise<LakdaConfig> { return loadConfig(undefined, overrides); }

export async function readActionSequence(input: string): Promise<ActionPlan> { return JSON.parse(await readFile(input, "utf8")) as ActionPlan; }