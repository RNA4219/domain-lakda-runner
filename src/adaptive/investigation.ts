import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { shrinkFailure, type ReplayStep } from "./input.js";
import { assertLead, type ExplorationLead } from "./scouting.js";

export const INVESTIGATION_SCHEMA_VERSION = "lakda/investigation/v1" as const;
export const PROMOTION_SCHEMA_VERSION = "lakda/promotion/v1" as const;
export const KPI_SCHEMA_VERSION = "lakda/kpi/v1" as const;

export type InvestigationStatus = "pending" | "reproduced" | "not_reproduced" | "inconclusive" | "replay_diverged";
export type Investigation = {
  schemaVersion: typeof INVESTIGATION_SCHEMA_VERSION; investigationId: string; leadId: string; reviewerRef: string; parentLeadDigest: string;
  status: InvestigationStatus; replayCount: 1; createdAt: string; replayDigest?: string; oracleRefs?: string[]; evidenceRefs?: string[]; notesRef?: string;
  traceRef?: string; configDigest?: string; divergenceReason?: string; terminationReason?: string;
};
export type ReplayOutcome = { reproduced: boolean; inconclusive?: boolean; divergence?: string; oracleRefs?: string[]; evidenceRefs?: string[]; details?: Record<string, unknown>; traceRef?: string; configDigest?: string; terminationReason?: string };
export type Promotion = {
  schemaVersion: typeof PROMOTION_SCHEMA_VERSION; promotionId: string; investigationId: string; parentInvestigationDigest: string;
  kind: "trace" | "suite"; status: "promoted"; promotedAt: string; artifactRefs: string[];
};
export type ShrinkStep = ReplayStep & { mutationKind?: string; targetHost?: string; actionRef?: string };
export type ShrinkOptions = { maxAttempts?: number; allowMutationKinds?: string[]; allowedHosts?: string[]; killSwitch?: () => boolean };
export type Kpi = { schemaVersion: typeof KPI_SCHEMA_VERSION; revision: string; numerator: number; denominator: number; ratio: number };

function portableRef(value: string): boolean {
  return Boolean(value) && !value.includes("\\") && !value.includes("\0") && !/^[A-Za-z]:/.test(value) && !value.startsWith("/") && !value.includes("storageState") && !/(?:secret|token|password|cookie|credential|pii)/i.test(value);
}

export function investigationDigest(value: Investigation): string { assertInvestigation(value); return digest(value); }

export function assertPromotionReady(investigation: Investigation, kind: "trace" | "suite", artifactRefs: string[], artifactExists: (ref: string) => boolean): void {
  assertInvestigation(investigation);
  if (kind !== "trace" && kind !== "suite") throw new Error("promotion kind is invalid");
  if (investigation.status !== "reproduced") throw new Error("only reproduced investigation can be promoted");
  if (!investigation.replayDigest) throw new Error("promotion requires replayDigest");
  if (!investigation.oracleRefs?.length) throw new Error("promotion requires oracleRefs");
  if (!investigation.evidenceRefs?.length) throw new Error("promotion requires evidenceRefs");
  if (!artifactRefs.length || artifactRefs.some(ref => !portableRef(ref) || !artifactExists(ref))) throw new Error("promotion artifact is missing");
}

function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(name + " must be an object"); return value as Record<string, unknown>; }
function digest(value: unknown): string { return "sha256:" + sha256(canonicalJson(value)); }

export function createInvestigation(lead: ExplorationLead, reviewerRef: string, createdAt = new Date().toISOString()): Investigation {
  assertLead(lead); if (!reviewerRef.trim()) throw new Error("reviewerRef is required"); if (!Number.isNaN(Date.parse(createdAt)) === false) throw new Error("createdAt must be ISO date");
  const body = { leadId: lead.leadId, parentLeadDigest: lead.leadDigest, reviewerRef, createdAt };
  return { schemaVersion: INVESTIGATION_SCHEMA_VERSION, investigationId: "investigation-" + sha256(canonicalJson(body)).slice(0, 20), leadId: lead.leadId, reviewerRef, parentLeadDigest: lead.leadDigest, status: "pending", replayCount: 1, createdAt };
}

