import { sha256 } from "../core/redaction.js";
import type { ExecutionResult, OracleResult } from "./contracts.js";

export type ProductOracle = (execution: ExecutionResult) => Promise<OracleResult> | OracleResult;
export function genericOracle(execution: ExecutionResult): OracleResult {
  const failure = !["executed", "denied"].includes(execution.status);
  return {
    schemaVersion: "lakda/adaptive-contracts/v1",
    oracleId: `generic-${sha256(`${execution.executionId}:${execution.status}`).slice(0, 16)}`,
    oracleClass: "generic",
    verdict: failure ? "fail" : execution.status === "denied" ? "inconclusive" : "pass",
    severity: failure ? "major" : "info",
    sourceRefs: [execution.executionId],
    requirementRefs: [],
    evidenceRefs: execution.evidenceRefs,
    message: failure ? `execution-${execution.status}` : "execution-ok",
  };
}
export async function evaluateProductOracles(execution: ExecutionResult, oracles: ProductOracle[]): Promise<OracleResult[]> {
  return Promise.all(oracles.map(oracle => oracle(execution)));
}
