import { sha256 } from "../core/redaction.js";
import type { ActionCandidate, ExecutionResult, Observation, OracleResult } from "./contracts.js";

export type ProductOracle = (execution: ExecutionResult) => Promise<OracleResult> | OracleResult;

type PredicateCheck = { matched: boolean; mismatches: string[]; unsupported: string[] };
const predicateKeys = new Set(["url", "urlPattern", "host", "state", "visible", "persona", "personaRef", "authenticated", "targetKind", "targetId", "dataBoundary", "obligations"]);

function checkPredicate(predicate: Record<string, unknown>, observation: Observation): PredicateCheck {
  if (observation.completeness !== "complete") return { matched: false, mismatches: [], unsupported: [`observation-${observation.completeness}`] };
  const mismatches: string[] = [];
  const unsupported = Object.keys(predicate).filter(key => !predicateKeys.has(key));
  const mismatch = (key: string, matched: boolean) => { if (!matched) mismatches.push(key); };
  for (const [key, expected] of Object.entries(predicate)) {
    if (!predicateKeys.has(key)) continue;
    if (key === "url") mismatch(key, typeof expected === "string" && observation.url === expected);
    else if (key === "urlPattern") {
      if (typeof expected !== "string") unsupported.push(key);
      else {
        try { mismatch(key, new RegExp(expected).test(observation.url ?? "")); }
        catch { unsupported.push(key); }
      }
    } else if (key === "host") {
      let host: string | undefined;
      try { host = observation.url ? new URL(observation.url).hostname : undefined; } catch { host = undefined; }
      mismatch(key, typeof expected === "string" && host === expected);
    } else if (key === "state") mismatch(key, typeof expected === "string" && observation.ui.state === expected);
    else if (key === "persona" || key === "personaRef") mismatch(key, typeof expected === "string" && observation.personaRef === expected);
    else if (key === "authenticated") mismatch(key, typeof expected === "boolean" && observation.ui.authenticated === expected);
    else if (key === "targetKind") mismatch(key, typeof expected === "string" && observation.targetRef.kind === expected);
    else if (key === "targetId") mismatch(key, typeof expected === "string" && observation.targetRef.targetId === expected);
    else if (key === "dataBoundary") mismatch(key, typeof expected === "string" && (observation.ui.dataBoundary === expected || observation.ui.dataBoundaryRef === expected));
    else if (key === "visible") {
      const elements = Array.isArray(observation.ui.primaryElements) ? observation.ui.primaryElements : [];
      const visible = new Set(elements.flatMap(element => element && typeof element === "object"
        ? ["testId", "name", "role", "label"].flatMap(field => typeof (element as Record<string, unknown>)[field] === "string" ? [(element as Record<string, string>)[field]] : [])
        : []));
      mismatch(key, Array.isArray(expected) && expected.every(value => typeof value === "string" && visible.has(value)));
    } else if (key === "obligations") {
      mismatch(key, Boolean(expected) && typeof expected === "object" && !Array.isArray(expected)
        && Object.entries(expected as Record<string, unknown>).every(([id, value]) => observation.obligations[id] === value));
    }
  }
  const uniqueUnsupported = [...new Set(unsupported)].sort();
  const uniqueMismatches = [...new Set(mismatches)].sort();
  return { matched: uniqueUnsupported.length === 0 && uniqueMismatches.length === 0, mismatches: uniqueMismatches, unsupported: uniqueUnsupported };
}

function productResult(candidate: ActionCandidate, sourceRefs: string[], execution: ExecutionResult | undefined, label: "guard" | "postcondition" | "invariant", check: PredicateCheck): OracleResult {
  const unsupported = check.unsupported.length > 0;
  const failed = !unsupported && !check.matched;
  const message = unsupported ? `${label}-unsupported:${check.unsupported.join(",")}`
    : failed ? `${label === "guard" ? "guard-not-satisfied" : label + "-mismatch"}:${check.mismatches.join(",")}`
      : `${label}-satisfied`;
  return {
    schemaVersion: "lakda/adaptive-contracts/v1",
    oracleId: `product-${sha256(`${candidate.candidateId}:${sourceRefs.join(":")}:${message}`).slice(0, 16)}`,
    oracleClass: "product",
    verdict: unsupported || (label === "guard" && failed) ? "inconclusive" : failed ? "fail" : "pass",
    severity: failed && label !== "guard" ? "major" : unsupported ? "warning" : "info",
    sourceRefs: [candidate.candidateId, ...sourceRefs],
    requirementRefs: candidate.contract?.requirementRefs ?? [],
    evidenceRefs: execution?.evidenceRefs ?? [],
    message,
  };
}

