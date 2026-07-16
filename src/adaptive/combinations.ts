import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";

export const COMBINATION_MODEL_SCHEMA_VERSION = "lakda/combination-factor-model/v1" as const;
export const COMBINATION_CASE_SCHEMA_VERSION = "lakda/combination-case/v1" as const;
export const COMBINATION_SUITE_SCHEMA_VERSION = "lakda/combination-suite/v1" as const;
export const COVERAGE_SCHEMA_VERSION = "lakda/input-interaction-coverage/v1" as const;
export const LEGACY_COMBINATION_GENERATOR_VERSION = "lakda-ipog/v1" as const;
export const COMBINATION_GENERATOR_VERSION = "lakda-ipog/v2" as const;
export type CombinationGeneratorVersion = typeof LEGACY_COMBINATION_GENERATOR_VERSION | typeof COMBINATION_GENERATOR_VERSION;
function isCombinationGeneratorVersion(value: unknown): value is CombinationGeneratorVersion { return value === LEGACY_COMBINATION_GENERATOR_VERSION || value === COMBINATION_GENERATOR_VERSION; }
export const CONSTRAINT_DSL_VERSION = "lakda/combination-constraints/v1" as const;

export type FactorKind = "input" | "state" | "action" | "environment";
export type CombinationFactor = { factorId: string; kind: FactorKind; values: string[]; source: string; riskWeight: number; group?: string };
export type Constraint = {
  op: "allOf" | "anyOf" | "not" | "eq" | "neq" | "in" | "notIn" | "implies";
  factorId?: string;
  value?: unknown;
  values?: unknown[];
  left?: Constraint;
  right?: Constraint;
  items?: Constraint[];
};
export type CombinationFactorModel = {
  schemaVersion: typeof COMBINATION_MODEL_SCHEMA_VERSION;
  modelId: string;
  generatorPolicy: { generatorVersion: CombinationGeneratorVersion; defaultStrength: number; seed: number; caseBudget: number };
  factors: CombinationFactor[];
  constraints: Constraint[];
};
export type CombinationCase = {
  schemaVersion: typeof COMBINATION_CASE_SCHEMA_VERSION;
  suiteId: string;
  caseId: string;
  strength: number;
  factorGroup?: string;
  assignments: Record<string, string>;
  coveringTuples: string[];
  seed: number;
  generatorVersion: CombinationGeneratorVersion;
};
export type CombinationSuite = {
  schemaVersion: typeof COMBINATION_SUITE_SCHEMA_VERSION;
  suiteId: string;
  modelDigest: string;
  seed: number;
  strength: number;
  factorGroup?: string;
  generatorVersion: CombinationGeneratorVersion;
  estimatedCaseCount: number;
  cases: CombinationCase[];
};
export type InputActionResolution = { inputAssignments: Record<string, string>; actionIds: string[]; stateAssignments: Record<string, string>; environmentAssignments: Record<string, string> };
export type CoverageReport = {
  schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
  suiteId: string;
  strength: number;
  factorGroup?: string;
  covered: string[];
  uncovered: string[];
  ratio: number;
  openWorld: boolean;
  constraintRevision: string;
};
export type CombinationVerificationReport = { valid: boolean; errors: string[]; coverage: CoverageReport; duplicateCaseIds: string[]; constraintViolations: string[]; unknownRefs: string[] };

