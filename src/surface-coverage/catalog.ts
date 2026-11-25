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
export interface Screen extends Place { channel: string }
export interface Api extends Place { method: string }
export interface Catalog {
  schema: "lakda/surface-catalog/v1"; product: string; version: string; environment: string; revision: string;
  screens: Screen[]; apis: Api[]; relations: { screen: string; api: string }[];
}
const ambiguousPlaces = new WeakMap<Place, Place[]>();
function place(raw: Record<string, unknown>): Place {
  const origin = text(raw.origin), path = text(raw.path), url = new URL(origin);
  check(["http:", "https:"].includes(url.protocol) && url.origin === origin && !url.username && !url.password);
  check(path === "/" || /^\/(?:[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*|\{[A-Za-z][A-Za-z0-9_]*\})(?:\/(?:[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*|\{[A-Za-z][A-Za-z0-9_]*\}))*$/.test(path));
  check(typeof raw.frequency === "number" && Number.isFinite(raw.frequency) && raw.frequency >= 0);
  return { id: id(raw.id), name: text(raw.name), origin, path, frequency: raw.frequency };
}
/** Owner policy is applied before the catalog leaves this module. No raw catalog is returned. */
export function readCatalog(value: unknown): Catalog {
  try {
    const raw = obj(value);
    keys(raw, ["schema", "product", "version", "environment", "revision", "screens", "apis", "relations", "publication"]);
    check(raw.schema === "lakda/surface-catalog/v1");
    const screens = unique(array(raw.screens).map(v => { const r = obj(v); keys(r, ["id", "name", "origin", "path", "frequency", "channel"]); return { ...place(r), channel: text(r.channel) }; }), r => r.id);
    const apis = unique(array(raw.apis).map(v => { const r = obj(v); keys(r, ["id", "name", "origin", "path", "frequency", "method"]); const method = text(r.method); check(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)); return { ...place(r), method }; }), r => r.id);
    const screenIds = new Set(screens.map(s => s.id)), apiIds = new Set(apis.map(a => a.id));
    const relations = unique(array(raw.relations).map(v => { const r = obj(v); keys(r, ["screen", "api"]); const screen = id(r.screen), api = id(r.api); check(screenIds.has(screen) && apiIds.has(api)); return { screen, api }; }), r => relationId(r.screen, r.api));
    const policy = obj(raw.publication); keys(policy, ["screens", "apis"]);
    const allowedScreens = new Set(unique(array(policy.screens).map(id), s => s));
    const allowedApis = new Set(unique(array(policy.apis).map(id), s => s));
    check([...allowedScreens].every(s => screenIds.has(s)) && [...allowedApis].every(a => apiIds.has(a)));
    // Ambiguous private templates must still suppress a visible match, without exposing their identity.
    const unambiguous = <T extends Place>(items: T[], allowed: Set<string>) => items.filter(p => allowed.has(p.id)).map(p => {
      const visible = { ...p };
      ambiguousPlaces.set(visible, items.filter(other => other.id !== p.id && other.origin === p.origin &&
        (!("method" in p) || (other as Place & { method?: string }).method === p.method) && overlaps(other.path, p.path)));
      return visible;
    });
    const visibleScreens = unambiguous(screens, allowedScreens), visibleApis = unambiguous(apis, allowedApis);
    // Matching exclusions live only in a WeakMap, never in serialized output or evidence.
    return { schema: "lakda/surface-catalog/v1", product: text(raw.product), version: text(raw.version), environment: text(raw.environment), revision: text(raw.revision),
      screens: visibleScreens, apis: visibleApis, relations: relations.filter(r => allowedScreens.has(r.screen) && allowedApis.has(r.api)) };
  } catch { throw new Error("Invalid surface catalog or publication policy"); }
}
function overlaps(a: string, b: string): boolean {
  const left = a.split("/"), right = b.split("/");
  return left.length === right.length && left.every((s, i) => s === right[i] || s.startsWith("{") || right[i].startsWith("{"));
}
export function match<T extends Place>(items: T[], rawUrl: string): T | undefined {
  try {
    const url = new URL(rawUrl);
    const matches = (p: Place) => {
      const template = p.path.split("/"), actual = url.pathname.split("/");
      return p.origin === url.origin && template.length === actual.length &&
        template.every((part, i) => part.startsWith("{") ? actual[i].length > 0 : part === actual[i]);
    };
    const found = items.filter(p => matches(p) && !(ambiguousPlaces.get(p) ?? []).some(matches));
    return found.length === 1 ? found[0] : undefined;
  } catch { return undefined; }
}
export function definition(p: Place | { screen: string; api: string }): string {
  // Frequency and human labels can change without falsifying execution identity.
  return "screen" in p ? digest([p.screen, p.api]) : digest([p.id, p.origin, p.path, "method" in p ? p.method : "", "channel" in p ? p.channel : ""]);
}
export const scope = (c: Catalog) => ({ screens: c.screens.map(p => ({ id: p.id, digest: definition(p) })), apis: c.apis.map(p => ({ id: p.id, digest: definition(p) })),
  relations: c.relations.map(p => ({ id: relationId(p.screen, p.api), digest: digest([definition(p), definition(c.screens.find(s => s.id === p.screen)!), definition(c.apis.find(a => a.id === p.api)!)]) })) });
export async function loadCatalog(file: string): Promise<Catalog> {
  try { const bytes = await readFile(file); check(bytes.length <= 8 * 1024 * 1024); return readCatalog(JSON.parse(bytes.toString("utf8"))); }
  catch { throw new Error("Cannot read surface catalog or publication policy"); }
}
