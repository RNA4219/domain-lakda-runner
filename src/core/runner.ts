import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type BrowserContext, type Locator as PlaywrightLocator, type Page } from "playwright";
import { ActionBudget } from "./action-budget.js";
import { ArtifactCollector } from "./artifacts.js";
import { inspectArtifactPolicy, removeSensitiveArtifacts } from "./artifact-policy.js";
import { readJson, runSizeBytes, serializeTextArtifact, writeText } from "./artifact-store.js";
import { loadConfig } from "./config.js";

import { writeSanitizedHar } from "./har.js";
import { exportHate } from "./hate.js";
import { LocalLlmClient, LlmContractError, probeLlm } from "./llm.js";
import { applyArtifactPolicy, aggregateOutcomes, type OutcomeDecision } from "./outcome.js";
import { createActionPlan, validateActionPlan, workerSeed } from "./plan.js";
import { assertSafeAction, safeActions } from "./safety.js";
import type { Action, ActionPlan, LakdaConfig, Locator, LlmStatus, RunBatchResult, RunOutcome, RunResult, WorkerRunEntry } from "./types.js";

export type RunRuntimeContext = { workerIndex?: number; batchId?: string; clock?: () => number; actionBudget?: ActionBudget };

type LiveSelection = { kind: "action"; action: Action } | { kind: "stop" } | { kind: "hold" };
type LiveSelector = (page: Page, priorAction: Action | undefined) => Promise<LiveSelection>;
type ExecutionResult = OutcomeDecision;

class ArtifactLimitError extends Error {
  constructor() { super("DOM snapshot exceeds maxRunBytes"); this.name = "ArtifactLimitError"; }
}

export function exitCode(outcome: RunOutcome): 0 | 1 | 2 { return outcome === "passed" ? 0 : outcome === "error" ? 1 : 2; }

export function authStatePath(persona: string): string {
  const base = resolve(process.cwd(), ".lakda", "auth");
  if (!/^[A-Za-z0-9._-]+$/.test(persona)) throw new Error("persona は英数字、.、_、-だけを許可します");
  return resolve(base, `${persona}.json`);
}

function configuredAuthStatePath(config: LakdaConfig): string {
  return config.personas[config.persona]?.storageStatePath ?? authStatePath(config.persona);
}

function timebox<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("action timeout")), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function locatorFor(page: Page, locator: Locator, actionId: string): PlaywrightLocator {
  if (locator.testId) return page.getByTestId(locator.testId);
  if (!locator.role || !locator.name) throw new Error(`宣言型locatorが不正です: ${actionId}`);
  return page.getByRole(locator.role, { name: locator.name, exact: true });
}

async function redactBeforeScreenshot(page: Page): Promise<void> {
  try {
    await page.addStyleTag({ content: '[data-lakda-sensitive], input[type="password"], input[name*="token" i], input[name*="secret" i] { color: transparent !important; text-shadow: 0 0 12px #000 !important; background: #000 !important; }' });
  } catch { /* screenshot masking cannot replace the primary run result */ }
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
  const response = await fetch(new URL(config.fixtureReset.url, config.baseUrl).toString(), { method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000) });
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

function attachPageRules(page: Page, collector: ArtifactCollector, config: LakdaConfig): void {
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
}

function attachRules(page: Page, context: BrowserContext, collector: ArtifactCollector, config: LakdaConfig): void {
  attachPageRules(page, collector, config);
  context.on("page", newPage => attachPageRules(newPage, collector, config));
}

async function visibleRoleSummary(page: Page): Promise<string[]> {
  const texts = await page.locator("button, a, input, select, [role]").allTextContents();
  return texts.map(value => value.trim()).filter(Boolean).slice(0, 20);
}

