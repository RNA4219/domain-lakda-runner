import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  assertCombinationFactorModel,
  assertCombinationSuite,
  factorModelDigest,
  generateCombinationSuite,
  resolveCombinationCase,
  verifyCombinationSuite,
} from "../../src/adaptive/combinations.js";

const model = {
  schemaVersion: "lakda/combination-factor-model/v1" as const,
  modelId: "fixture-model",
  generatorPolicy: { generatorVersion: "lakda-ipog/v1" as const, defaultStrength: 2, seed: 7, caseBudget: 20 },
  factors: [
    { factorId: "browser", kind: "environment" as const, values: ["chromium", "webkit"], source: "fixture", riskWeight: 1 },
    { factorId: "role", kind: "state" as const, values: ["guest", "member"], source: "fixture", riskWeight: 2, group: "flow" },
    { factorId: "action", kind: "action" as const, values: ["search", "checkout"], source: "fixture", riskWeight: 5, group: "flow" },
    { factorId: "query", kind: "input" as const, values: ["empty", "normal"], source: "fixture", riskWeight: 3, group: "flow" },
  ],
  constraints: [{ op: "implies" as const, left: { op: "eq" as const, factorId: "action", value: "checkout" }, right: { op: "eq" as const, factorId: "role", value: "member" } }],
};

test("combination generation is deterministic and satisfies constraints", () => {
  assertCombinationFactorModel(model);
  const first = generateCombinationSuite(model, { seed: 99 });
  const second = generateCombinationSuite(model, { seed: 99 });
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(first.cases.length).toBeLessThanOrEqual(20);
  expect(verifyCombinationSuite(model, first)).toMatchObject({ valid: true, coverage: { ratio: 1 } });
  expect(factorModelDigest(model)).toMatch(/^sha256:[0-9a-f]{64}$/);
  assertCombinationSuite(first);
  const golden = JSON.parse(readFileSync(new URL("../fixtures/lakda-ipog-v1-golden.json", import.meta.url), "utf8"));
  expect({ suiteId: first.suiteId, modelDigest: first.modelDigest, cases: first.cases.map(current => ({ caseId: current.caseId, assignments: current.assignments })) }).toEqual(golden);
});

test("mixed-strength group adds 3-way tuples only for the selected group", () => {
  const v2 = { ...model, generatorPolicy: { ...model.generatorPolicy, generatorVersion: "lakda-ipog/v2" as const } };
  const suite = generateCombinationSuite(v2, { seed: 1, strength: 3, factorGroup: "flow" });
  expect(suite.cases.every(current => current.factorGroup === "flow")).toBe(true);
  expect(suite.cases.some(current => current.coveringTuples.some(tuple => tuple.split("|").length === 3))).toBe(true);
  expect(verifyCombinationSuite(v2, suite).valid).toBe(true);
});

test("IPOG v2 uses horizontal and vertical growth without full assignment enumeration", () => {
  const large = {
    schemaVersion: "lakda/combination-factor-model/v1" as const,
    modelId: "large-ipog",
    generatorPolicy: { generatorVersion: "lakda-ipog/v2" as const, defaultStrength: 2, seed: 11, caseBudget: 500 },
    factors: Array.from({ length: 10 }, (_, index) => ({ factorId: `factor-${index}`, kind: "input" as const, values: ["a", "b", "c", "d", "e"], source: "fixture", riskWeight: 1 })),
    constraints: [],
  };
  const first = generateCombinationSuite(large, { seed: 11 });
  const repeated = generateCombinationSuite(large, { seed: 11 });
  const alternate = generateCombinationSuite(large, { seed: 12 });
  expect(JSON.stringify(first)).toBe(JSON.stringify(repeated));
  expect(first.cases.map(current => current.assignments)).not.toEqual(alternate.cases.map(current => current.assignments));
  expect(verifyCombinationSuite(large, first)).toMatchObject({ valid: true, coverage: { ratio: 1 } });
  expect(verifyCombinationSuite(large, alternate)).toMatchObject({ valid: true, coverage: { ratio: 1 } });
  expect(() => generateCombinationSuite(large, { caseBudget: 3 })).toThrow(/case budget.*uncovered tuples/i);
  const v1Suite = generateCombinationSuite(model, { seed: 99 });
  const incompatibleV2Model = { ...model, generatorPolicy: { ...model.generatorPolicy, generatorVersion: "lakda-ipog/v2" as const } };
  expect(verifyCombinationSuite(incompatibleV2Model, v1Suite).errors).toContain("generator version mismatch");

  const fifteenByThree = { ...large, modelId: "fifteen-by-three", generatorPolicy: { ...large.generatorPolicy, caseBudget: 500 }, factors: Array.from({ length: 15 }, (_, index) => ({ factorId: `three-${index}`, kind: "input" as const, values: ["a", "b", "c"], source: "fixture", riskWeight: 1 })) };
  const suite = generateCombinationSuite(fifteenByThree);
  expect(verifyCombinationSuite(fifteenByThree, suite)).toMatchObject({ valid: true, coverage: { ratio: 1 } });
});
test("unknown assignment and unsatisfiable model fail closed", () => {
  const suite = generateCombinationSuite(model);
  expect(() => resolveCombinationCase(model, { ...suite.cases[0], assignments: { ...suite.cases[0].assignments, unknown: "x" } })).toThrow(/unknown combination assignment/);
  const impossible = { ...model, constraints: [{ op: "eq" as const, factorId: "role", value: "missing" }] };
  expect(() => generateCombinationSuite(impossible)).toThrow(/unsatisfiable/);
  expect(() => assertCombinationSuite({ schemaVersion: "lakda/unknown/v1" })).toThrow(/unknown combination suite/);
  expect(() => assertCombinationFactorModel({ ...model, generatorPolicy: { ...model.generatorPolicy, generatorVersion: "lakda-ipog/v3" } })).toThrow(/schema|generator/i);
});