export function evaluateActionGuard(candidate: ActionCandidate, observation: Observation): { allowed: boolean; result?: OracleResult } {
  if (!candidate.contract?.enabledWhen) return { allowed: true };
  const check = checkPredicate(candidate.contract.enabledWhen, observation);
  return { allowed: check.matched, result: productResult(candidate, [observation.observationId], undefined, "guard", check) };
}

export function evaluateActionPostconditions(candidate: ActionCandidate, before: Observation, after: Observation | undefined, execution: ExecutionResult): OracleResult[] {
  const contract = candidate.contract;
  if (!contract?.ensures && !contract?.invariants) {
    return [{
      schemaVersion: "lakda/adaptive-contracts/v1",
      oracleId: `product-${sha256(`${candidate.candidateId}:${execution.executionId}:undefined`).slice(0, 16)}`,
      oracleClass: "product", verdict: "inconclusive", severity: "info",
      sourceRefs: [candidate.candidateId, execution.executionId], requirementRefs: contract?.requirementRefs ?? [],
      evidenceRefs: execution.evidenceRefs, message: "product-contract-undefined",
    }];
  }
  if (!after) {
    return [{
      schemaVersion: "lakda/adaptive-contracts/v1",
      oracleId: `product-${sha256(`${candidate.candidateId}:${execution.executionId}:post-observation-unavailable`).slice(0, 16)}`,
      oracleClass: "product", verdict: "inconclusive", severity: "warning",
      sourceRefs: [candidate.candidateId, execution.executionId, before.observationId],
      requirementRefs: contract.requirementRefs ?? [], evidenceRefs: execution.evidenceRefs, message: "post-observation-unavailable",
    }];
  }
  const results: OracleResult[] = [];
  if (contract.ensures) results.push(productResult(candidate, [execution.executionId, after.observationId], execution, "postcondition", checkPredicate(contract.ensures, after)));
  if (contract.invariants) {
    const pre = checkPredicate(contract.invariants, before);
    const post = checkPredicate(contract.invariants, after);
    results.push(productResult(candidate, [execution.executionId, before.observationId, after.observationId], execution, "invariant", {
      matched: pre.matched && post.matched,
      mismatches: [...new Set([...pre.mismatches, ...post.mismatches])].sort(),
      unsupported: [...new Set([...pre.unsupported, ...post.unsupported])].sort(),
    }));
  }
  return results;
}

export function genericOracle(execution: ExecutionResult, before?: Observation, after?: Observation): OracleResult {
  const reasons: string[] = [];
  if (!["executed", "denied"].includes(execution.status)) reasons.push(`execution-${execution.status}`);
  const beforeEvents = Array.isArray(before?.ui.events) ? before.ui.events : [];
  const afterEvents = Array.isArray(after?.ui.events) ? after.ui.events : [];
  const seen = new Set(beforeEvents.flatMap(event => event && typeof event === "object" && typeof (event as Record<string, unknown>).eventId === "string" ? [(event as Record<string, string>).eventId] : []));
  const failureKinds = new Set(["console-error", "pageerror", "crash", "request-failed", "http-error"]);
  for (const event of afterEvents) {
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (typeof record.eventId === "string" && !seen.has(record.eventId) && typeof record.kind === "string" && failureKinds.has(record.kind)) reasons.push(record.kind);
  }
  if (before?.ui.authenticated === true && after?.ui.authenticated === false) reasons.push("authentication-lost");
  if (execution.evidenceRefs.some(ref => ref.securityStatus === "fail" || ref.redactionStatus === "failed")) reasons.push("artifact-security-failure");
  const uniqueReasons = [...new Set(reasons)].sort();
  const failure = uniqueReasons.length > 0;
  const message = failure
    ? uniqueReasons.length === 1 && uniqueReasons[0].startsWith("execution-") ? uniqueReasons[0] : `generic-failure:${uniqueReasons.join(",")}`
    : execution.status === "denied" ? "execution-denied" : "execution-ok";
  return {
    schemaVersion: "lakda/adaptive-contracts/v1",
    oracleId: `generic-${sha256(`${execution.executionId}:${message}:${before?.observationId ?? ""}:${after?.observationId ?? ""}`).slice(0, 16)}`,
    oracleClass: "generic",
    verdict: failure ? "fail" : execution.status === "denied" ? "inconclusive" : "pass",
    severity: failure ? "major" : "info",
    sourceRefs: [execution.executionId, ...(before ? [before.observationId] : []), ...(after ? [after.observationId] : [])],
    requirementRefs: [],
    evidenceRefs: execution.evidenceRefs,
    message,
  };
}
export async function evaluateProductOracles(execution: ExecutionResult, oracles: ProductOracle[]): Promise<OracleResult[]> {
  return Promise.all(oracles.map(oracle => oracle(execution)));
}
