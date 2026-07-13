import type { Action, ActionPlan, LakdaConfig, RunMode } from "./types.js";
import { safeActions } from "./safety.js";

/** v1 deterministic PRNG: 32-bit mulberry32. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function workerSeed(baseSeed: number, workerIndex = 0): number {
  if (!Number.isInteger(baseSeed) || !Number.isInteger(workerIndex) || workerIndex < 0) throw new Error("worker seedは整数のbaseSeedと0以上のworkerIndexで指定します");
  return (baseSeed + workerIndex) >>> 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function createActionPlan(config: LakdaConfig, mode: RunMode = config.mode, workerIndex = 0): ActionPlan {
  if (!config.baseUrl) throw new Error("--base-url または config.baseUrl が必要です");
  const seed = workerSeed(config.seed, workerIndex);
  const candidates = safeActions(config.actionCatalog, config);
  const base: Action[] = candidates.length ? candidates : [{ id: "navigate-root", kind: "navigate", path: "/" }];
  const shuffled = [...base];
  const random = mulberry32(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  const byId = new Map(base.map(action => [action.id, action]));
  const smoke = config.profiles.smoke.actionIds.map(id => byId.get(id)!);
  const randomPool = config.profiles.seededRandom.candidateIds
    ? shuffled.filter(action => config.profiles.seededRandom.candidateIds!.includes(action.id))
    : shuffled;
  const randomCount = Math.min(randomPool.length, config.profiles.seededRandom.count ?? config.maxActions);
  const actions = mode === "seeded-random"
    ? randomPool.slice(0, randomCount)
    : mode === "smoke" ? smoke.slice(0, config.maxActions) : [base[0]];
  return { schemaVersion: "lakda/action-plan/v1", mode, seed, baseUrl: new URL(config.baseUrl).toString(), actions };
}

export function validateActionPlan(value: unknown, config: LakdaConfig): ActionPlan {
  if (!value || typeof value !== "object") throw new Error("action sequence はobjectである必要があります");
  const plan = value as Partial<ActionPlan>;
  if (plan.schemaVersion !== "lakda/action-plan/v1" || !Array.isArray(plan.actions) || typeof plan.seed !== "number" || typeof plan.baseUrl !== "string") throw new Error("action sequence の形式が不正です");
  const withBase = { ...config, baseUrl: plan.baseUrl, seed: plan.seed, actionCatalog: plan.actions, candidates: plan.actions };
  safeActions(plan.actions, withBase);
  return { schemaVersion: "lakda/action-plan/v1", mode: plan.mode ?? "regression-replay", seed: plan.seed, baseUrl: plan.baseUrl, actions: plan.actions };
}
