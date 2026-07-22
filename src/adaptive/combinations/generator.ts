import { canonicalJson } from "../../core/plan.js";
import { sha256 } from "../../core/redaction.js";
import {
  assertCombinationFactorModel,
  COMBINATION_CASE_SCHEMA_VERSION,
  COMBINATION_SUITE_SCHEMA_VERSION,
  LEGACY_COMBINATION_GENERATOR_VERSION,
  evaluateConstraint,
  factorById,
  factorIds,
  factorModelDigest,
  normalizedModel,
} from "./model.js";
import type { CombinationFactorModel, CombinationSuite, Constraint } from "./model.js";
function tupleKey(assignment: Record<string, string>, ids: string[]): string { return ids.map(id => `${id}=${assignment[id]}`).join("|"); }
function combinations(ids: string[], strength: number): string[][] {
  const result: string[][] = [];
  const visit = (start: number, selected: string[]): void => {
    if (selected.length === strength) { result.push([...selected]); return; }
    for (let index = start; index <= ids.length - (strength - selected.length); index += 1) visit(index + 1, [...selected, ids[index]]);
  };
  if (strength >= 1 && strength <= ids.length) visit(0, []);
  return result;
}
export function tupleKeys(model: CombinationFactorModel, assignment: Record<string, string>, strength: number, factorGroup?: string): string[] {
  const ids = factorIds(model);
  const groups = factorGroup ? ids.filter(id => factorById(model).get(id)?.group === factorGroup) : ids;
  const keys = combinations(ids, Math.min(2, strength)).map(combo => tupleKey(assignment, combo));
  if (strength > 2 && groups.length >= strength) keys.push(...combinations(groups, strength).map(combo => tupleKey(assignment, combo)));
  return [...new Set(keys)].sort();
}
function enumerateAssignmentsV1(model: CombinationFactorModel): Record<string, string>[] {
  const factors = [...model.factors].sort((left, right) => left.factorId.localeCompare(right.factorId));
  const estimate = factors.reduce((total, factor) => total * factor.values.length, 1);
  if (!Number.isSafeInteger(estimate) || estimate > 100_000) throw new Error(`factor assignment space is too large: ${estimate}`);
  const result: Record<string, string>[] = [];
  const visit = (index: number, assignment: Record<string, string>): void => {
    if (index === factors.length) { if (model.constraints.every(constraint => evaluateConstraint(constraint, assignment))) result.push({ ...assignment }); return; }
    for (const value of [...factors[index]!.values].sort((left, right) => left.localeCompare(right))) visit(index + 1, { ...assignment, [factors[index]!.factorId]: value });
  };
  visit(0, {});
  return result;
}

type PartialConstraint = true | false | "unknown";
type RequiredTuple = { key: string; assignments: Record<string, string>; maxIndex: number };
type Completion = (partial: Record<string, string>) => Record<string, string> | undefined;

