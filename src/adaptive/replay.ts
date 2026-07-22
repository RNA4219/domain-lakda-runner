import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { assertAdaptiveContract, assertNoSensitivePublicData } from "./contracts.js";
import type { ActionCandidate, ExecutionResult, OracleResult } from "./contracts.js";
import type { RecordedInputCase } from "./input.js";

export type AdaptiveReplayEntry = {
  type: string;
  candidate?: ActionCandidate;
  inputCase?: RecordedInputCase;
  executionResult?: ExecutionResult;
  result?: OracleResult;
  status?: ExecutionResult["status"];
  preFingerprint?: string;
  postFingerprint?: string;
  settle?: string;
  executionId?: string;
  candidateId?: string;
  inputCaseRef?: string;
  oracleResult?: OracleResult;
  observationId?: string;
  targetRef?: Record<string, unknown>;
  phase?: string;
  reason?: string;
  expectedFingerprint?: string;
  actualFingerprint?: string;
  expectedExecution?: unknown;
  actualExecution?: unknown;
  expectedOracles?: unknown;
  actualOracles?: unknown;
};

export type AdaptiveReplayTrace = {
  schemaVersion: "lakda/adaptive-trace/v1" | "lakda/adaptive-replay/v1";
  seed: number;
  trace: AdaptiveReplayEntry[];
  actions?: number;
  outcome?: string;
  terminationReason?: string;
};

export type ReplayExecutionExpectation = {
  status: ExecutionResult["status"];
  preFingerprint: string;
  postFingerprint?: string;
  settleStatus: string;
  targetChanges?: Array<Record<string, unknown>>;
};

export type ReplayStep = {
  candidate: ActionCandidate;
  inputCase?: RecordedInputCase;
  execution?: ReplayExecutionExpectation;
  oracles: OracleResult[];
};

const topKeys = ["schemaVersion", "seed", "trace", "actions", "outcome", "terminationReason"];
const inputKeys = ["caseId", "fieldId", "category", "generatorVersion", "seed", "domainRef", "validity", "expectedOracleRef", "valueDigest"];
const entryKeys: Record<string, string[]> = {
  observation: ["type", "phase", "observationId", "targetRef", "fingerprint"],
  candidate: ["type", "candidate", "inputCase"],
  execution: ["type", "executionResult", "executionId", "candidateId", "inputCaseRef", "status", "preFingerprint", "postFingerprint", "settle"],
  oracle: ["type", "result"],
  "candidate-denied": ["type", "candidateId", "reason", "oracleResult"],
  "candidate-quarantined": ["type", "candidateId", "sourceFingerprint", "reason", "timeoutCount", "revisitBudget", "blockedUntilAction"],
  stop: ["type", "reason", "actionCount", "coverage"],
  "replay-divergence": ["type", "candidateId", "reason", "expectedFingerprint", "actualFingerprint", "expectedExecution", "actualExecution", "expectedOracles", "actualOracles", "expectedCandidate", "actualCandidate", "expectedInputCase", "actualInputCase"],
  "observation-unavailable": ["type", "phase", "candidateId", "reason"],
  "timeout-evidence-unavailable": ["type", "candidateId", "reason"],
  "timeout-evidence": ["type", "candidateId", "targetRef", "preObservationId", "postObservationId", "preFingerprint", "postFingerprint", "elapsedMs", "failureSignatureRef", "captureRequested", "evidenceRefs"],
  recovery: ["type", "candidateId", "recovered", "strategy", "preFingerprint", "expectedFingerprint", "postFingerprint", "matchedExpectedState", "recoveryChecks", "recoveryFailures", "reason"],
  "recovery-divergence": ["type", "candidateId", "strategy", "expectedFingerprint", "actualFingerprint", "recoveryFailures"],
  "security-policy": ["type", "candidateId", "authorizationId", "authorizationRef", "securityProfileRef", "targetRevision", "targetOrigin", "targetPath", "method", "requestTemplateDigest", "mutationKind", "decision", "reason", "requestCounters"],
  "security-permit": ["type", "candidateId", "authorizationId", "permitReceiptRef", "requestOrdinal", "targetRevision", "securityProfileDigest", "capabilityDigest", "bridgeDigest"],
  "security-kill-switch": ["type", "triggered", "evidenceRefs", "reason"],
  "security-cleanup": ["type", "candidateId", "cleanupRef", "completed", "evidenceRefs", "reason"],
  "security-execution-error": ["type", "candidateId", "reason"],
  "race-participant-skipped": ["type", "groupId", "participantIndex", "reason"],
  "race-participant": ["type", "groupId", "participantIndex", "executionId", "status", "startedAt", "endedAt"],
};

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], name: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw new Error(`${name} has unknown keys: ${extra.join(",")}`);
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function validateInputCase(value: unknown): asserts value is RecordedInputCase {
  const current = object(value, "inputCase");
  keys(current, inputKeys, "inputCase");
  if (typeof current.caseId !== "string" || typeof current.fieldId !== "string" || typeof current.category !== "string" || current.generatorVersion !== "lakda-input-generator/v1" || !Number.isInteger(current.seed) || typeof current.domainRef !== "string" || !["valid", "invalid"].includes(current.validity as string) || typeof current.expectedOracleRef !== "string" || typeof current.valueDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.valueDigest)) throw new Error("inputCase schema mismatch");
}

