import { expect, test } from "@playwright/test";
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
});

test("mixed-strength group adds 3-way tuples only for the selected group", () => {
  const suite = generateCombinationSuite(model, { seed: 1, strength: 3, factorGroup: "flow" });
  expect(suite.cases.every(current => current.factorGroup === "flow")).toBe(true);
  expect(suite.cases.some(current => current.coveringTuples.some(tuple => tuple.split("|").length === 3))).toBe(true);
  expect(verifyCombinationSuite(model, suite).valid).toBe(true);
});

test("unknown assignment and unsatisfiable model fail closed", () => {
  const suite = generateCombinationSuite(model);
  expect(() => resolveCombinationCase(model, { ...suite.cases[0], assignments: { ...suite.cases[0].assignments, unknown: "x" } })).toThrow(/unknown combination assignment/);
  const impossible = { ...model, constraints: [{ op: "eq" as const, factorId: "role", value: "missing" }] };
  expect(() => generateCombinationSuite(impossible)).toThrow(/unsatisfiable/);
  expect(() => assertCombinationSuite({ schemaVersion: "lakda/unknown/v1" })).toThrow(/unknown combination suite/);
});