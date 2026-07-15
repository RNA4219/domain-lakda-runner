import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { writeVerifiedText } from "../core/artifact-store.js";
import type { LocalLlmClient } from "../core/llm.js";

export const SIGNAL_SCHEMA_VERSION = "lakda/exploration-signal/v1" as const;
export const LEAD_SCHEMA_VERSION = "lakda/exploration-lead/v1" as const;
export const SCOUT_CONTEXT_SCHEMA_VERSION = "lakda/llm-scout-context/v1" as const;
export const SCOUT_RESPONSE_SCHEMA_VERSION = "lakda/llm-scout-response/v1" as const;

export type SignalKind = "trace_failure" | "oracle_failure" | "timeout" | "topology_change" | "coverage_gap" | "safety_refusal";
export type SignalSeverity = "info" | "warning" | "major" | "critical";
export type ExplorationSignal = {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION; signalId: string; runId: string; kind: SignalKind; severity: SignalSeverity;
  sourceRefs: string[]; messageRef: string; targetRef?: string; fingerprint?: string; evidenceRefs?: string[]; attributes?: Record<string, string | number | boolean>;
};
export type ExplorationLead = {
  schemaVersion: typeof LEAD_SCHEMA_VERSION; leadId: string; leadType: SignalKind; signalIds: string[]; priority: number;
  status: "open" | "investigating" | "reproduced" | "not_reproduced" | "promoted" | "dismissed"; sourceRefs?: string[]; leadDigest: string;
};
export type ScoutContext = { schemaVersion: typeof SCOUT_CONTEXT_SCHEMA_VERSION; contextId: string; leadRefs: string[]; capabilityRefs: string[]; policy: { mode: "loopback-json/v1"; maxLeads: number } };
export type ScoutResponse = { schemaVersion: typeof SCOUT_RESPONSE_SCHEMA_VERSION; leadId: string; priority: number; rationaleRef: string; actionRefs: string[] };
export type ScoutResult = { signals: ExplorationSignal[]; leads: ExplorationLead[]; context: ScoutContext };

