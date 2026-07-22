export {
  assertCombinationFactorModel,
  COMBINATION_CASE_SCHEMA_VERSION,
  COMBINATION_GENERATOR_VERSION,
  COMBINATION_MODEL_SCHEMA_VERSION,
  COMBINATION_SUITE_SCHEMA_VERSION,
  CONSTRAINT_DSL_VERSION,
  COVERAGE_SCHEMA_VERSION,
  factorModelDigest,
  LEGACY_COMBINATION_GENERATOR_VERSION,
} from "./combinations/model.js";
export type {
  CombinationCase,
  CombinationFactor,
  CombinationFactorModel,
  CombinationGeneratorVersion,
  CombinationSuite,
  CombinationVerificationReport,
  Constraint,
  CoverageReport,
  FactorKind,
  InputActionResolution,
} from "./combinations/model.js";
export { estimateCombinationCases, generateCombinationSuite } from "./combinations/generator.js";
export { assertCombinationSuite, resolveCombinationCase, verifyCombinationSuite } from "./combinations/verifier.js";