async function writeDomSnapshot(page: Page, collector: ArtifactCollector, config: LakdaConfig, actionIndex: number, actionId: string): Promise<void> {
  const html = await page.evaluate(() => {
    const root = document.documentElement.cloneNode(true) as HTMLElement;
    const sensitiveAttribute = /authorization|cookie|token|secret|password|api[-_]?key/i;
    root.querySelectorAll("script").forEach(element => { element.textContent = ""; });
    root.querySelectorAll("input, textarea, select, option").forEach(element => {
      element.removeAttribute("value");
      element.removeAttribute("selected");
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLOptionElement) element.textContent = "[REDACTED]";
    });
    root.querySelectorAll("[contenteditable], [name*=\"password\" i], [name*=\"token\" i], [name*=\"secret\" i], [id*=\"password\" i], [id*=\"token\" i], [id*=\"secret\" i]").forEach(element => { element.textContent = "[REDACTED]"; element.removeAttribute("value"); });
    root.querySelectorAll("*").forEach(element => {
      for (const attribute of [...element.attributes]) {
        if (sensitiveAttribute.test(attribute.name)) element.setAttribute(attribute.name, "[REDACTED]");
        if (/^(href|src|action|formaction)$/i.test(attribute.name)) {
          const value = attribute.value.replace(/[?#][\s\S]*$/, "");
          element.setAttribute(attribute.name, value || "[REDACTED]");
        }
      }
    });
    root.querySelectorAll("[data-lakda-sensitive]").forEach(element => {
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      element.textContent = "[REDACTED]";
    });
    return `<!doctype html>${root.outerHTML}`;
  });
  const safeId = actionId.replace(/[^A-Za-z0-9._-]/g, "-");
  const stored = serializeTextArtifact(html);
  if (await runSizeBytes(collector.paths.runDir) + Buffer.byteLength(stored, "utf8") > config.artifacts.maxRunBytes) throw new ArtifactLimitError();
  await writeText(join(collector.paths.runDir, "artifacts", "dom", `${String(actionIndex).padStart(4, "0")}-${safeId}.html`), html);
}

async function removeOptionalDomSnapshots(collector: ArtifactCollector): Promise<boolean> {
  const directory = join(collector.paths.runDir, "artifacts", "dom");
  let snapshots: string[];
  try { snapshots = (await readdir(directory)).filter(path => path.endsWith(".html")); }
  catch { return false; }
  if (snapshots.length === 0) return false;
  await Promise.all(snapshots.map(path => rm(join(directory, path), { force: true })));
  collector.setDomSnapshotCount(0);
  return true;
}
async function executePlan(config: LakdaConfig, plan: ActionPlan, collector: ArtifactCollector, runtime: RunRuntimeContext, forcedOutcome?: RunOutcome, selector?: LiveSelector): Promise<ExecutionResult> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let harTempDir: string | undefined;
  let harTempPath: string | undefined;
  let final: ExecutionResult = { outcome: "error", terminationReason: "executor_error" };
  const finish = (decision: ExecutionResult): ExecutionResult => { final = decision; return final; };
  const requiresReset = plan.actions.some(action => action.mutates) || Boolean(selector && config.actionCatalog.some(action => action.mutates));
  try {
    if (requiresReset) await resetFixture(config);
    browser = await chromium.launch({ headless: !config.headed });
    const storageState = configuredAuthStatePath(config);
    if (config.artifacts.har) { harTempDir = await mkdtemp(join(tmpdir(), "lakda-har-")); harTempPath = join(harTempDir, "network.har"); }
    context = await browser.newContext({ storageState: existsSync(storageState) ? storageState : undefined, recordVideo: config.artifacts.video ? { dir: resolve(collector.paths.runDir, "artifacts", "video") } : undefined, recordHar: harTempPath ? { path: harTempPath, content: "omit" } : undefined });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage();
    collector.markCaptureAvailable();
    attachRules(page, context, collector, config);
    if (config.persona !== "guest") {
      const persona = config.personas[config.persona];
      try {
        const validation = await page.goto(new URL(persona.validationPath!, plan.baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!validation || validation.status() >= 400) collector.addFailure("UI-007", `authentication validation failed: ${config.persona}`);
        await verifyPersona(page, config, collector);
      } catch (error) { collector.addFailure("UI-007", error instanceof Error ? error.message : "authentication validation failed"); }
    }
    const now = runtime.clock ?? Date.now;
    const deadline = now() + config.durationMs;
    let index = 0; let snapshotIndex = 0; let priorAction: Action | undefined;
    while (index < config.maxActions) {
      let action = plan.actions[index];
      if (!action && selector) {
        if (runtime.actionBudget && !runtime.actionBudget.canConsume()) return finish({ outcome: "partial", terminationReason: "rate_limit" });
        const next = await selector(page, priorAction);
        if (next.kind === "hold") return finish({ outcome: "partial", terminationReason: "hold" });
        if (next.kind === "stop") break;
        action = next.action;
        plan.actions.push(action);
      }
      if (!action) break;
      assertSafeAction(action, config);
      if (now() >= deadline) return finish({ outcome: "partial", terminationReason: "duration_limit" });
      if (runtime.actionBudget && !runtime.actionBudget.tryConsume()) return finish({ outcome: "partial", terminationReason: "rate_limit" });
      try {
        await executeAction(page, action, plan, config, Math.min(30_000, Math.max(1, deadline - now())));
        await verifyPersona(page, config, collector);
      } catch (error) {
        collector.addFailure("UI-006", error instanceof Error ? error.message : "action timeout");
        break;
      }
      if (config.artifacts.domSnapshots) {
        try { await writeDomSnapshot(page, collector, config, ++snapshotIndex, action.id); collector.recordDomSnapshot(); }
        catch (error) { if (error instanceof ArtifactLimitError) return finish({ outcome: "partial", terminationReason: "artifact_limit" }); collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "DOM snapshot failure"); return finish({ outcome: "error", terminationReason: "artifact_failure" }); }
      }
      priorAction = action;
      index += 1;
    }
    if (forcedOutcome) return finish({ outcome: forcedOutcome, terminationReason: forcedOutcome === "passed" ? "completed" : "machine_failure" });
    if (selector && index >= config.maxActions && config.obligations.length > 0 && !await obligationsMet(page, config)) return finish({ outcome: "partial", terminationReason: "max_actions" });
    if (!await obligationsMet(page, config)) return finish({ outcome: "partial", terminationReason: "obligations_unmet" });
    if (collector.failures.length) return finish({ outcome: "failed", terminationReason: "machine_failure" });
    final = { outcome: "passed", terminationReason: "completed" };
    return final;
  } catch (error) {
    collector.markExecutorFailure();
    collector.addFailure("UI-008", error instanceof Error ? error.message : "executor infrastructure error");
    final = { outcome: "error", terminationReason: "executor_error" };
    return final;
  } finally {
    if (context) {
      const nonPass = final.outcome !== "passed" || collector.failures.length > 0;
      if (nonPass && page) {
        try { await redactBeforeScreenshot(page); await page.screenshot({ path: collector.paths.screenshot, fullPage: true }); }
        catch (error) { collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "screenshot failure"); }
        try { await context.tracing.stop({ path: collector.paths.trace }); }
        catch (error) { collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "trace failure"); }
      } else await context.tracing.stop().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
    if (harTempDir) {
      try { await writeSanitizedHar(harTempPath!, collector.paths.networkHar); }
      catch (error) { collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "HAR sanitization failure"); }
      try { await rm(harTempDir, { recursive: true, force: true }); }
      catch (error) { collector.markArtifactFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "HAR cleanup failure"); }
    }
    if (requiresReset) {
      try { await resetFixture(config); } catch (error) { collector.markExecutorFailure(); collector.addFailure("UI-008", error instanceof Error ? error.message : "fixture reset failure"); }
    }
  }
}