function partialValue(value: unknown, assignment: Record<string, string>): { known: boolean; value?: unknown } {
  if (value && typeof value === "object" && !Array.isArray(value) && "factorRef" in value && typeof (value as { factorRef?: unknown }).factorRef === "string") {
    const factorId = (value as { factorRef: string }).factorRef;
    return Object.hasOwn(assignment, factorId) ? { known: true, value: assignment[factorId] } : { known: false };
  }
  return { known: true, value };
}
function evaluateConstraintPartial(constraint: Constraint, assignment: Record<string, string>): PartialConstraint {
  const knownFactor = constraint.factorId ? Object.hasOwn(assignment, constraint.factorId) : false;
  const eq = (): PartialConstraint => {
    const right = partialValue(constraint.value, assignment);
    if (!knownFactor || !right.known) return "unknown";
    return assignment[constraint.factorId!] === right.value;
  };
  switch (constraint.op) {
    case "allOf": { const values = (constraint.items ?? []).map(item => evaluateConstraintPartial(item, assignment)); return values.includes(false) ? false : values.every(value => value === true) ? true : "unknown"; }
    case "anyOf": { const values = (constraint.items ?? []).map(item => evaluateConstraintPartial(item, assignment)); return values.includes(true) ? true : values.every(value => value === false) ? false : "unknown"; }
    case "not": { const value = evaluateConstraintPartial(constraint.left!, assignment); return value === "unknown" ? value : !value; }
    case "implies": { const left = evaluateConstraintPartial(constraint.left!, assignment); const right = evaluateConstraintPartial(constraint.right!, assignment); if (left === false || right === true) return true; if (left === true) return right; return right === false ? "unknown" : "unknown"; }
    case "eq": return eq();
    case "neq": { const value = eq(); return value === "unknown" ? value : !value; }
    case "in": {
      if (!knownFactor) return "unknown";
      const values = (constraint.values ?? []).map(value => partialValue(value, assignment));
      if (values.some(value => value.known && value.value === assignment[constraint.factorId!])) return true;
      return values.some(value => !value.known) ? "unknown" : false;
    }
    case "notIn": { const value = evaluateConstraintPartial({ ...constraint, op: "in" }, assignment); return value === "unknown" ? value : !value; }
  }
}
function createCompleter(model: CombinationFactorModel): Completion {
  const factors = [...model.factors].sort((left, right) => left.factorId.localeCompare(right.factorId));
  const byId = factorById(model);
  const cache = new Map<string, Record<string, string> | null>();
  const complete = (partial: Record<string, string>): Record<string, string> | undefined => {
    if (Object.entries(partial).some(([factorId, value]) => !byId.get(factorId)?.values.includes(value))) return undefined;
    const key = canonicalJson(Object.fromEntries(Object.entries(partial).sort(([left], [right]) => left.localeCompare(right))));
    if (cache.has(key)) { const cached = cache.get(key); return cached ? { ...cached } : undefined; }
    const visit = (index: number, assignment: Record<string, string>): Record<string, string> | undefined => {
      if (model.constraints.some(constraint => evaluateConstraintPartial(constraint, assignment) === false)) return undefined;
      if (index === factors.length) return model.constraints.every(constraint => evaluateConstraint(constraint, assignment)) ? { ...assignment } : undefined;
      const factor = factors[index]!;
      if (Object.hasOwn(assignment, factor.factorId)) return visit(index + 1, assignment);
      for (const value of [...factor.values].sort((left, right) => left.localeCompare(right))) {
        const found = visit(index + 1, { ...assignment, [factor.factorId]: value });
        if (found) return found;
      }
      return undefined;
    };
    const result = visit(0, { ...partial });
    cache.set(key, result ?? null);
    return result ? { ...result } : undefined;
  };
  return complete;
}
function requiredTuplesV2(model: CombinationFactorModel, strength: number, factorGroup: string | undefined, complete: Completion): RequiredTuple[] {
  const factors = [...model.factors].sort((left, right) => left.factorId.localeCompare(right.factorId));
  const byId = factorById(model);
  const indexById = new Map(factors.map((factor, index) => [factor.factorId, index]));
  const ids = factors.map(factor => factor.factorId);
  const grouped = factorGroup ? factors.filter(factor => factor.group === factorGroup).map(factor => factor.factorId) : [];
  const specs = [...combinations(ids, 2), ...(strength > 2 && grouped.length >= strength ? combinations(grouped, strength) : [])];
  const tuples = new Map<string, RequiredTuple>();
  for (const spec of specs) {
    const visit = (index: number, assignment: Record<string, string>): void => {
      if (index === spec.length) {
        if (!complete(assignment)) return;
        const key = tupleKey(assignment, spec);
        tuples.set(key, { key, assignments: { ...assignment }, maxIndex: Math.max(...spec.map(id => indexById.get(id)!)) });
        return;
      }
      const factor = byId.get(spec[index]!)!;
      for (const value of [...factor.values].sort((left, right) => left.localeCompare(right))) visit(index + 1, { ...assignment, [factor.factorId]: value });
    };
    visit(0, {});
  }
  return [...tuples.values()].sort((left, right) => left.key.localeCompare(right.key));
}
function coversTuple(assignment: Record<string, string>, tuple: RequiredTuple): boolean { return Object.entries(tuple.assignments).every(([factorId, value]) => assignment[factorId] === value); }
function uncoveredTuples(required: RequiredTuple[], rows: Record<string, string>[]): string[] { return required.filter(tuple => !rows.some(row => coversTuple(row, tuple))).map(tuple => tuple.key); }
function seededTie(seed: number, context: string, assignment: Record<string, string>): string { return sha256(`${seed}:${context}:${canonicalJson(assignment)}`); }
function caseBudgetError(rows: Record<string, string>[], caseBudget: number, required: RequiredTuple[]): Error {
  const uncovered = uncoveredTuples(required, rows.slice(0, caseBudget));
  const examples = (uncovered.length ? uncovered : required.map(tuple => tuple.key)).slice(0, 20);
  return new Error(`case budget exceeded before suite completion: ${rows.length} > ${caseBudget}; uncovered tuples: ${examples.join(",")}`);
}
function generateLegacyRows(model: CombinationFactorModel, strength: number, factorGroup: string | undefined, caseBudget: number): Record<string, string>[] {
  const valid = enumerateAssignmentsV1(model);
  if (!valid.length) throw new Error("constraints are unsatisfiable");
  const allTuples = new Set(valid.flatMap(assignment => tupleKeys(model, assignment, strength, factorGroup)));
  const remaining = new Set(allTuples);
  const chosen: Record<string, string>[] = [];
  while (remaining.size > 0) {
    const ranked = valid.map(assignment => ({ assignment, covered: tupleKeys(model, assignment, strength, factorGroup).filter(tuple => remaining.has(tuple)).length })).filter(entry => entry.covered > 0).sort((left, right) => right.covered - left.covered || canonicalJson(left.assignment).localeCompare(canonicalJson(right.assignment)));
    if (!ranked.length) throw new Error("pairwise coverage cannot be satisfied");
    const selected = ranked[0]!.assignment;
    chosen.push(selected);
    for (const tuple of tupleKeys(model, selected, strength, factorGroup)) remaining.delete(tuple);
    if (chosen.length > caseBudget) throw new Error(`case budget exceeded before suite completion: ${chosen.length} > ${caseBudget}`);
  }
  return chosen;
}
function generateIpogV2Rows(model: CombinationFactorModel, strength: number, factorGroup: string | undefined, seed: number, caseBudget: number): Record<string, string>[] {
  const factors = [...model.factors].sort((left, right) => left.factorId.localeCompare(right.factorId));
  if (factors.length < 2) throw new Error("at least two factors are required for IPOG");
  const complete = createCompleter(model);
  if (!complete({})) throw new Error("constraints are unsatisfiable");
  const required = requiredTuplesV2(model, strength, factorGroup, complete);
  const pending = new Set(required.map(tuple => tuple.key));
  const cover = (row: Record<string, string>): void => { for (const tuple of required) if (pending.has(tuple.key) && coversTuple(row, tuple)) pending.delete(tuple.key); };
  const first = factors[0]!; const second = factors[1]!;
  const rows: Record<string, string>[] = [];
  for (const left of [...first.values].sort((a, b) => a.localeCompare(b))) for (const right of [...second.values].sort((a, b) => a.localeCompare(b))) {
    const row = { [first.factorId]: left, [second.factorId]: right };
    if (complete(row)) { rows.push(row); cover(row); if (rows.length > caseBudget) throw caseBudgetError(rows, caseBudget, required); }
  }
  if (!rows.length) throw new Error("constraints are unsatisfiable");
  for (let index = 2; index < factors.length; index += 1) {
    const factor = factors[index]!;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]!;
      const ranked = [...factor.values].sort((left, right) => {
        const leftRow = { ...row, [factor.factorId]: left }; const rightRow = { ...row, [factor.factorId]: right };
        const leftScore = complete(leftRow) ? required.filter(tuple => pending.has(tuple.key) && coversTuple(leftRow, tuple)).length : -1;
        const rightScore = complete(rightRow) ? required.filter(tuple => pending.has(tuple.key) && coversTuple(rightRow, tuple)).length : -1;
        return rightScore - leftScore || seededTie(seed, `horizontal:${factor.factorId}:${rowIndex}`, leftRow).localeCompare(seededTie(seed, `horizontal:${factor.factorId}:${rowIndex}`, rightRow));
      }).filter(value => complete({ ...row, [factor.factorId]: value }));
      if (!ranked.length) throw new Error(`constraints prevent horizontal growth for ${factor.factorId}`);
      row[factor.factorId] = ranked[0]!;
      cover(row);
    }
    const vertical = required.filter(tuple => pending.has(tuple.key) && tuple.maxIndex <= index).sort((left, right) => seededTie(seed, `vertical:${factor.factorId}`, left.assignments).localeCompare(seededTie(seed, `vertical:${factor.factorId}`, right.assignments)) || left.key.localeCompare(right.key));
    for (const tuple of vertical) {
      if (!pending.has(tuple.key)) continue;
      const completion = complete(tuple.assignments);
      if (!completion) continue;
      const row = Object.fromEntries(factors.slice(0, index + 1).map(current => [current.factorId, completion[current.factorId]!])) as Record<string, string>;
      if (rows.length >= caseBudget) throw caseBudgetError([...rows, row], caseBudget, required);
      rows.push(row);
      cover(row);
    }
  }
  const unique = new Map<string, Record<string, string>>();
  for (const row of rows) unique.set(canonicalJson(row), row);
  const result = [...unique.values()];
  const uncovered = uncoveredTuples(required, result);
  if (uncovered.length) throw new Error(`IPOG coverage cannot be satisfied; uncovered tuples: ${uncovered.slice(0, 20).join(",")}`);
  return result;
}
export function expectedTuplesV1(model: CombinationFactorModel, strength: number, factorGroup?: string): Set<string> { return new Set(enumerateAssignmentsV1(model).flatMap(assignment => tupleKeys(model, assignment, strength, factorGroup))); }
export function expectedTuplesV2(model: CombinationFactorModel, strength: number, factorGroup?: string): Set<string> { return new Set(requiredTuplesV2(model, strength, factorGroup, createCompleter(model)).map(tuple => tuple.key)); }