export async function runStrictReplay(investigation: Investigation, replay: () => Promise<ReplayOutcome> | ReplayOutcome): Promise<Investigation> {
  assertInvestigation(investigation); if (investigation.replayCount !== 1) throw new Error("replay count must remain exactly one");
  const outcome = await replay();
  const replayDigest = digest({ investigationId: investigation.investigationId, outcome: outcome.details ?? {}, reproduced: outcome.reproduced, divergence: outcome.divergence ?? null });
  const status: InvestigationStatus = outcome.inconclusive ? "inconclusive" : outcome.divergence ? "replay_diverged" : outcome.reproduced ? "reproduced" : "not_reproduced";
  return {
    ...investigation, status, replayDigest,
    ...(outcome.oracleRefs?.length ? { oracleRefs: [...new Set(outcome.oracleRefs)].sort() } : {}),
    ...(outcome.evidenceRefs?.length ? { evidenceRefs: [...new Set(outcome.evidenceRefs)].sort() } : {}),
    ...(outcome.traceRef ? { traceRef: outcome.traceRef } : {}),
    ...(outcome.configDigest ? { configDigest: outcome.configDigest } : {}),
    ...(outcome.divergence ? { divergenceReason: outcome.divergence } : {}),
    ...(outcome.terminationReason ? { terminationReason: outcome.terminationReason } : {}),
  };
}

export function assertInvestigation(value: unknown): asserts value is Investigation {
  const current = object(value, "investigation");
  const allowed = ["schemaVersion", "investigationId", "leadId", "reviewerRef", "parentLeadDigest", "status", "replayCount", "createdAt", "replayDigest", "oracleRefs", "evidenceRefs", "notesRef", "traceRef", "configDigest", "divergenceReason", "terminationReason"];
  const extra = Object.keys(current).filter(key => !allowed.includes(key)); if (extra.length) throw new Error("investigation has unknown keys: " + extra.join(","));
  if (current.schemaVersion !== INVESTIGATION_SCHEMA_VERSION || typeof current.investigationId !== "string" || typeof current.leadId !== "string" || typeof current.reviewerRef !== "string" || !current.reviewerRef || typeof current.parentLeadDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.parentLeadDigest) || !["pending", "reproduced", "not_reproduced", "inconclusive", "replay_diverged"].includes(current.status as string) || current.replayCount !== 1 || typeof current.createdAt !== "string" || Number.isNaN(Date.parse(current.createdAt))) throw new Error("investigation schema mismatch");
  const expectedId = "investigation-" + sha256(canonicalJson({ leadId: current.leadId, parentLeadDigest: current.parentLeadDigest, reviewerRef: current.reviewerRef, createdAt: current.createdAt })).slice(0, 20);
  if (current.investigationId !== expectedId) throw new Error("investigationId does not match parent digest");
  if (current.replayDigest !== undefined && (typeof current.replayDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.replayDigest))) throw new Error("replayDigest must be sha256");
  for (const key of ["oracleRefs", "evidenceRefs"] as const) {
    if (current[key] !== undefined && (!Array.isArray(current[key]) || current[key].some(ref => typeof ref !== "string" || !ref.trim()))) throw new Error(key + " must be string refs");
  }
  if (current.status === "reproduced" && (!current.replayDigest || !Array.isArray(current.oracleRefs) || current.oracleRefs.length === 0 || !Array.isArray(current.evidenceRefs) || current.evidenceRefs.length === 0)) throw new Error("reproduced investigation requires replayDigest, oracleRefs, and evidenceRefs");
  if (current.traceRef !== undefined && (typeof current.traceRef !== "string" || !portableRef(current.traceRef))) throw new Error("traceRef must be portable");
  if (current.configDigest !== undefined && (typeof current.configDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.configDigest))) throw new Error("configDigest must be sha256");
  if (current.divergenceReason !== undefined && typeof current.divergenceReason !== "string") throw new Error("divergenceReason must be string");
  if (current.terminationReason !== undefined && typeof current.terminationReason !== "string") throw new Error("terminationReason must be string");
}
export function promoteInvestigation(investigation: Investigation, kind: "trace" | "suite", artifactRefs: string[], promotedAt = new Date().toISOString()): Promotion {
  assertInvestigation(investigation);
  if (investigation.status !== "reproduced") throw new Error("only reproduced investigation can be promoted");
  if (!investigation.replayDigest || !investigation.oracleRefs?.length || !investigation.evidenceRefs?.length) throw new Error("promotion requires replayDigest, oracleRefs, and evidenceRefs");
  if (!artifactRefs.length || artifactRefs.some(ref => !portableRef(ref))) throw new Error("promotion requires portable artifactRefs");
  const parentInvestigationDigest = digest(investigation);
  const body = { investigationId: investigation.investigationId, parentInvestigationDigest, kind, artifactRefs: [...new Set(artifactRefs)].sort() };
  return { schemaVersion: PROMOTION_SCHEMA_VERSION, promotionId: "promotion-" + sha256(canonicalJson(body)).slice(0, 20), investigationId: investigation.investigationId, parentInvestigationDigest, kind, status: "promoted", promotedAt, artifactRefs: [...new Set(artifactRefs)].sort() };
}
export function assertPromotion(value: unknown): asserts value is Promotion {
  const current = object(value, "promotion"); const allowed = ["schemaVersion", "promotionId", "investigationId", "parentInvestigationDigest", "kind", "status", "promotedAt", "artifactRefs"];
  const extra = Object.keys(current).filter(key => !allowed.includes(key)); if (extra.length) throw new Error("promotion has unknown keys: " + extra.join(","));
  if (current.schemaVersion !== PROMOTION_SCHEMA_VERSION || typeof current.promotionId !== "string" || typeof current.investigationId !== "string" || typeof current.parentInvestigationDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(current.parentInvestigationDigest) || !["trace", "suite"].includes(current.kind as string) || current.status !== "promoted" || !Array.isArray(current.artifactRefs) || current.artifactRefs.length === 0) throw new Error("promotion schema mismatch");
}