type Validator = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
type AjvConstructor = new (options: object) => { compile(value: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schema = JSON.parse(readFileSync(resolve(root, "schemas", "lakda-combination-factor-model-v1.schema.json"), "utf8")) as object;
const validateFactorModelSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

function schemaError(validator: Validator): string { return validator.errors?.map(error => `${error.instancePath} ${error.message ?? "invalid"}`).join("; ") ?? "schema mismatch"; }
function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`); }
function safeValue(value: string): boolean { return value.length > 0 && !/(password|secret|token|credential|authorization|cookie|ssn|credit.?card|api.?key|\b\d{3}[- ]?\d{2}[- ]?\d{4}\b)/i.test(value); }
function factorIds(model: CombinationFactorModel): string[] { return model.factors.map(factor => factor.factorId).sort((left, right) => left.localeCompare(right)); }
function factorById(model: CombinationFactorModel): Map<string, CombinationFactor> { return new Map(model.factors.map(factor => [factor.factorId, factor])); }

export function assertCombinationFactorModel(value: unknown): asserts value is CombinationFactorModel {
  if (!validateFactorModelSchema(value)) throw new Error(`factor model schema mismatch: ${schemaError(validateFactorModelSchema)}`);
  assertObject(value, "factor model");
  if (value.schemaVersion !== COMBINATION_MODEL_SCHEMA_VERSION) throw new Error("unknown combination factor model schemaVersion");
  const model = value as CombinationFactorModel;
  const seen = new Set<string>();
  for (const factor of model.factors) {
    if (seen.has(factor.factorId)) throw new Error(`duplicate factorId: ${factor.factorId}`);
    seen.add(factor.factorId);
    if (!factor.values.every(safeValue)) throw new Error(`unsafe factor value: ${factor.factorId}`);
    if (new Set(factor.values).size !== factor.values.length) throw new Error(`duplicate factor value: ${factor.factorId}`);
  }
  const knownIds = new Set(model.factors.map(factor => factor.factorId));
  for (const constraint of model.constraints) { validateConstraintShape(constraint); validateConstraintRefs(constraint, knownIds); }
}

function validateConstraintShape(constraint: Constraint): void {
  if (!["allOf", "anyOf", "not", "eq", "neq", "in", "notIn", "implies"].includes(constraint.op)) throw new Error("unknown constraint operator");
  if (["eq", "neq", "in", "notIn"].includes(constraint.op) && !constraint.factorId) throw new Error(`${constraint.op} requires factorId`);
  if (["allOf", "anyOf"].includes(constraint.op) && !constraint.items?.length) throw new Error(`${constraint.op} requires items`);
  if (constraint.op === "not" && !constraint.left) throw new Error("not requires left");
  if (constraint.op === "implies" && (!constraint.left || !constraint.right)) throw new Error("implies requires left and right");
  constraint.items?.forEach(validateConstraintShape);
  if (constraint.left) validateConstraintShape(constraint.left);
  if (constraint.right) validateConstraintShape(constraint.right);
}

function validateConstraintRefs(constraint: Constraint, knownIds: Set<string>): void {
  if (constraint.factorId && !knownIds.has(constraint.factorId)) throw new Error("unknown constraint factorId: " + constraint.factorId);
  const refs = [constraint.value, ...(constraint.values ?? [])].filter(value => value && typeof value === "object" && !Array.isArray(value) && "factorRef" in value) as Array<{ factorRef?: unknown }>;
  refs.forEach(ref => { if (typeof ref.factorRef !== "string" || !knownIds.has(ref.factorRef)) throw new Error("unknown constraint factorRef"); });
  constraint.items?.forEach(item => validateConstraintRefs(item, knownIds));
  if (constraint.left) validateConstraintRefs(constraint.left, knownIds);
  if (constraint.right) validateConstraintRefs(constraint.right, knownIds);
}
function resolveConstraintValue(value: unknown, assignment: Record<string, string>): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "factorRef" in value && typeof (value as { factorRef?: unknown }).factorRef === "string") return assignment[(value as { factorRef: string }).factorRef];
  return value;
}
function evaluateConstraint(constraint: Constraint, assignment: Record<string, string>): boolean {
  switch (constraint.op) {
    case "allOf": return (constraint.items ?? []).every(item => evaluateConstraint(item, assignment));
    case "anyOf": return (constraint.items ?? []).some(item => evaluateConstraint(item, assignment));
    case "not": return !evaluateConstraint(constraint.left!, assignment);
    case "implies": return !evaluateConstraint(constraint.left!, assignment) || evaluateConstraint(constraint.right!, assignment);
    case "eq": return assignment[constraint.factorId!] === resolveConstraintValue(constraint.value, assignment);
    case "neq": return assignment[constraint.factorId!] !== resolveConstraintValue(constraint.value, assignment);
    case "in": return (constraint.values ?? []).map(value => resolveConstraintValue(value, assignment)).includes(assignment[constraint.factorId!]);
    case "notIn": return !(constraint.values ?? []).map(value => resolveConstraintValue(value, assignment)).includes(assignment[constraint.factorId!]);
  }
}

function normalizedModel(model: CombinationFactorModel): CombinationFactorModel {
  return {
    ...model,
    factors: [...model.factors].sort((left, right) => left.factorId.localeCompare(right.factorId)).map(factor => ({ ...factor, values: [...factor.values].sort((left, right) => left.localeCompare(right)) })),
    constraints: [...model.constraints].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
}
export function factorModelDigest(model: CombinationFactorModel): string { assertCombinationFactorModel(model); return `sha256:${sha256(canonicalJson(normalizedModel(model)))}`; }
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
function tupleKeys(model: CombinationFactorModel, assignment: Record<string, string>, strength: number, factorGroup?: string): string[] {
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
function expectedTuplesV1(model: CombinationFactorModel, strength: number, factorGroup?: string): Set<string> { return new Set(enumerateAssignmentsV1(model).flatMap(assignment => tupleKeys(model, assignment, strength, factorGroup))); }
function expectedTuplesV2(model: CombinationFactorModel, strength: number, factorGroup?: string): Set<string> { return new Set(requiredTuplesV2(model, strength, factorGroup, createCompleter(model)).map(tuple => tuple.key)); }

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
export function assertCombinationSuite(value: unknown): asserts value is CombinationSuite {
  assertObject(value, "combination suite");
  const suite = value as Partial<CombinationSuite>;
  if (suite.schemaVersion !== COMBINATION_SUITE_SCHEMA_VERSION) throw new Error("unknown combination suite schemaVersion");
  if (typeof suite.suiteId !== "string" || typeof suite.modelDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(suite.modelDigest)) throw new Error("combination suite identity is invalid");
  if (!Number.isInteger(suite.seed) || !Number.isInteger(suite.strength) || (suite.strength ?? 0) < 2 || !Array.isArray(suite.cases) || suite.cases.length === 0) throw new Error("combination suite shape is invalid");
  if (suite.estimatedCaseCount !== suite.cases?.length) throw new Error("combination suite case count mismatch");
  if (!isCombinationGeneratorVersion(suite.generatorVersion)) throw new Error("unknown combination generatorVersion");
  for (const current of suite.cases) {    const extra = Object.keys(current as Record<string, unknown>).filter(key => !["schemaVersion", "suiteId", "caseId", "strength", "factorGroup", "assignments", "coveringTuples", "seed", "generatorVersion"].includes(key)); if (extra.length) throw new Error("unknown combination case field: " + extra.join(","));

    assertObject(current, "combination case");
    if ((current as CombinationCase).schemaVersion !== COMBINATION_CASE_SCHEMA_VERSION) throw new Error("unknown combination case schemaVersion");
    const caseValue = current as CombinationCase;
    if (typeof caseValue.caseId !== "string" || caseValue.suiteId !== suite.suiteId || caseValue.generatorVersion !== suite.generatorVersion || caseValue.seed !== suite.seed || caseValue.strength !== suite.strength || !Number.isInteger(caseValue.strength) || !caseValue.assignments || Array.isArray(caseValue.assignments) || !Array.isArray(caseValue.coveringTuples)) throw new Error("combination case shape is invalid");
  }
}

export function verifyCombinationSuite(model: CombinationFactorModel, suite: CombinationSuite): CombinationVerificationReport {
  assertCombinationSuite(suite);
  assertCombinationFactorModel(model);
  const errors: string[] = [];
  const modelMap = factorById(model);
  const duplicateCaseIds: string[] = [];
  const seenCaseIds = new Set<string>();
  const constraintViolations: string[] = [];
  const unknownRefs: string[] = [];
  for (const current of suite.cases) {
    if (seenCaseIds.has(current.caseId)) duplicateCaseIds.push(current.caseId);
    seenCaseIds.add(current.caseId);
    for (const [factorId, value] of Object.entries(current.assignments)) {
      const factor = modelMap.get(factorId);
      if (!factor) { unknownRefs.push(`factor:${factorId}`); continue; }
      if (!factor.values.includes(value)) unknownRefs.push(`value:${factorId}:${value}`);
    }
    if (!model.constraints.every(constraint => evaluateConstraint(constraint, current.assignments))) constraintViolations.push(current.caseId);
  }
  const expected = suite.generatorVersion === LEGACY_COMBINATION_GENERATOR_VERSION
    ? expectedTuplesV1(model, suite.strength, suite.factorGroup)
    : expectedTuplesV2(model, suite.strength, suite.factorGroup);
  const covered = new Set(suite.cases.flatMap(current => tupleKeys(model, current.assignments, suite.strength, suite.factorGroup)));
  const coveredList = [...covered].filter(tuple => expected.has(tuple)).sort();
  const uncovered = [...expected].filter(tuple => !covered.has(tuple)).sort();
  if (suite.modelDigest !== factorModelDigest(model)) errors.push("model digest mismatch");
  if (suite.generatorVersion !== model.generatorPolicy.generatorVersion) errors.push("generator version mismatch");
  if (duplicateCaseIds.length) errors.push("duplicate case ID");
  if (constraintViolations.length) errors.push("constraint violation");
  if (unknownRefs.length) errors.push("unknown factor or value");
  if (uncovered.length) errors.push("coverage incomplete");
  const coverage: CoverageReport = { schemaVersion: COVERAGE_SCHEMA_VERSION, suiteId: suite.suiteId, strength: suite.strength, ...(suite.factorGroup ? { factorGroup: suite.factorGroup } : {}), covered: coveredList, uncovered, ratio: expected.size === 0 ? 1 : coveredList.length / expected.size, openWorld: false, constraintRevision: CONSTRAINT_DSL_VERSION };
  return { valid: errors.length === 0, errors, coverage, duplicateCaseIds, constraintViolations, unknownRefs };
}

export function resolveCombinationCase(model: CombinationFactorModel, current: CombinationCase): InputActionResolution {
  assertCombinationFactorModel(model);
  const factorMap = factorById(model);
  const result: InputActionResolution = { inputAssignments: {}, actionIds: [], stateAssignments: {}, environmentAssignments: {} };
  for (const [factorId, value] of Object.entries(current.assignments).sort(([left], [right]) => left.localeCompare(right))) {
    const factor = factorMap.get(factorId);
    if (!factor || !factor.values.includes(value)) throw new Error(`unknown combination assignment: ${factorId}=${value}`);
    if (factor.kind === "input") result.inputAssignments[factorId] = value;
    else if (factor.kind === "action") result.actionIds.push(value);
    else if (factor.kind === "state") result.stateAssignments[factorId] = value;
    else result.environmentAssignments[factorId] = value;
  }
  result.actionIds.sort();
  return result;
}