function validateEntry(value: unknown, index: number): asserts value is AdaptiveReplayEntry {
  const current = object(value, `trace[${index}]`);
  const type = current.type;
  if (typeof type !== "string" || !entryKeys[type]) throw new Error(`trace[${index}] has unknown entry type`);
  keys(current, entryKeys[type], `trace[${index}]`);
  assertNoSensitivePublicData(current, `$.trace[${index}]`);
  if (type === "candidate") {
    assertAdaptiveContract(current.candidate);
    if (current.inputCase !== undefined) validateInputCase(current.inputCase);
  } else if (type === "execution") {
    assertAdaptiveContract(current.executionResult);
    const result = current.executionResult as ExecutionResult;
    if (current.candidateId !== undefined && current.candidateId !== result.candidateId) throw new Error(`trace[${index}] execution candidateId mismatch`);
    if (current.status !== undefined && current.status !== result.status) throw new Error(`trace[${index}] execution status mismatch`);
  } else if (type === "oracle") {
    assertAdaptiveContract(current.result);
  } else if (type === "candidate-denied" && current.oracleResult !== undefined) {
    assertAdaptiveContract(current.oracleResult);
  }
}

export type ReplayValidationOptions = { requireReplayable?: boolean }

export function validateAdaptiveReplayTrace(value: unknown, options: ReplayValidationOptions = {}): asserts value is AdaptiveReplayTrace {
  const current = object(value, "adaptive replay trace");
  keys(current, topKeys, "adaptive replay trace");
  if (current.schemaVersion !== "lakda/adaptive-trace/v1" && current.schemaVersion !== "lakda/adaptive-replay/v1") throw new Error("unknown adaptive replay schemaVersion");
  if (!Number.isInteger(current.seed)) throw new Error("adaptive replay seed must be an integer");
  const entries = array(current.trace, "adaptive replay trace.trace");
  entries.forEach(validateEntry);
  const steps = buildReplaySteps(current as unknown as AdaptiveReplayTrace);
  const requireReplayable = options.requireReplayable !== false;
  if (steps.length === 0 && !entries.some(entry => (entry as Record<string, unknown>).type === "replay-divergence")) throw new Error("adaptive replay requires a candidate or replay divergence evidence");
  if (requireReplayable && steps.length === 0) throw new Error("adaptive replay requires a candidate");
  if ((requireReplayable || steps.length > 0) && steps.some(step => !step.execution)) throw new Error("adaptive replay requires execution expectation for every candidate");
  if ((requireReplayable || steps.length > 0) && steps.some(step => step.oracles.length === 0)) throw new Error("adaptive replay requires oracle expectation for every candidate");
}

export function isAdaptiveReplayTrace(value: unknown): value is AdaptiveReplayTrace {
  try {
    validateAdaptiveReplayTrace(value);
    return true;
  } catch {
    return false;
  }
}

function expectedExecution(entry: AdaptiveReplayEntry): ReplayExecutionExpectation | undefined {
  const result = entry.executionResult;
  if (result) return { status: result.status, preFingerprint: result.preFingerprint, ...(result.postFingerprint ? { postFingerprint: result.postFingerprint } : {}), settleStatus: result.settleResult.status, targetChanges: result.targetChanges };
  if (entry.type !== "execution" || !entry.status || !entry.preFingerprint || !entry.settle) return undefined;
  return { status: entry.status, preFingerprint: entry.preFingerprint, ...(entry.postFingerprint ? { postFingerprint: entry.postFingerprint } : {}), settleStatus: entry.settle };
}

export function buildReplaySteps(replay: AdaptiveReplayTrace | undefined): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let current: ReplayStep | undefined;
  for (const entry of replay?.trace ?? []) {
    if (entry.type === "candidate" && entry.candidate) {
      current = { candidate: entry.candidate, ...(entry.inputCase ? { inputCase: entry.inputCase } : {}), oracles: [] };
      steps.push(current);
    } else if (entry.type === "execution" && current) {
      current.execution = expectedExecution(entry);
    } else if (entry.type === "oracle" && entry.result && current) {
      current.oracles.push(entry.result);
    }
  }
  return steps;
}

