import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function check(value: unknown): asserts value { if (!value) throw new Error("Invalid surface coverage contract"); }
export function obj(value: unknown): Record<string, unknown> { check(value && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; }
export function keys(row: Record<string, unknown>, allowed: string[]) { check(Object.keys(row).every(k => allowed.includes(k))); }
export function array(value: unknown): unknown[] { check(Array.isArray(value) && value.length <= 20_000); return value; }
export function text(value: unknown): string { check(typeof value === "string" && value.length > 0 && value.length <= 200 && [...value].every(c => c.charCodeAt(0) >= 32)); return value; }
export function id(value: unknown): string { const s = text(value); check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(s)); return s; }
export function unique<T>(items: T[], key: (v: T) => string): T[] { check(new Set(items.map(key)).size === items.length); return items; }
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const lanes = ["mock", "real", "unknown"] as const;
export type Lane = typeof lanes[number];
export function lane(value: unknown): Lane { check(lanes.includes(value as Lane)); return value as Lane; }
export const relationId = (s: string, a: string) => s + ":" + a;

export interface Place { id: string; name: string; origin: string; path: string; frequency: number }
export type ReadyRole = "button" | "link" | "textbox" | "checkbox" | "combobox" | "option" | "menuitem" | "tab";
export type ScreenReady = ({ testId: string } | { role: ReadyRole; name: string }) & { timeoutMs: number };
export interface Screen extends Place {
  channel: string; trailingSlash?: "either"; hashRoute?: string; state?: { testId: string }; ready?: ScreenReady;
}
export interface Api extends Place { method: string }
export interface Catalog {
  schema: "lakda/surface-catalog/v1"; product: string; version: string; environment: string; revision: string;
  screens: Screen[]; apis: Api[]; relations: { screen: string; api: string }[];
}
const blockers = new WeakMap<Place, Place[]>();
const hashPeers = new WeakMap<Screen, Screen[]>();
const routingContext = new WeakMap<Place, string>();
const withoutFinalSlash = (path: string) => path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
const eitherSlash = (place: Place) => "trailingSlash" in place && place.trailingSlash === "either";
function template(value: unknown): string {
  const path = text(value);
  check(path === "/" || /^\/(?:[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*|\{[A-Za-z][A-Za-z0-9_]*\})(?:\/(?:[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*|\{[A-Za-z][A-Za-z0-9_]*\}))*\/?$/.test(path));
  return path;
}
function place(raw: Record<string, unknown>): Place {
  const origin = text(raw.origin), path = template(raw.path), url = new URL(origin);
  check(["http:", "https:"].includes(url.protocol) && url.origin === origin && !url.username && !url.password);
  check(typeof raw.frequency === "number" && Number.isFinite(raw.frequency) && raw.frequency >= 0);
  return { id: id(raw.id), name: text(raw.name), origin, path, frequency: raw.frequency };
}
/** Owner policy is applied before the catalog leaves this module. No raw catalog is returned. */
export function readCatalog(value: unknown): Catalog {
  try {
    const raw = obj(value);
    keys(raw, ["schema", "product", "version", "environment", "revision", "screens", "apis", "relations", "publication"]);
    check(raw.schema === "lakda/surface-catalog/v1");
    const screens: Screen[] = unique(array(raw.screens).map(v => {
      const r = obj(v); keys(r, ["id", "name", "origin", "path", "frequency", "channel", "hashRoute", "state", "ready", "trailingSlash"]);
      const screen: Screen = { ...place(r), channel: text(r.channel) };
      if (r.trailingSlash !== undefined) {
        check(r.trailingSlash === "either");
        if (screen.path !== "/") {
          screen.trailingSlash = "either";
          screen.path = withoutFinalSlash(screen.path);
        }
      }
      if (r.hashRoute !== undefined) screen.hashRoute = template(r.hashRoute);
      if (r.state !== undefined) { const state = obj(r.state); keys(state, ["testId"]); screen.state = { testId: text(state.testId) }; }
      if (r.ready !== undefined) {
        const ready = obj(r.ready); keys(ready, ["testId", "role", "name", "timeoutMs"]); const timeoutMs = ready.timeoutMs ?? 5000;
        check(Number.isSafeInteger(timeoutMs) && Number(timeoutMs) >= 1 && Number(timeoutMs) <= 30_000);
        if (ready.testId !== undefined) {
          check(ready.role === undefined && ready.name === undefined);
          screen.ready = { testId: text(ready.testId), timeoutMs: Number(timeoutMs) };
        } else {
          const role = text(ready.role), name = text(ready.name);
          check(["button", "link", "textbox", "checkbox", "combobox", "option", "menuitem", "tab"].includes(role));
          check(name.trim().length > 0);
          screen.ready = { role: role as ReadyRole, name, timeoutMs: Number(timeoutMs) };
        }
      }
      return screen;
    }), r => r.id);
    const apis = unique(array(raw.apis).map(v => { const r = obj(v); keys(r, ["id", "name", "origin", "path", "frequency", "method"]); const method = text(r.method); check(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)); return { ...place(r), method }; }), r => r.id);
    const screenIds = new Set(screens.map(s => s.id)), apiIds = new Set(apis.map(a => a.id));
    const relations = unique(array(raw.relations).map(v => { const r = obj(v); keys(r, ["screen", "api"]); const screen = id(r.screen), api = id(r.api); check(screenIds.has(screen) && apiIds.has(api)); return { screen, api }; }), r => relationId(r.screen, r.api));
    const policy = obj(raw.publication); keys(policy, ["screens", "apis"]);
    const allowedScreens = new Set(unique(array(policy.screens).map(id), s => s));
    const allowedApis = new Set(unique(array(policy.apis).map(id), s => s));
    check([...allowedScreens].every(s => screenIds.has(s)) && [...allowedApis].every(a => apiIds.has(a)));
    const visibleScreens = screens.filter(s => allowedScreens.has(s.id));
    for (const screen of visibleScreens) {
      const excluded: Screen[] = [], fragmentRoutes: Screen[] = [], peers: string[] = [];
      const privateEffects = new Set<string>();
      let changedRouting = false;
      for (const other of screens) {
        if (other === screen || other.origin !== screen.origin || !screenOverlap(screen, other)) continue;
        if (!screen.hashRoute && other.hashRoute) fragmentRoutes.push(other);
        // A private overlap always vetoes attribution, irrespective of specificity or DOM state.
        if (!allowedScreens.has(other.id)) {
          excluded.push(other);
          if (!screen.hashRoute && other.hashRoute) privateEffects.add(JSON.stringify(["document", sharedPathname(screen, other)]));
          if (other.trailingSlash) privateEffects.add(JSON.stringify(["alias", sharedPathname(screen, other), other.hashRoute?.replace(/\{[^}]+\}/g, "{}")]));
          continue;
        }
        const order = specificity(other, screen);
        if (order > 0) excluded.push(other);
        if (order !== 0 || screen.trailingSlash || other.trailingSlash || (!screen.hashRoute && other.hashRoute)) changedRouting = true;
        peers.push(JSON.stringify([other.path, other.hashRoute, other.trailingSlash, other.state?.testId]));
      }
      blockers.set(screen, excluded);
      if (fragmentRoutes.length) hashPeers.set(screen, fragmentRoutes);
      if (changedRouting || privateEffects.size) routingContext.set(screen, digest([peers.sort(), [...privateEffects].sort()]));
    }
    const visibleApis = apis.filter(a => allowedApis.has(a.id));
    for (const api of visibleApis) blockers.set(api, apis.filter(other => other !== api && other.origin === api.origin &&
      other.method === api.method && overlaps(other.path, api.path)));
    // Matching exclusions live only in a WeakMap, never in serialized output or evidence.
    return { schema: "lakda/surface-catalog/v1", product: text(raw.product), version: text(raw.version), environment: text(raw.environment), revision: text(raw.revision),
      screens: visibleScreens, apis: visibleApis, relations: relations.filter(r => allowedScreens.has(r.screen) && allowedApis.has(r.api)) };
  } catch { throw new Error("Invalid surface catalog or publication policy"); }
}
function overlaps(a: string, b: string): boolean {
  const left = a.split("/"), right = b.split("/");
  return left.length === right.length && left.every((s, i) => s === right[i] || s.startsWith("{") && right[i].length > 0 || right[i].startsWith("{") && s.length > 0);
}
function screenOverlap(a: Screen, b: Screen): boolean {
  const either = a.trailingSlash || b.trailingSlash;
  return overlaps(either ? withoutFinalSlash(a.path) : a.path, either ? withoutFinalSlash(b.path) : b.path) &&
    (!a.hashRoute || !b.hashRoute || overlaps(a.hashRoute, b.hashRoute));
}