export async function shrinkReproducingSequence<T extends ShrinkStep>(sequence: T[], reproduces: (candidate: T[]) => Promise<boolean>, options: ShrinkOptions = {}): Promise<{ status: "shrunk" | "not_reduced" | "skipped"; sequence: T[]; attempts: number; reason: string }> {
  if (!sequence.length) return { status: "skipped", sequence: [], attempts: 0, reason: "empty-sequence" };
  const allowedMutationKinds = new Set(options.allowMutationKinds ?? ["none"]);
  if (sequence.some(step => !allowedMutationKinds.has(step.mutationKind ?? "none"))) return { status: "skipped", sequence: [...sequence], attempts: 0, reason: "unsafe-mutation-kind" };
  const allowedHosts = options.allowedHosts;
  if (allowedHosts && sequence.some(step => step.targetHost && !allowedHosts.includes(step.targetHost))) return { status: "skipped", sequence: [...sequence], attempts: 0, reason: "scope-out-of-allowlist" };
  let attempts = 0; const maxAttempts = options.maxAttempts ?? 20;
  const reduced = await shrinkFailure(sequence, async candidate => {
    if (options.killSwitch?.()) return false;
    if (attempts >= maxAttempts) return false;
    attempts += 1; return reproduces(candidate);
  });
  return { status: reduced.length < sequence.length ? "shrunk" : "not_reduced", sequence: reduced, attempts, reason: reduced.length < sequence.length ? "reproduced-after-delta" : "no-smaller-reproduction" };
}

export function computeKpi(numerator: number, denominator: number, revision = "lakda-kpi/v1"): Kpi {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 0 || denominator < 0 || numerator > denominator) throw new Error("KPI numerator/denominator is invalid");
  return { schemaVersion: KPI_SCHEMA_VERSION, revision, numerator, denominator, ratio: denominator === 0 ? 0 : numerator / denominator };
}