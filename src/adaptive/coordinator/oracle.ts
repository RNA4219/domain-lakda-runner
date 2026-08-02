import type { BrowserContext, Page } from "playwright";
import type { ArtifactCollector } from "../../core/artifacts.js";
import type { LakdaConfig } from "../../core/types.js";
import type { ActionCandidate, ExecutionResult, Observation, OracleResult } from "../contracts.js";
import { StateGraph } from "../graph.js";
import { evaluateBuiltInOracles } from "../oracle-registry.js";
import { executionDivergence, oracleDivergence, type ReplayStep } from "../replay.js";
import { explorationOracleResults } from "../visual.js";

export function attachGenericOracles(page: Page, context: BrowserContext, collector: ArtifactCollector, config: LakdaConfig): void {
  const attach = (target: Page) => {
    target.on("pageerror", error => collector.addFailure("UI-001", error.name));
    target.on("crash", () => collector.addFailure("UI-002", "page-crash"));
    target.on("console", message => { if (message.type() === "error") collector.addFailure("UI-003", message.type()); });
    target.on("response", response => {
      if (response.status() >= 500 && config.safety.allowHosts.includes(new URL(response.url()).hostname)) collector.addFailure("UI-004", `HTTP ${response.status()}`);
    });
  };
  attach(page);
  context.on("page", attach);
}

export type OracleEvaluation = {
  stepOracles: OracleResult[];
  generic: OracleResult;
  productOracles: OracleResult[];
  replayDivergenceReason?: string;
  failed: boolean;
};

function uniqueOracles(oracles: OracleResult[]): OracleResult[] {
  const seen = new Set<string>();
  return oracles.filter(oracle => {
    if (seen.has(oracle.oracleId)) return false;
    seen.add(oracle.oracleId);
    return true;
  });
}

export function evaluateAndRecordOracles(input: {
  graph: StateGraph;
  candidate: ActionCandidate;
  oracleCandidate: ActionCandidate;
  before: Observation;
  after?: Observation;
  execution: ExecutionResult;
  oracleResults: OracleResult[];
  trace: Array<Record<string, unknown>>;
  replayStep?: ReplayStep;
  exploration?: boolean;
}): OracleEvaluation {
  const evaluated = evaluateBuiltInOracles({
    candidate: input.oracleCandidate,
    before: input.before,
    after: input.after,
    execution: input.execution,
  });
  const rawStepOracles = [
    ...evaluated.results,
    ...(input.exploration ? explorationOracleResults({ candidate: input.oracleCandidate, before: input.before, ...(input.after ? { after: input.after } : {}), execution: input.execution }) : []),
  ];
  // Keep normal adaptive's historical oracle stream unchanged; exploration
  // adds only its own deduped machine-oracle records.
  const stepOracles = input.exploration ? uniqueOracles(rawStepOracles) : rawStepOracles;
  input.graph.recordOracleResults(input.candidate.sourceFingerprint, input.candidate.candidateId, input.execution.postFingerprint, stepOracles, input.execution.status);
  if (input.exploration) {
    const recordedIds = new Set(input.oracleResults.map(oracle => oracle.oracleId));
    for (const oracle of stepOracles) {
      if (recordedIds.has(oracle.oracleId)) continue;
      recordedIds.add(oracle.oracleId);
      input.oracleResults.push(oracle);
      input.trace.push({ type: "oracle", result: oracle });
    }
  } else {
    input.oracleResults.push(...stepOracles);
    stepOracles.forEach(oracle => input.trace.push({ type: "oracle", result: oracle }));
  }

  const replayDivergenceReason = input.replayStep
    ? executionDivergence(input.replayStep.execution, input.execution) ?? oracleDivergence(input.replayStep.oracles, stepOracles)
    : undefined;
  if (replayDivergenceReason) {
    input.trace.push({
      type: "replay-divergence",
      candidateId: input.candidate.candidateId,
      reason: replayDivergenceReason,
      expectedExecution: input.replayStep?.execution,
      actualExecution: input.execution,
      expectedOracles: input.replayStep?.oracles,
      actualOracles: stepOracles,
    });
  }

  return {
    stepOracles,
    generic: evaluated.generic,
    productOracles: evaluated.product,
    ...(replayDivergenceReason ? { replayDivergenceReason } : {}),
    failed: evaluated.product.some(oracle => oracle.verdict === "fail")
      || (evaluated.generic.verdict === "fail" && ["executed", "denied"].includes(input.execution.status))
      || stepOracles.some(oracle => oracle.oracleId.startsWith("exploration:") && oracle.verdict === "fail"),
  };
}