/** Fingerprint the shared pathname behavior. Private IDs, labels and parameter names do not define it. */
function sharedPathname(a: Screen, b: Screen) {
  const right = withoutFinalSlash(b.path).split("/");
  const parts = withoutFinalSlash(a.path).split("/").map((part, i) =>
    part.startsWith("{") ? (right[i].startsWith("{") ? "{}" : right[i]) : part);
  const slash = a.trailingSlash ? b.trailingSlash ?? b.path.endsWith("/") : a.path.endsWith("/");
  return [parts.join("/"), slash];
}

/** Compare literal positions on paths known to overlap. Opposing advantages are incomparable. */
function specificity(a: Screen, b: Screen): number {
  if (Boolean(a.hashRoute) !== Boolean(b.hashRoute)) return 0;
  const parts = (s: Screen) => [...withoutFinalSlash(s.path).split("/"), ...(s.hashRoute ?? "").split("/")];
  const left = parts(a), right = parts(b);
  let leftMore = false, rightMore = false;
  for (let i = 0; i < left.length; i++) {
    const leftVariable = left[i].startsWith("{"), rightVariable = right[i].startsWith("{");
    if (leftVariable && !rightVariable) rightMore = true;
    if (rightVariable && !leftVariable) leftMore = true;
  }
  return Number(leftMore) - Number(rightMore);
}
function matchesPath(path: string, actualPath: string): boolean {
  const template = path.split("/"), actual = actualPath.split("/");
  return template.length === actual.length && template.every((part, i) => part.startsWith("{") ? actual[i].length > 0 : part === actual[i]);
}
function matchesPathname(place: Place, pathname: string): boolean {
  return matchesPath(place.path, eitherSlash(place) ? withoutFinalSlash(pathname) : pathname);
}
export function matching<T extends Place>(items: T[], rawUrl: string): T[] {
  try {
    const url = new URL(rawUrl);
    const matches = (p: Place) => {
      return p.origin === url.origin && matchesPathname(p, url.pathname) &&
        (!("hashRoute" in p) || url.hash.startsWith("#/") && matchesPath(String(p.hashRoute), url.hash.slice(1).split(/[?#]/, 1)[0]));
    };
    const candidates = items.filter(p => matches(p) && !blockers.get(p)?.some(matches));
    // Only independently observed DOM states can disambiguate multiple maximal screen routes.
    if (candidates.length > 1 && candidates.some(p => "channel" in p && !("state" in p))) return [];
    return candidates;
  } catch { return []; }
}
export function match<T extends Place>(items: T[], rawUrl: string): T | undefined {
  const found = matching(items, rawUrl);
  return found.length === 1 ? found[0] : undefined;
}
export function matchStaticScreen(catalog: Catalog, rawUrl: string): Screen | undefined {
  const found = matching(catalog.screens, rawUrl);
  return found.length === 1 && !found[0].state ? found[0] : undefined;
}
/** An HTTP response omits the fragment. Only credit transport when that omission cannot change the selected screen. */
export function matchDocumentScreen(catalog: Catalog, responseUrl: string): Screen | undefined {
  const screen = matchStaticScreen(catalog, responseUrl);
  if (!screen) return;
  const pathname = new URL(responseUrl).pathname;
  if (!hashPeers.get(screen)?.some(peer => matchesPathname(peer, pathname))) return screen;
}
export function definition(p: Place | { screen: string; api: string }): string {
  // Frequency and human labels can change without falsifying execution identity.
  if ("screen" in p) return digest([p.screen, p.api]);
  const base: unknown[] = [p.id, p.origin, p.path, "method" in p ? p.method : "", "channel" in p ? p.channel : ""];
  if ("hashRoute" in p || "state" in p || "ready" in p) base.push({ hashRoute: "hashRoute" in p ? p.hashRoute : null, state: "state" in p ? p.state : null, ready: "ready" in p ? p.ready : null });
  if (eitherSlash(p)) base.push({ trailingSlash: "either" });
  if (routingContext.has(p)) base.push({ screenRoutePeers: routingContext.get(p) });
  return digest(base);
}
export const scope = (c: Catalog) => ({ screens: c.screens.map(p => ({ id: p.id, digest: definition(p) })), apis: c.apis.map(p => ({ id: p.id, digest: definition(p) })),
  relations: c.relations.map(p => ({ id: relationId(p.screen, p.api), digest: digest([definition(p), definition(c.screens.find(s => s.id === p.screen)!), definition(c.apis.find(a => a.id === p.api)!)]) })) });
export async function loadCatalog(file: string): Promise<Catalog> {
  try { const bytes = await readFile(file); check(bytes.length <= 8 * 1024 * 1024); return readCatalog(JSON.parse(bytes.toString("utf8"))); }
  catch { throw new Error("Cannot read surface catalog or publication policy"); }
}