export function estimateCombinationCases(model: CombinationFactorModel, strength = model.generatorPolicy.defaultStrength, factorGroup?: string): number {
  assertCombinationFactorModel(model);
  if (model.generatorPolicy.generatorVersion === LEGACY_COMBINATION_GENERATOR_VERSION) {
    const valid = enumerateAssignmentsV1(model);
    const tuples = new Set(valid.flatMap(assignment => tupleKeys(model, assignment, strength, factorGroup)));
    return Math.max(1, Math.min(valid.length, tuples.size));
  }
  return generateCombinationSuite(model, { strength, factorGroup, caseBudget: Number.MAX_SAFE_INTEGER }).cases.length;
}

export function generateCombinationSuite(model: CombinationFactorModel, options: { seed?: number; strength?: number; factorGroup?: string; caseBudget?: number } = {}): CombinationSuite {
  assertCombinationFactorModel(model);
  const normalized = normalizedModel(model);
  const seed = options.seed ?? normalized.generatorPolicy.seed;
  const strength = options.strength ?? normalized.generatorPolicy.defaultStrength;
  const caseBudget = options.caseBudget ?? normalized.generatorPolicy.caseBudget;
  const generatorVersion = normalized.generatorPolicy.generatorVersion;
  if (options.factorGroup && !normalized.factors.some(factor => factor.group === options.factorGroup)) throw new Error("unknown factorGroup: " + options.factorGroup);
  if (!Number.isInteger(seed) || !Number.isInteger(strength) || strength < 2 || !Number.isInteger(caseBudget) || caseBudget < 1) throw new Error("invalid combination generation policy");
  const chosen = generatorVersion === LEGACY_COMBINATION_GENERATOR_VERSION
    ? generateLegacyRows(normalized, strength, options.factorGroup, caseBudget)
    : generateIpogV2Rows(normalized, strength, options.factorGroup, seed, caseBudget);
  const modelDigest = factorModelDigest(normalized);
  const suiteId = `suite-${sha256(canonicalJson({ modelDigest, seed, strength, factorGroup: options.factorGroup ?? null, generatorVersion })).slice(0, 20)}`;
  const cases = chosen.map((assignment, index) => ({ schemaVersion: COMBINATION_CASE_SCHEMA_VERSION, suiteId, caseId: `case-${String(index + 1).padStart(4, "0")}-${sha256(canonicalJson(assignment)).slice(0, 12)}`, strength, ...(options.factorGroup ? { factorGroup: options.factorGroup } : {}), assignments: Object.fromEntries(Object.entries(assignment).sort(([left], [right]) => left.localeCompare(right))), coveringTuples: tupleKeys(normalized, assignment, strength, options.factorGroup), seed, generatorVersion }));
  return { schemaVersion: COMBINATION_SUITE_SCHEMA_VERSION, suiteId, modelDigest, seed, strength, ...(options.factorGroup ? { factorGroup: options.factorGroup } : {}), generatorVersion, estimatedCaseCount: chosen.length, cases };
}
