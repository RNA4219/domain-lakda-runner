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
export const COMBINATION_GENERATOR_VERSION = "lakda-ipog/v1" as const;
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
  generatorPolicy: { generatorVersion: typeof COMBINATION_GENERATOR_VERSION; defaultStrength: number; seed: number; caseBudget: number };
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
  generatorVersion: typeof COMBINATION_GENERATOR_VERSION;
};
export type CombinationSuite = {
  schemaVersion: typeof COMBINATION_SUITE_SCHEMA_VERSION;
  suiteId: string;
  modelDigest: string;
  seed: number;
  strength: number;
  factorGroup?: string;
  generatorVersion: typeof COMBINATION_GENERATOR_VERSION;
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
function enumerateAssignments(model: CombinationFactorModel): Record<string, string>[] {
  const factors = [...model.factors].sort((left, right) => left.factorId.localeCompare(right.factorId));
  const estimate = factors.reduce((total, factor) => total * factor.values.length, 1);
  if (!Number.isSafeInteger(estimate) || estimate > 100_000) throw new Error(`factor assignment space is too large: ${estimate}`);
  const result: Record<string, string>[] = [];
  const visit = (index: number, assignment: Record<string, string>): void => {
    if (index === factors.length) { if (model.constraints.every(constraint => evaluateConstraint(constraint, assignment))) result.push({ ...assignment }); return; }
    for (const value of [...factors[index].values].sort((left, right) => left.localeCompare(right))) visit(index + 1, { ...assignment, [factors[index].factorId]: value });
  };
  visit(0, {});
  return result;
}

export function estimateCombinationCases(model: CombinationFactorModel, strength = model.generatorPolicy.defaultStrength, factorGroup?: string): number {
  assertCombinationFactorModel(model);
  const valid = enumerateAssignments(model);
  const tuples = new Set(valid.flatMap(assignment => tupleKeys(model, assignment, strength, factorGroup)));
  return Math.max(1, Math.min(valid.length, tuples.size));
}

export function generateCombinationSuite(model: CombinationFactorModel, options: { seed?: number; strength?: number; factorGroup?: string; caseBudget?: number } = {}): CombinationSuite {
  assertCombinationFactorModel(model);
  const normalized = normalizedModel(model);
  const seed = options.seed ?? normalized.generatorPolicy.seed;
  const strength = options.strength ?? normalized.generatorPolicy.defaultStrength;
  const caseBudget = options.caseBudget ?? normalized.generatorPolicy.caseBudget;
  if (options.factorGroup && !normalized.factors.some(factor => factor.group === options.factorGroup)) throw new Error("unknown factorGroup: " + options.factorGroup);
  if (!Number.isInteger(seed) || !Number.isInteger(strength) || strength < 2 || !Number.isInteger(caseBudget) || caseBudget < 1) throw new Error("invalid combination generation policy");
  const valid = enumerateAssignments(normalized);
  if (!valid.length) throw new Error("constraints are unsatisfiable");
  const allTuples = new Set(valid.flatMap(assignment => tupleKeys(normalized, assignment, strength, options.factorGroup)));
  const remaining = new Set(allTuples);
  const chosen: Record<string, string>[] = [];
  while (remaining.size > 0) {
    const ranked = valid.map(assignment => ({ assignment, covered: tupleKeys(normalized, assignment, strength, options.factorGroup).filter(tuple => remaining.has(tuple)).length })).filter(entry => entry.covered > 0).sort((left, right) => right.covered - left.covered || canonicalJson(left.assignment).localeCompare(canonicalJson(right.assignment)));
    if (!ranked.length) throw new Error("pairwise coverage cannot be satisfied");
    const selected = ranked[0].assignment;
    chosen.push(selected);
    for (const tuple of tupleKeys(normalized, selected, strength, options.factorGroup)) remaining.delete(tuple);
    if (chosen.length > caseBudget) throw new Error(`case budget exceeded before suite completion: ${chosen.length} > ${caseBudget}`);
  }
  const modelDigest = factorModelDigest(normalized);
  const suiteId = `suite-${sha256(canonicalJson({ modelDigest, seed, strength, factorGroup: options.factorGroup ?? null, generatorVersion: COMBINATION_GENERATOR_VERSION })).slice(0, 20)}`;
  const cases = chosen.map((assignment, index) => ({ schemaVersion: COMBINATION_CASE_SCHEMA_VERSION, suiteId, caseId: `case-${String(index + 1).padStart(4, "0")}-${sha256(canonicalJson(assignment)).slice(0, 12)}`, strength, ...(options.factorGroup ? { factorGroup: options.factorGroup } : {}), assignments: Object.fromEntries(Object.entries(assignment).sort(([left], [right]) => left.localeCompare(right))), coveringTuples: tupleKeys(normalized, assignment, strength, options.factorGroup), seed, generatorVersion: COMBINATION_GENERATOR_VERSION }));
  return { schemaVersion: COMBINATION_SUITE_SCHEMA_VERSION, suiteId, modelDigest, seed, strength, ...(options.factorGroup ? { factorGroup: options.factorGroup } : {}), generatorVersion: COMBINATION_GENERATOR_VERSION, estimatedCaseCount: chosen.length, cases };
}

export function assertCombinationSuite(value: unknown): asserts value is CombinationSuite {
  assertObject(value, "combination suite");
  const suite = value as Partial<CombinationSuite>;
  if (suite.schemaVersion !== COMBINATION_SUITE_SCHEMA_VERSION) throw new Error("unknown combination suite schemaVersion");
  if (typeof suite.suiteId !== "string" || typeof suite.modelDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(suite.modelDigest)) throw new Error("combination suite identity is invalid");
  if (!Number.isInteger(suite.seed) || !Number.isInteger(suite.strength) || (suite.strength ?? 0) < 2 || !Array.isArray(suite.cases) || suite.cases.length === 0) throw new Error("combination suite shape is invalid");
  if (suite.estimatedCaseCount !== suite.cases?.length) throw new Error("combination suite case count mismatch");
  if (suite.generatorVersion !== COMBINATION_GENERATOR_VERSION) throw new Error("unknown combination generatorVersion");
  for (const current of suite.cases) {    const extra = Object.keys(current as Record<string, unknown>).filter(key => !["schemaVersion", "suiteId", "caseId", "strength", "factorGroup", "assignments", "coveringTuples", "seed", "generatorVersion"].includes(key)); if (extra.length) throw new Error("unknown combination case field: " + extra.join(","));

    assertObject(current, "combination case");
    if ((current as CombinationCase).schemaVersion !== COMBINATION_CASE_SCHEMA_VERSION) throw new Error("unknown combination case schemaVersion");
    const caseValue = current as CombinationCase;
    if (typeof caseValue.caseId !== "string" || caseValue.suiteId !== suite.suiteId || caseValue.generatorVersion !== COMBINATION_GENERATOR_VERSION || caseValue.seed !== suite.seed || caseValue.strength !== suite.strength || !Number.isInteger(caseValue.strength) || !caseValue.assignments || Array.isArray(caseValue.assignments) || !Array.isArray(caseValue.coveringTuples)) throw new Error("combination case shape is invalid");
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
  const validAssignments = enumerateAssignments(model);
  const expected = new Set(validAssignments.flatMap(assignment => tupleKeys(model, assignment, suite.strength, suite.factorGroup)));
  const covered = new Set(suite.cases.flatMap(current => tupleKeys(model, current.assignments, suite.strength, suite.factorGroup)));
  const coveredList = [...covered].filter(tuple => expected.has(tuple)).sort();
  const uncovered = [...expected].filter(tuple => !covered.has(tuple)).sort();
  if (suite.modelDigest !== factorModelDigest(model)) errors.push("model digest mismatch");
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