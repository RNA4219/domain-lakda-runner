import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../core/plan.js";
import { sha256 } from "../../core/redaction.js";

export const COMBINATION_MODEL_SCHEMA_VERSION = "lakda/combination-factor-model/v1" as const;
export const COMBINATION_CASE_SCHEMA_VERSION = "lakda/combination-case/v1" as const;
export const COMBINATION_SUITE_SCHEMA_VERSION = "lakda/combination-suite/v1" as const;
export const COVERAGE_SCHEMA_VERSION = "lakda/input-interaction-coverage/v1" as const;
export const LEGACY_COMBINATION_GENERATOR_VERSION = "lakda-ipog/v1" as const;
export const COMBINATION_GENERATOR_VERSION = "lakda-ipog/v2" as const;
export type CombinationGeneratorVersion = typeof LEGACY_COMBINATION_GENERATOR_VERSION | typeof COMBINATION_GENERATOR_VERSION;
export function isCombinationGeneratorVersion(value: unknown): value is CombinationGeneratorVersion { return value === LEGACY_COMBINATION_GENERATOR_VERSION || value === COMBINATION_GENERATOR_VERSION; }
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
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const schema = JSON.parse(readFileSync(resolve(root, "schemas", "lakda-combination-factor-model-v1.schema.json"), "utf8")) as object;
const validateFactorModelSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

function schemaError(validator: Validator): string { return validator.errors?.map(error => `${error.instancePath} ${error.message ?? "invalid"}`).join("; ") ?? "schema mismatch"; }
export function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`); }
function safeValue(value: string): boolean { return value.length > 0 && !/(password|secret|token|credential|authorization|cookie|ssn|credit.?card|api.?key|\b\d{3}[- ]?\d{2}[- ]?\d{4}\b)/i.test(value); }
export function factorIds(model: CombinationFactorModel): string[] { return model.factors.map(factor => factor.factorId).sort((left, right) => left.localeCompare(right)); }
export function factorById(model: CombinationFactorModel): Map<string, CombinationFactor> { return new Map(model.factors.map(factor => [factor.factorId, factor])); }

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
export function evaluateConstraint(constraint: Constraint, assignment: Record<string, string>): boolean {
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

export function normalizedModel(model: CombinationFactorModel): CombinationFactorModel {
  return {
    ...model,
    factors: [...model.factors].sort((left, right) => left.factorId.localeCompare(right.factorId)).map(factor => ({ ...factor, values: [...factor.values].sort((left, right) => left.localeCompare(right)) })),
    constraints: [...model.constraints].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
}
export function factorModelDigest(model: CombinationFactorModel): string { assertCombinationFactorModel(model); return `sha256:${sha256(canonicalJson(normalizedModel(model)))}`; }
