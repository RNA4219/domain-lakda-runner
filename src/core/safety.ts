import type { Action, LakdaConfig, Locator } from "./types.js";

const destructive = /(delete|deactivate|billing|transfer|remove|destroy|解約|削除|送金|支払)/i;
const navigationKinds = new Set(["navigate", "goto"]);
const pressKeys = new Set(["Enter", "Escape", "Space", "Tab"]);
function withinPathPrefixes(pathname: string, prefixes: string[] | undefined): boolean {
  if (prefixes === undefined) return true;
  return prefixes.some(prefix => {
    const normalized = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return normalized === "/" || pathname === normalized || pathname.startsWith(`${normalized}/`);
  });
}

export function assertLoopbackEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("LLM endpoint は http のloopbackだけを許可します");
  return url;
}

function assertLocator(locator: Locator | undefined, actionId: string): void {
  if (!locator) throw new Error(`宣言型locatorが必要です: ${actionId}`);
  const hasTestId = typeof locator.testId === "string" && locator.testId.length > 0;
  const hasRole = typeof locator.role === "string";
  const hasName = typeof locator.name === "string" && locator.name.length > 0;
  if (hasTestId === hasRole || (hasRole && !hasName) || (!hasTestId && !hasRole)) {
    throw new Error(`locator は test-id または role/name のいずれかです: ${actionId}`);
  }
}

export function assertSafeAction(action: Action, config: LakdaConfig): void {
  if (!action.id || action.id !== action.id.trim()) throw new Error("candidate ID は空白なしで必須です");
  const label = `${action.id} ${action.kind} ${action.accessibleName ?? ""} ${action.locator?.name ?? ""} ${action.locator?.testId ?? ""}`;
  if (config.safety.denyActionKinds.some(kind => label.toLowerCase().includes(kind.toLowerCase())) || destructive.test(label)) {
    throw new Error(`deny policyにより拒否: ${action.id}`);
  }
  if (action.selector) throw new Error(`CSS/XPath selectorは禁止です: ${action.id}`);
  if (action.value !== undefined) throw new Error(`actionの直接valueは禁止です: ${action.id}`);
  if (navigationKinds.has(action.kind)) {
    if (!action.path || action.locator) throw new Error(`navigation action はpathのみを指定します: ${action.id}`);
    const target = new URL(action.path, config.baseUrl);
    if (!config.safety.allowHosts.includes(target.hostname)) throw new Error(`allowlist外URL: ${target.hostname}`);
    if (!withinPathPrefixes(target.pathname, config.safety.pathPrefixes)) throw new Error(`allowlist外path: ${target.pathname}`);
  } else {
    if (action.path) throw new Error(`browser操作にpathは指定できません: ${action.id}`);
    assertLocator(action.locator, action.id);
    if (["fill", "select"].includes(action.kind) && (!action.inputProfileId || config.inputProfiles[action.inputProfileId] === undefined)) {
      throw new Error(`inputProfileIdが未定義です: ${action.id}`);
    }
    if (action.kind === "press" && (!action.key || !pressKeys.has(action.key))) throw new Error(`許可されないpress keyです: ${action.id}`);
  }
  if (action.mutates && config.safety.requireFixtureResetForMutations && !config.fixtureReset) {
    throw new Error(`fixture reset未設定の変更操作: ${action.id}`);
  }
}

export function safeActions(actions: Action[], config: LakdaConfig): Action[] {
  const ids = new Set<string>();
  return actions
    .map(action => ({ ...action, id: action.id.trim() }))
    .sort((a, b) => `${a.kind}\u0000${a.locator?.role ?? ""}\u0000${a.locator?.name ?? a.locator?.testId ?? a.accessibleName ?? ""}\u0000${a.path ?? ""}\u0000${a.id}`.localeCompare(`${b.kind}\u0000${b.locator?.role ?? ""}\u0000${b.locator?.name ?? b.locator?.testId ?? b.accessibleName ?? ""}\u0000${b.path ?? ""}\u0000${b.id}`))
    .filter(action => {
      if (ids.has(action.id)) throw new Error(`candidate ID 重複: ${action.id}`);
      ids.add(action.id);
      assertSafeAction(action, config);
      return true;
    });
}