export function validateReplayScope(replay: AdaptiveReplayTrace, baseUrl: string | undefined, allowHosts: string[], allowTargetKinds: string[]): void {
  if (!baseUrl) throw new Error("baseUrl is required for strict replay");
  const base = new URL(baseUrl);
  if (!allowHosts.includes(base.hostname)) throw new Error("baseUrl host is not in allowHosts");
  const assertUrl = (value: string, label: string): void => {
    const parsed = new URL(value, baseUrl);
    if (!allowHosts.includes(parsed.hostname) || parsed.hostname !== base.hostname) throw new Error(`${label} is outside replay scope`);
  };
  for (const entry of replay.trace) {
    const targetRef = entry.targetRef;
    if (targetRef && typeof targetRef.origin === "string") assertUrl(targetRef.origin, "trace target origin");
  }
  for (const step of buildReplaySteps(replay)) {
    const candidate = step.candidate;
    if (!allowTargetKinds.includes(candidate.targetRef.kind)) throw new Error("candidate target kind is outside adaptive Safety Policy");
    if (candidate.targetRef.origin) assertUrl(candidate.targetRef.origin, "candidate target origin");
    if (candidate.locatorRecipe.strategy === "request" && /^https?:/i.test(candidate.locatorRecipe.value)) assertUrl(candidate.locatorRecipe.value, "candidate request URL");
    const changes = step.execution?.targetChanges ?? [];
    for (const change of changes) {
      for (const [key, value] of Object.entries(change)) {
        if (["origin", "settledUrl", "initialUrl", "url", "href"].includes(key) && typeof value === "string" && /^https?:/i.test(value)) assertUrl(value, `targetChanges.${key}`);
      }
    }
  }
}

function stableCandidate(candidate: ActionCandidate): Record<string, unknown> {
  return {
    candidateId: candidate.candidateId,
    adapterId: candidate.adapterId,
    targetRef: candidate.targetRef,
    sourceFingerprint: candidate.sourceFingerprint,
    actionKind: candidate.actionKind,
    locatorRecipe: candidate.locatorRecipe,
    ...(candidate.inputProfileRef ? { inputProfileRef: candidate.inputProfileRef } : {}),
    mutationKind: candidate.mutationKind,
    ...(candidate.contract ? { contract: candidate.contract } : {}),
  };
}

export function candidateDivergence(expected: ActionCandidate | undefined, actual: ActionCandidate | undefined): string | undefined {
  if (!actual) return "candidate-unresolved";
  if (!expected) return "missing-candidate-expectation";
  return canonicalJson(stableCandidate(expected)) === canonicalJson(stableCandidate(actual)) ? undefined : "candidate-replay-mismatch";
}

function stableTopology(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableTopology);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "elapsedMs").map(([key, nested]) => [key, stableTopology(nested)]).sort(([left], [right]) => (left as string).localeCompare(right as string)));
}

export function topologySignature(value: unknown): string { return canonicalJson(stableTopology(value)); }

export function executionDivergence(expected: ReplayExecutionExpectation | undefined, actual: ExecutionResult): string | undefined {
  if (!expected) return "missing-execution-expectation";
  if (expected.status !== actual.status) return "execution-status-mismatch";
  if (expected.preFingerprint !== actual.preFingerprint) return "pre-fingerprint-mismatch";
  if (expected.postFingerprint !== actual.postFingerprint) return "post-fingerprint-mismatch";
  if (expected.settleStatus !== actual.settleResult.status) return "settle-status-mismatch";
  if (expected.targetChanges && topologySignature(expected.targetChanges) !== topologySignature(actual.targetChanges)) return "target-topology-mismatch";
  return undefined;
}

function oracleSignature(value: OracleResult): string {
  return canonicalJson({ oracleClass: value.oracleClass, verdict: value.verdict, severity: value.severity, message: value.message, requirementRefs: [...value.requirementRefs].sort() });
}

export function oracleDivergence(expected: OracleResult[] | undefined, actual: OracleResult[]): string | undefined {
  if (!expected?.length) return "missing-oracle-expectation";
  const expectedSignatures = expected.map(oracleSignature).sort();
  const actualSignatures = actual.map(oracleSignature).sort();
  return canonicalJson(expectedSignatures) === canonicalJson(actualSignatures) ? undefined : "oracle-result-mismatch";
}

export function stableOracleRefs(oracles: OracleResult[]): string[] {
  return [...new Set(oracles.map(oracle => `oracle:sha256:${sha256(oracleSignature(oracle))}`))].sort();
}

export function replayDetails(steps: ReplayStep[], actual: Array<{ candidateId: string; execution: ExecutionResult; oracles: OracleResult[] }>, divergence?: string): Record<string, unknown> {
  return {
    divergence: divergence ?? null,
    steps: actual.map((step, index) => ({
      index,
      candidateId: step.candidateId,
      execution: { status: step.execution.status, preFingerprint: step.execution.preFingerprint, postFingerprint: step.execution.postFingerprint ?? null, settleStatus: step.execution.settleResult.status, targetChanges: topologySignature(step.execution.targetChanges) },
      oracles: step.oracles.map(oracleSignature).sort(),
      expected: steps[index] ? { candidateId: steps[index].candidate.candidateId, execution: steps[index].execution ? { status: steps[index].execution.status, preFingerprint: steps[index].execution.preFingerprint, postFingerprint: steps[index].execution.postFingerprint ?? null, settleStatus: steps[index].execution.settleStatus, targetChanges: topologySignature(steps[index].execution.targetChanges ?? []) } : null, oracles: steps[index].oracles.map(oracleSignature).sort() } : null,
    })),
  };
}