function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(name + " must be an object"); return value as Record<string, unknown>; }
function keys(value: Record<string, unknown>, allowed: string[], name: string): void { const extra = Object.keys(value).filter(key => !allowed.includes(key)); if (extra.length) throw new Error(name + " has unknown keys: " + extra.join(",")); }
function digest(value: unknown): string { return "sha256:" + sha256(canonicalJson(value)); }
function sourceRef(entry: Record<string, unknown>, index: number): string { return typeof entry.executionId === "string" ? entry.executionId : typeof entry.observationId === "string" ? entry.observationId : "trace:" + index; }
function target(entry: Record<string, unknown>): string | undefined { const candidate = entry.candidate; if (typeof entry.targetId === "string") return entry.targetId; if (candidate && typeof candidate === "object" && typeof (candidate as Record<string, unknown>).candidateId === "string") return (candidate as Record<string, string>).candidateId; return undefined; }
function fingerprint(entry: Record<string, unknown>): string | undefined { return typeof entry.postFingerprint === "string" ? entry.postFingerprint : typeof entry.preFingerprint === "string" ? entry.preFingerprint : undefined; }
function makeSignal(runId: string, kind: SignalKind, sourceRefs: string[], data: Record<string, unknown>, signalSeverity: SignalSeverity = "warning"): ExplorationSignal {
  const messageRef = digest({ kind, sourceRefs, data }); const body = { runId, kind, sourceRefs: [...new Set(sourceRefs)].sort(), data };
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION, signalId: "signal-" + sha256(canonicalJson(body)).slice(0, 20), runId, kind, severity: signalSeverity,
    sourceRefs: [...new Set(sourceRefs)].sort(), messageRef,
    ...(typeof data.targetRef === "string" ? { targetRef: data.targetRef } : {}),
    ...(typeof data.fingerprint === "string" ? { fingerprint: data.fingerprint } : {}),
    ...(Array.isArray(data.evidenceRefs) ? { evidenceRefs: data.evidenceRefs.filter((v): v is string => typeof v === "string").sort() } : {}),
    attributes: Object.fromEntries(Object.entries(data).filter(([key, value]) => key !== "targetRef" && key !== "fingerprint" && key !== "evidenceRefs" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")).sort(([left], [right]) => left.localeCompare(right))) as Record<string, string | number | boolean>,
  };
}

export function signalsFromTrace(trace: unknown, runId: string): ExplorationSignal[] {
  if (!runId) throw new Error("runId is required");
  const source = Array.isArray(trace) ? trace : object(trace, "trace").trace;
  if (!Array.isArray(source)) throw new Error("trace must contain an array");
  const signals: ExplorationSignal[] = [];
  source.forEach((value, index) => {
    const entry = object(value, "trace[" + index + "]"); const ref = sourceRef(entry, index); const base = { targetRef: target(entry), fingerprint: fingerprint(entry) };
    const status = typeof entry.status === "string" ? entry.status : typeof entry.executionStatus === "string" ? entry.executionStatus : undefined;
    const failure = typeof entry.failureSignature === "string" ? entry.failureSignature : undefined;
    if (status === "timeout" || failure?.toLowerCase().includes("timeout")) signals.push(makeSignal(runId, "timeout", [ref], { ...base, failure: failure ?? "timeout" }, "major"));
    if (failure?.toLowerCase().includes("safety") || failure?.toLowerCase().includes("denied") || status === "denied") signals.push(makeSignal(runId, "safety_refusal", [ref], { ...base, failure: failure ?? "denied" }, "warning"));
    if (failure && status !== "timeout" && status !== "denied") signals.push(makeSignal(runId, "trace_failure", [ref], { ...base, failure }, "major"));
    const oracle = entry.result ?? entry.oracle ?? entry.oracleResult;
    if (oracle && typeof oracle === "object") {
      const verdict = (oracle as Record<string, unknown>).verdict;
      if (verdict === "fail" || verdict === "candidate" || verdict === "confirmed") {
        const oracleId = typeof (oracle as Record<string, unknown>).oracleId === "string" ? (oracle as Record<string, string>).oracleId : ref;
        signals.push(makeSignal(runId, "oracle_failure", [ref, oracleId], { ...base, verdict, severity: (oracle as Record<string, unknown>).severity ?? "major" }, verdict === "confirmed" ? "critical" : verdict === "fail" ? "major" : "warning"));
      }
    }
    if (Array.isArray(entry.targetChanges) && entry.targetChanges.length > 0) signals.push(makeSignal(runId, "topology_change", [ref], { ...base, changeCount: entry.targetChanges.length }, "info"));
    const coverage = entry.coverage;
    const uncovered = coverage && typeof coverage === "object" ? (coverage as Record<string, unknown>).uncovered : undefined;
    if (Array.isArray(uncovered) && uncovered.length > 0) signals.push(makeSignal(runId, "coverage_gap", [ref], { ...base, uncoveredCount: uncovered.length }, "warning"));
  });
  const seen = new Set<string>();
  return signals.filter(signal => !seen.has(signal.signalId) && (seen.add(signal.signalId), true)).sort((left, right) => left.signalId.localeCompare(right.signalId));
}

const priorityBySeverity: Record<SignalSeverity, number> = { info: 10, warning: 40, major: 70, critical: 100 };
export function groupLeadsRuleOnly(signals: ExplorationSignal[], leadCap = 3): ExplorationLead[] {
  if (!Number.isInteger(leadCap) || leadCap < 1 || leadCap > 3) throw new Error("lead cap must be between 1 and 3");
  signals.forEach(assertSignal);
  const groups = new Map<string, ExplorationSignal[]>();
  for (const signal of [...signals].sort((left, right) => left.signalId.localeCompare(right.signalId))) {
    const key = signal.kind + "|" + (signal.targetRef ?? "") + "|" + (signal.fingerprint ?? "");
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }
  return [...groups.entries()].map(([key, grouped]) => {
    const signalIds = grouped.map(signal => signal.signalId).sort(); const sourceRefs = [...new Set(grouped.flatMap(signal => signal.sourceRefs))].sort();
    const leadType = grouped.slice().sort((left, right) => priorityBySeverity[right.severity] - priorityBySeverity[left.severity] || left.signalId.localeCompare(right.signalId))[0].kind;
    const body = { leadType, signalIds, sourceRefs, key }; const leadDigest = digest(body);
    return { schemaVersion: LEAD_SCHEMA_VERSION, leadId: "lead-" + sha256(canonicalJson(body)).slice(0, 20), leadType, signalIds, priority: Math.min(100, Math.max(...grouped.map(signal => priorityBySeverity[signal.severity]))), status: "open" as const, sourceRefs, leadDigest };
  }).sort((left, right) => right.priority - left.priority || left.leadId.localeCompare(right.leadId)).slice(0, leadCap);
}

export function buildScoutContext(leads: ExplorationLead[], capabilityRefs: string[] = [], leadCap = 3): ScoutContext {
  if (!Number.isInteger(leadCap) || leadCap < 1 || leadCap > 3) throw new Error("lead cap must be between 1 and 3");
  const selected = leads.slice().sort((left, right) => right.priority - left.priority || left.leadId.localeCompare(right.leadId)).slice(0, leadCap); selected.forEach(assertLead);
  const leadRefs = selected.map(lead => lead.leadId);
  return { schemaVersion: SCOUT_CONTEXT_SCHEMA_VERSION, contextId: "context-" + sha256(canonicalJson({ leadRefs, capabilityRefs, leadCap })).slice(0, 20), leadRefs, capabilityRefs: [...new Set(capabilityRefs)].sort(), policy: { mode: "loopback-json/v1", maxLeads: leadCap } };
}

export function assertSignal(value: unknown): asserts value is ExplorationSignal {
  const current = object(value, "signal"); keys(current, ["schemaVersion", "signalId", "runId", "kind", "severity", "sourceRefs", "messageRef", "targetRef", "fingerprint", "evidenceRefs", "attributes"], "signal");
  if (current.schemaVersion !== SIGNAL_SCHEMA_VERSION || typeof current.signalId !== "string" || !current.signalId.startsWith("signal-") || typeof current.runId !== "string" || !["trace_failure", "oracle_failure", "timeout", "topology_change", "coverage_gap", "safety_refusal"].includes(current.kind as string) || !["info", "warning", "major", "critical"].includes(current.severity as string) || !Array.isArray(current.sourceRefs) || typeof current.messageRef !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.messageRef)) throw new Error("signal schema mismatch");
}
export function assertLead(value: unknown): asserts value is ExplorationLead {
  const current = object(value, "lead"); keys(current, ["schemaVersion", "leadId", "leadType", "signalIds", "priority", "status", "sourceRefs", "leadDigest"], "lead");
  const priority = typeof current.priority === "number" ? current.priority : -1;
  if (current.schemaVersion !== LEAD_SCHEMA_VERSION || typeof current.leadId !== "string" || !current.leadId.startsWith("lead-") || !Array.isArray(current.signalIds) || current.signalIds.length === 0 || !Number.isInteger(priority) || priority < 0 || priority > 100 || typeof current.leadDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.leadDigest)) throw new Error("lead schema mismatch");
}
export function assertScoutResponse(value: unknown, allowedLeadIds: string[]): asserts value is ScoutResponse {
  const current = object(value, "scout response"); keys(current, ["schemaVersion", "leadId", "priority", "rationaleRef", "actionRefs"], "scout response");
  const priority = typeof current.priority === "number" ? current.priority : -1;
  if (current.schemaVersion !== SCOUT_RESPONSE_SCHEMA_VERSION || typeof current.leadId !== "string" || !allowedLeadIds.includes(current.leadId) || !Number.isInteger(priority) || priority < 0 || priority > 100 || typeof current.rationaleRef !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.rationaleRef) || !Array.isArray(current.actionRefs) || current.actionRefs.some(ref => typeof ref !== "string" || /selector|https?:|url|path|code|command|input/i.test(ref))) throw new Error("scout response contains unknown lead or forbidden action ref");
}
export async function writeScoutEvidence(path: string, event: { context: ScoutContext; response?: ScoutResponse; accepted: boolean; rejectionReason?: string }): Promise<void> {
  const record = { schemaVersion: "lakda/scout-evidence/v1", contextId: event.context.contextId, inputDigest: digest(event.context), ...(event.response ? { outputDigest: digest(event.response) } : {}), accepted: event.accepted, ...(event.rejectionReason ? { rejectionReason: digest(event.rejectionReason) } : {}) };
  await writeVerifiedText(path, JSON.stringify(record));
}

export async function scoutWithLoopback(client: Pick<LocalLlmClient, "scout">, context: ScoutContext, leads: ExplorationLead[], summary: Record<string, unknown> = {}): Promise<ScoutResponse> {
  const allowed = leads.filter(lead => context.leadRefs.includes(lead.leadId)).map(lead => lead.leadId); const response = await client.scout(context, summary); assertScoutResponse(response, allowed); return response;
}