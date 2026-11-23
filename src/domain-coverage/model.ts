import { object, type JsonObject } from "../runs/catalog-values.js";

export function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function label(value: unknown, name: string): string {
  requireValue(typeof value === "string" && value.trim() && value === value.trim(), name + " に空白でない文字列が必要です");
  return value;
}
export function list(value: unknown, name: string): unknown[] {
  requireValue(Array.isArray(value), name + " に配列が必要です");
  return value;
}
function unique<T>(values: T[], key: (item: T) => string, name: string): T[] {
  const seen = new Set<string>();
  for (const value of values) {
    const id = key(value);
    requireValue(!seen.has(id), name + " が重複しています: " + id);
    seen.add(id);
  }
  return values;
}
export function strictKeys(row: JsonObject, allowed: string[], name: string) {
  for (const key of Object.keys(row)) requireValue(allowed.includes(key), name + " の未定義項目: " + key);
}
function strings(value: unknown, name: string) {
  return unique(list(value, name).map(v => label(v, name)), s => s, name);
}
type Target = string | { from: string; to: string; label: string };
export function targetKey(target: Target): string {
  return JSON.stringify(typeof target === "string" ? [target] : [target.from, target.to, target.label]);
}
function edge(value: unknown) {
  const e = object(value, "connection");
  return { from: label(e.from, "from"), to: label(e.to, "to"), label: label(e.label, "label") };
}
function architecture(value: unknown) {
  const graph = object(value, "architecture");
  requireValue(graph.schema === "aym.architecture/v1", "構成図の形式が不明です");
  const nodes = unique(list(graph.nodes, "nodes").map(value => {
    const n = object(value, "node");
    const kind = label(n.kind, "kind");
    requireValue(["repository", "service", "store", "external"].includes(kind), "構成要素の種類が不明です");
    return { id: label(n.id, "node.id"), name: label(n.name, "node.name"), kind,
      type: n.type ? label(n.type, "node.type") : "", description: n.description ? label(n.description, "node.description") : "" };
  }), n => n.id, "構成要素");
  requireValue(nodes.length, "構成要素が必要です");
  const ids = new Set(nodes.map(n => n.id));
  const connections = unique(list(graph.connections, "connections").map(value => {
    const row = object(value, "connection"), e = edge(row);
    requireValue(ids.has(e.from) && ids.has(e.to) && e.from !== e.to, "接続元・接続先が不正です");
    return { ...e, evidence: row.evidence ? label(row.evidence, "接続の出典") : "" };
  }), targetKey, "接続");
  return { name: label(graph.name, "構成図名"), nodes, connections };
}
export interface Check {
  id: string; behaviors: string[];
  step?: { action: string; equals: JsonObject };
  obligation?: number;
}
export interface PlannedCase { id: string; revision: string; checks: Check[]; obligations?: JsonObject[] }
export function readMap(value: unknown, graphValue: unknown) {
  const raw = object(value, "map");
  strictKeys(raw, ["schema","architecture","product","version","environment","behaviors","cases"], "map");
  requireValue(raw.schema === "lakda/domain-map/v1", "マッピングの形式が不明です");
  const graph = architecture(graphValue);
  const targets = new Set([...graph.nodes.map(n => targetKey(n.id)), ...graph.connections.map(targetKey)]);
  const behaviors = unique(list(raw.behaviors, "behaviors").map(value => {
    const b = object(value, "behavior");
    strictKeys(b, ["id","domain","title","source","criterion","targets","excluded"], "behavior");
    const places = unique(list(b.targets, "targets").map(t => typeof t === "string" ? t : edge(t)), targetKey, "対象");
    requireValue(places.length && places.every(t => targets.has(targetKey(t))), "構成図にない要素または接続です");
    return { id: label(b.id, "behavior.id"), domain: label(b.domain, "業務名"), title: label(b.title, "振る舞い"),
      source: label(b.source, "出典"), criterion: label(b.criterion, "受入条件"), targets: places,
      excluded: b.excluded === undefined ? null : label(b.excluded, "対象外の理由") };
  }), b => b.id, "振る舞い");
  const ids = new Set(behaviors.map(b => b.id));
  const cases: PlannedCase[] = unique(list(raw.cases, "cases").map(value => {
    const c = object(value, "case");
    strictKeys(c, ["id","revision","checks","obligations"], "case");
    const obligations = c.obligations === undefined ? undefined : list(c.obligations,"obligations").map(v => object(v,"判定条件"));
    const checks: Check[] = unique(list(c.checks,"checks").map(value => {
      const h = object(value,"check");
      strictKeys(h, ["id","behaviors","step","obligation"], "check");
      const refs = strings(h.behaviors, "対応する振る舞い");
      requireValue(refs.length && refs.every(id => ids.has(id)), "対応先の振る舞いが不明です");
      const check: Check = { id: label(h.id, "check.id"), behaviors: refs };
      if (h.step !== undefined) {
        const step = object(h.step,"step");
        strictKeys(step, ["action","equals"], "step");
        const equals = object(step.equals,"期待値");
        requireValue(Object.keys(equals).length && Object.values(equals).every(v => ["number","string","boolean"].includes(typeof v)), "観測する値が必要です");
        check.step = { action: label(step.action,"操作名"), equals };
      }
      if (h.obligation !== undefined) {
        requireValue(typeof h.obligation === "number" && Number.isSafeInteger(h.obligation) && h.obligation > 0 &&
          obligations && h.obligation <= obligations.length, "判定条件番号が範囲外です");
        check.obligation = h.obligation;
      }
      return check;
    }), h => h.id, "確認項目");
    return { id: label(c.id,"case.id"), revision: label(c.revision,"ケース版"), checks, obligations };
  }), c => c.id, "ケース");
  return { product: label(raw.product,"製品"), version: label(raw.version,"対象版"),
    environment: raw.environment === undefined ? null : label(raw.environment,"環境"), graph, behaviors, cases };
}
export type DomainMap = ReturnType<typeof readMap>;
