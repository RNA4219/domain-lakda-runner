import type { Locator } from "playwright";
import type { ActionCandidate, DialogHandling, ExecutionResult, LocatorRecipe, LocatorScope, SettlePolicy } from "../../adaptive/contracts.js";
import type { ExecuteContext } from "../types.js";
import type { Target } from "./observation.js";

export const DEFAULT_SETTLE_POLICY: SettlePolicy = { maxWaitMs: 5_000, stableWindowMs: 200, policyVersion: "lightweight-dom/v1" };
export function statusFor(error: unknown): ExecutionResult["status"] {
  const text = error instanceof Error ? error.message : "";
  if (/timeout/i.test(text)) return "timeout";
  if (/closed|detached|target.*(gone|lost)/i.test(text)) return "target_lost";
  if (/unsupported|input value provider/i.test(text)) return "unsupported";
  return "action_failed";
}
export function resolveDialogPolicy(candidate: ActionCandidate, context: ExecuteContext): { policy: DialogHandling; deniedReason?: string } {
  const dialog = candidate.contract?.dialog;
  if (!dialog) return { policy: "dismiss" };
  const handling = (dialog as { handling?: unknown }).handling;
  if (handling !== "dismiss" && handling !== "hold" && handling !== "accept") return { policy: "dismiss", deniedReason: "dialog_policy_invalid" };
  if (handling === "accept" && !context.allowedMutationKinds?.includes(candidate.mutationKind)) {
    return { policy: "dismiss", deniedReason: "dialog_accept_not_authorized" };
  }
  return { policy: handling };
}
export function scopeLocator(target: Target, scope: LocatorScope): Locator {
  if (scope.strategy === "test-id") return target.getByTestId(scope.value);
  if (scope.strategy === "stable-key") return target.locator(`[data-lakda-scope-key="${scope.value}"]`);
  return target.getByRole(scope.value as never, { name: scope.name, exact: true });
}
export function locateTarget(target: Target, recipe: LocatorRecipe): Locator {
  if (recipe.strategy === "test-id") return target.getByTestId(recipe.value);
  if (recipe.strategy === "role") return target.getByRole(recipe.value as never, { name: recipe.name, exact: true });
  if (recipe.strategy === "scoped-role") {
    if (!recipe.scope) throw new Error("scoped locator is missing scope");
    return scopeLocator(target, recipe.scope).getByRole(recipe.value as never, { name: recipe.name, exact: true });
  }
  if (recipe.strategy === "label") return target.getByLabel(recipe.value, { exact: true });
  if (recipe.strategy === "text") return target.getByText(recipe.value, { exact: true });
  throw new Error("unsupported locator recipe");
}

export type SettleRuntime = {
  targetPageId(target: Target): string | undefined;
  topologyEventCount(): number;
  pendingNetwork(targetId: string): number;
  networkChangedAt(targetId: string): number | undefined;
};
async function readinessSignal(target: Target, settle: SettlePolicy): Promise<{ state: "met" | "unmet"; reason: string }> {
    const readiness = settle.readiness;
    if (!readiness) return { state: "met", reason: "not-configured" };
    const selected = readiness.testId ? target.getByTestId(readiness.testId) : target.getByRole(readiness.role as never, { name: readiness.name, exact: true });
    const count = await selected.count();
    if (count !== 1) return { state: "unmet", reason: "locator-not-unique" };
    const visible = await selected.isVisible();
    const expected = readiness.state ?? "visible";
    return visible === (expected === "visible") ? { state: "met", reason: `state-${expected}` } : { state: "unmet", reason: `state-${expected}-not-met` };
  }
async function waitConsensus(target: Target, settle: SettlePolicy, runtime: SettleRuntime): Promise<ExecutionResult["settleResult"]> {
    const started = Date.now(); const pageId = runtime.targetPageId(target); let dom = await target.evaluate(() => document.documentElement?.innerHTML ?? ""); let domChanged = started; let topologySize = runtime.topologyEventCount(); let topologyChanged = started;
    let signals: NonNullable<ExecutionResult["settleResult"]["signals"]> = {};
    let consensusQuietSince: number | undefined;
    while (Date.now() - started < settle.maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, Math.max(10, Math.min(50, settle.stableWindowMs || 10))));
      const now = Date.now(); const nextDom = await target.evaluate(() => document.documentElement?.innerHTML ?? "");
      if (nextDom !== dom) { dom = nextDom; domChanged = now; }
      if (runtime.topologyEventCount() !== topologySize) { topologySize = runtime.topologyEventCount(); topologyChanged = now; }
      const networkActive = pageId ? runtime.pendingNetwork(pageId) : 0; const networkChanged = pageId ? runtime.networkChangedAt(pageId) ?? started : started;
      const readiness = await readinessSignal(target, settle); const quiet = (at: number) => now - at >= settle.stableWindowMs;
      signals = {
        domMutation: { state: quiet(domChanged) ? "quiet" : "pending", reason: quiet(domChanged) ? "dom-mutation-quiet" : "dom-changing" },
        network: { state: networkActive === 0 && quiet(networkChanged) ? "quiet" : "pending", reason: networkActive ? `in-flight-${networkActive}` : "network-recently-active" },
        topology: { state: quiet(topologyChanged) ? "quiet" : "pending", reason: quiet(topologyChanged) ? "target-topology-quiet" : "target-topology-changing" },
        readiness,
      };
      const consensusQuiet = signals.domMutation.state === "quiet" && signals.network.state === "quiet" && signals.topology.state === "quiet" && signals.readiness.state === "met";
      if (consensusQuiet) {
        consensusQuietSince ??= now;
        if (now - started < settle.maxWaitMs && now - consensusQuietSince >= Math.max(1, settle.stableWindowMs)) return { policyVersion: settle.policyVersion, status: "settled", elapsedMs: now - started, reasons: ["consensus-settled"], signals };
      } else consensusQuietSince = undefined;
    }
    return { policyVersion: settle.policyVersion, status: "timed_out", elapsedMs: Date.now() - started, reasons: ["consensus-timeout"], signals };
  }
export async function waitForPlaywrightSettle(target: Target, settle: SettlePolicy, runtime: SettleRuntime): Promise<ExecutionResult["settleResult"]> {
    if (settle.policyVersion === "consensus/v1") return waitConsensus(target, settle, runtime);
    const beforeSnapshot = await target.evaluate(() => [location.href, document.querySelectorAll("button,a,input,select,textarea,[role]").length, document.body?.innerText.slice(0, 512) ?? ""].join("|"));
    const started = Date.now(); let before = beforeSnapshot; let stable = started;
    while (Date.now() - started < settle.maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, Math.min(50, settle.stableWindowMs)));
      const after = await target.evaluate(() => [location.href, document.querySelectorAll("button,a,input,select,textarea,[role]").length, document.body?.innerText.slice(0, 512) ?? ""].join("|"));
      if (after !== before) { before = after; stable = Date.now(); } else if (Date.now() - stable >= settle.stableWindowMs) return { policyVersion: settle.policyVersion, status: "settled", elapsedMs: Date.now() - started, reasons: ["dom-stable"] };
    }
    return { policyVersion: settle.policyVersion, status: "timed_out", elapsedMs: Date.now() - started, reasons: ["settle-timeout"] };
  }
