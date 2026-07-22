import type { ActionCandidate, ExecutionResult, Observation, OracleResult } from "./contracts.js";
import { evaluateActionPostconditions, genericOracle } from "./oracles.js";
import { securityOracle } from "./security-oracle.js";

export const BUILTIN_ORACLE_IDS = ["generic", "product-contract", "security-candidate"] as const;
export type BuiltInOracleId = typeof BUILTIN_ORACLE_IDS[number];
type OracleContext = { candidate: ActionCandidate; before: Observation; after?: Observation; execution: ExecutionResult };
type OracleRegistryEntry = { id: BuiltInOracleId; oracleClass: OracleResult["oracleClass"]; evaluate(context: OracleContext): OracleResult[] };

const registry = Object.freeze({
  generic: Object.freeze({ id: "generic", oracleClass: "generic", evaluate: ({ execution, before, after }: OracleContext) => [genericOracle(execution, before, after)] }),
  "product-contract": Object.freeze({ id: "product-contract", oracleClass: "product", evaluate: ({ candidate, before, after, execution }: OracleContext) => evaluateActionPostconditions(candidate, before, after, execution) }),
  "security-candidate": Object.freeze({ id: "security-candidate", oracleClass: "security", evaluate: ({ candidate, execution }: OracleContext) => { const result = securityOracle(candidate, execution); return result ? [result] : []; } }),
} satisfies Record<BuiltInOracleId, OracleRegistryEntry>);

export function resolveBuiltInOracle(id: unknown): OracleRegistryEntry {
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(registry, id)) throw new Error("oracle ID must reference a built-in oracle");
  return registry[id as BuiltInOracleId];
}

export function evaluateBuiltInOracles(context: OracleContext): { generic: OracleResult; product: OracleResult[]; security: OracleResult[]; results: OracleResult[] } {
  const generic = resolveBuiltInOracle("generic").evaluate(context)[0];
  if (!generic) throw new Error("built-in generic oracle did not produce a result");
  const product = resolveBuiltInOracle("product-contract").evaluate(context);
  const security = resolveBuiltInOracle("security-candidate").evaluate(context);
  return { generic, product, security, results: [generic, ...product, ...security] };
}