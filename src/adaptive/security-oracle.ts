import type { ActionCandidate, ExecutionResult, OracleResult } from "./contracts.js";

type ZapAlert = { alertId: string; pluginId: string; confidence: string; risk: string; requestRef: string; responseRef: string; discoveryState: string };
function stringField(value: Record<string, unknown>, field: keyof ZapAlert): string | undefined {
  const item = value[field];
  return typeof item === "string" && item.length > 0 ? item : undefined;
}
function zapAlert(candidate: ActionCandidate): ZapAlert | undefined {
  if (candidate.adapterId !== "security" || candidate.actionKind !== "zap-alert") return undefined;
  const value = candidate.contract?.ensures?.zapAlert;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const alertId = stringField(record, "alertId"); const pluginId = stringField(record, "pluginId");
  const confidence = stringField(record, "confidence"); const risk = stringField(record, "risk");
  const requestRef = stringField(record, "requestRef"); const responseRef = stringField(record, "responseRef");
  const discoveryState = stringField(record, "discoveryState");
  return alertId && pluginId && confidence && risk && requestRef && responseRef && discoveryState
    ? { alertId, pluginId, confidence, risk, requestRef, responseRef, discoveryState }
    : undefined;
}
function severity(risk: string): OracleResult["severity"] {
  if (risk.toLowerCase() === "high") return "critical";
  if (risk.toLowerCase() === "medium") return "major";
  if (risk.toLowerCase() === "low") return "warning";
  return "info";
}

/** Scanner alerts are discovery evidence only; confirmation remains a separate human or explicit-oracle flow. */
export function securityOracle(candidate: ActionCandidate, result: ExecutionResult): OracleResult | undefined {
  const alert = zapAlert(candidate);
  if (!alert) return undefined;
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", oracleId: "security-zap:" + alert.alertId, oracleClass: "security",
    verdict: "candidate", severity: severity(alert.risk),
    sourceRefs: ["zap-alert:" + alert.alertId, "zap-plugin:" + alert.pluginId, "zap-confidence:" + alert.confidence, alert.requestRef, alert.responseRef, alert.discoveryState, "replay-candidate:" + candidate.candidateId],
    requirementRefs: candidate.contract?.requirementRefs ?? [], evidenceRefs: result.evidenceRefs,
    message: "ZAP alert is retained as a security candidate; confirmation requires authorized replay and an explicit security oracle or human record.",
  };
}
