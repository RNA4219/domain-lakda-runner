import { object, type JsonObject } from "../runs/catalog-values.js";
import { label, list, requireValue, type DomainMap } from "./model.js";

export type Verdict = "passed" | "failed" | "partial";
export interface Observation {
  result: Verdict; source: string;
  comparisons?: { field: string; expected: unknown; actual: unknown }[];
}
export interface CaseRecord { revision: string; checks: Map<string, Observation> }
export interface Run { id: string; cases: Map<string, CaseRecord> }
export function verdict(value: unknown): Verdict {
  requireValue(value === "passed" || value === "failed" || value === "partial", "確認項目の結果が不明です");
  return value;
}
export function addCase(run: Run, id: unknown, revision: unknown): CaseRecord {
  const key = label(id,"実行ケース");
  requireValue(!run.cases.has(key), "今回のケースが重複しています: " + key);
  const c: CaseRecord = { revision: label(revision,"実行ケース版"), checks: new Map() };
  run.cases.set(key,c);
  return c;
}
export function readObservations(map: DomainMap, data: JsonObject): Run {
  requireValue(data.product === map.product && data.version === map.version, "製品または対象版が一致しません");
  if (data.schema === "lakda/domain-run/v1") {
    const run: Run = { id: label(data.runId,"実行回"), cases: new Map() };
    if (map.environment !== null) requireValue(data.environment === map.environment, "対象環境が一致しません");
    for (const [i,v] of list(data.cases,"今回のケース").entries()) {
      const row = object(v,"今回のケース"), c = addCase(run,row.id,row.revision);
      for (const [j,item] of list(row.checks,"今回の確認項目").entries()) {
        const observed = object(item,"観測"), id = label(observed.id,"確認項目ID");
        requireValue(!c.checks.has(id), "確認項目の結果が重複しています");
        c.checks.set(id,{ result: verdict(observed.result), source: "#/cases/"+i+"/checks/"+j });
      }
    }
    return run;
  }
  requireValue(data.schema === undefined && data.schemaVersion === undefined && map.environment === null, "操作記録の形式または環境が一致しません");
  const run: Run = { id: label(data.startedAt,"開始時刻"), cases: new Map() };
  requireValue(Number.isFinite(Date.parse(run.id)), "開始時刻が不正です");
  const revision = Number.isSafeInteger(data.caseRevision) ? String(data.caseRevision) : data.caseRevision;
  const record = addCase(run,data.caseId,revision), planned = map.cases.find(c => c.id === data.caseId && c.revision === revision);
  const steps = list(data.steps,"steps").map(s => object(s,"操作記録"));
  for (const h of planned?.checks ?? []) {
    if (!h.step) continue;
    const { action, equals } = h.step;
    const indices = steps.flatMap((s,i) => s.action === action ? [i] : []);
    requireValue(indices.length < 2, "同じ名前の操作が複数あり特定できません: " + action);
    if (!indices.length) continue;
    const i = indices[0], s = steps[i];
    const keys = Object.keys(equals);
    if (!keys.every(k => Object.hasOwn(s,k))) continue;
    const result = keys.every(k => s[k] === equals[k]) ? "passed" : "failed";
    record.checks.set(h.id,{ result, source: "#/steps/"+i,
      comparisons: keys.map(field => ({ field, expected: equals[field], actual: s[field] })) });
  }
  return run;
}