export async function runLakda(config: LakdaConfig, replayInput?: string, runtime: RunRuntimeContext = {}): Promise<RunResult> {
  const actionBudget = runtime.actionBudget ?? new ActionBudget(config.safety.maxActionsPerMinute, runtime.clock);
  const resolvedRuntime = { ...runtime, actionBudget };
  const collector = await ArtifactCollector.create(config, config.mode, resolvedRuntime);
  let plan: ActionPlan = { schemaVersion: "lakda/action-plan/v1", mode: config.mode, seed: config.seed, baseUrl: config.baseUrl ?? "", actions: [] };
  let llmStatus: LlmStatus = "not_requested";
  let execution!: ExecutionResult;
  try {
    if (replayInput) {
      plan = validateActionPlan(await readJson(replayInput), config);
      plan.mode = "regression-replay";
      execution = !actionBudget.canConsume() ? { outcome: "partial", terminationReason: "rate_limit" } : await executePlan(config, plan, collector, resolvedRuntime);
    } else if (!actionBudget.canConsume()) {
      execution = { outcome: "partial", terminationReason: "rate_limit" };
    } else if (config.mode === "llm-explore") {
      const available = safeActions(config.actionCatalog, config);
      const client = new LocalLlmClient(config);
      try {
        await client.preflight(); llmStatus = "available";
        plan = { schemaVersion: "lakda/action-plan/v1", mode: "llm-explore", seed: config.seed, baseUrl: config.baseUrl!, actions: [] };
        execution = await executePlan(config, plan, collector, resolvedRuntime, undefined, async (page, priorAction) => {
          if (available.length === 0) return { kind: "stop" };
          const { decision, evidence } = await client.decide(available, { currentUrl: page.url(), visibleRoles: await visibleRoleSummary(page), priorAction: priorAction?.id ?? null, machineFailures: collector.failures.map(failure => failure.ruleId), risk: "select only one supplied safe candidate" });
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
        execution = { outcome: "error", terminationReason: "llm_error" };
      }
    } else {
      plan = createActionPlan(config, config.mode);
      llmStatus = config.llm.enabled ? await probeLlm(config) : "not_requested";
      execution = await executePlan(config, plan, collector, resolvedRuntime);
    }
  } catch (error) {
    collector.markExecutorFailure();
    collector.addFailure("UI-008", error instanceof Error ? error.message : "run error");
    execution = { outcome: "error", terminationReason: "executor_error" };
  }

  if (execution.outcome !== "error" && collector.artifactFailure) execution = { outcome: "error", terminationReason: "artifact_failure" };
  if (execution.outcome !== "error" && collector.executorFailure) execution = { outcome: "error", terminationReason: "executor_error" };

  let manifestPath: string | undefined;
  try {
    const finalized = await collector.finalize(plan, execution.outcome, exitCode(execution.outcome), llmStatus, execution.terminationReason);

    let policy = await inspectArtifactPolicy(finalized.runDir, config, execution.outcome, collector.metadata.artifactPolicy.expectations);
    let resolved = applyArtifactPolicy(execution, policy);
    for (let pass = 0; pass < 3; pass += 1) {
      if (policy.sizeExceeded && await removeOptionalDomSnapshots(collector)) {
        if (resolved.outcome !== "error") resolved = { outcome: "partial", terminationReason: "artifact_limit" };
        policy = await inspectArtifactPolicy(finalized.runDir, config, resolved.outcome, collector.metadata.artifactPolicy.expectations);
      }
      if (policy.residualSensitivePaths.length > 0) {
        await removeSensitiveArtifacts(finalized.runDir, policy.residualSensitivePaths);
        collector.markArtifactFailure();
        collector.addFailure("UI-008", "artifact security scan failed");
        resolved = { outcome: "error", terminationReason: "artifact_failure" };
      }
      await collector.updateOutcome(resolved.outcome, exitCode(resolved.outcome), resolved.terminationReason);
      const finalPolicy = await inspectArtifactPolicy(finalized.runDir, config, resolved.outcome, collector.metadata.artifactPolicy.expectations);
      const next = applyArtifactPolicy(resolved, finalPolicy);
      policy = finalPolicy;
      if (next.outcome === resolved.outcome && next.terminationReason === resolved.terminationReason && finalPolicy.residualSensitivePaths.length === 0) break;
      resolved = next;
      if (pass === 2) throw new Error("artifact policyが最終bytesで収束しません");
    }
    await exportHate(finalized.runDir, finalized.manifestPath, policy.securityByPath);
    manifestPath = finalized.manifestPath;
    return { runId: collector.metadata.runId, attempt: 1, outcome: resolved.outcome, exitCode: exitCode(resolved.outcome), terminationReason: resolved.terminationReason, workerIndex: collector.metadata.workerIndex, ...(collector.metadata.batchId ? { batchId: collector.metadata.batchId } : {}), artifactManifestPath: manifestPath, actionSequencePath: collector.paths.actionSequence, failures: collector.failures, llmStatus };
  } catch (error) {
    collector.markArtifactFailure();
    collector.addFailure("UI-008", error instanceof Error ? error.message : "artifact finalization failed");
    try { await collector.updateOutcome("error", 1, "artifact_failure"); } catch { /* preserve the original failure */ }
    return { runId: collector.metadata.runId, attempt: 1, outcome: "error", exitCode: 1, terminationReason: "artifact_failure", workerIndex: collector.metadata.workerIndex, ...(collector.metadata.batchId ? { batchId: collector.metadata.batchId } : {}), ...(manifestPath ? { artifactManifestPath: manifestPath } : {}), actionSequencePath: collector.paths.actionSequence, failures: collector.failures, llmStatus };
  }
}

export async function runLakdaBatch(config: LakdaConfig, replayInput?: string, runtime: RunRuntimeContext = {}): Promise<RunBatchResult> {
  const now = runtime.clock ?? Date.now;
  const batchId = runtime.batchId ?? `lakda:batch-${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
  const actionBudget = runtime.actionBudget ?? new ActionBudget(config.safety.maxActionsPerMinute, runtime.clock);
  const workerResults: WorkerRunEntry[] = [];
  for (let workerIndex = 0; workerIndex < config.workers; workerIndex += 1) {
    const seed = workerSeed(config.seed, workerIndex);
    const workerConfig: LakdaConfig = { ...config, workers: 1, seed, llm: { ...config.llm, seed } };
    try {
      const result = await runLakda(workerConfig, replayInput, { ...runtime, workerIndex, batchId, actionBudget });
      workerResults.push({ workerIndex, seed, status: "completed", result });
    } catch (error) {
      workerResults.push({ workerIndex, seed, status: "error", error: { name: error instanceof Error ? error.name : "Error", message: "worker execution failed" } });
    }
  }
  const outcomes = workerResults.filter((entry): entry is Extract<WorkerRunEntry, { status: "completed" }> => entry.status === "completed").map(entry => entry.result.outcome);
  const outcome = workerResults.some(entry => entry.status === "error") ? "error" : aggregateOutcomes(outcomes);
  return { schemaVersion: "lakda/run-batch/v1", batchId, outcome, exitCode: exitCode(outcome), requestedWorkers: config.workers, completedWorkers: workerResults.filter(entry => entry.status === "completed").length, workerResults };
}

export async function loadRunConfig(overrides: Partial<LakdaConfig>): Promise<LakdaConfig> { return loadConfig(undefined, overrides); }
export async function readActionSequence(input: string): Promise<ActionPlan> { return JSON.parse(await readFile(input, "utf8")) as ActionPlan; }
