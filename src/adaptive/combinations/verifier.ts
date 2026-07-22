import {
  assertCombinationFactorModel,
  assertObject,
  COMBINATION_CASE_SCHEMA_VERSION,
  COMBINATION_SUITE_SCHEMA_VERSION,
  CONSTRAINT_DSL_VERSION,
  COVERAGE_SCHEMA_VERSION,
  LEGACY_COMBINATION_GENERATOR_VERSION,
  evaluateConstraint,
  factorById,
  factorModelDigest,
  isCombinationGeneratorVersion,
} from "./model.js";
import type {
  CombinationCase,
  CombinationFactorModel,
  CombinationSuite,
  CombinationVerificationReport,
  CoverageReport,
  InputActionResolution,
} from "./model.js";
import { expectedTuplesV1, expectedTuplesV2, tupleKeys } from "./generator.js";
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
