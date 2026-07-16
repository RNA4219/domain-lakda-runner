import type { AuthorizationRecord } from "./security-policy.js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSensitive } from "../core/redaction.js";

export const ADAPTIVE_SCHEMA_VERSION = "lakda/adaptive-contracts/v1" as const;
export type AdaptiveSchemaVersion = typeof ADAPTIVE_SCHEMA_VERSION;
export type TargetKind = "page" | "frame" | "dialog" | "device" | "surface" | "http";
export type TargetRef = { targetId: string; kind: TargetKind; contextId?: string; parentTargetId?: string; framePath?: string[]; origin?: string; lifecycle?: "active" | "closed" | "lost" };
export type StateFingerprint = { schemaVersion: AdaptiveSchemaVersion; algorithmVersion: string; canonicalizationVersion: string; value: string; observationDigest: string; componentSummary: Record<string, string | number | boolean | null> };
export type EvidenceArtifactRef = { schemaVersion: AdaptiveSchemaVersion; artifactId: string; path: string; sha256: string; size: number; classification: "public" | "internal" | "confidential" | "restricted"; redactionStatus: "not_required" | "redacted" | "pending" | "failed"; securityStatus: "pass" | "fail" | "not_applicable"; hateEntryRef?: string };
export type Observation = {
  schemaVersion: AdaptiveSchemaVersion; observationId: string; observedAt: string; targetRef: TargetRef; completeness: "complete" | "partial" | "unavailable";
  url?: string; personaRef?: string; ui: Record<string, unknown>; forms: Array<Record<string, unknown>>; dialogs: Array<Record<string, unknown>>;
  topology: Record<string, unknown>; networkSummary?: Array<Record<string, unknown>>; obligations: Record<string, "met" | "unmet" | "unknown">;
  provenance: { adapterId: string; runtime: string; capabilityRevision: string }; adapterDataRef?: string;
};
export type LocatorScope = {
  strategy: "test-id" | "role" | "stable-key";
  value: string;
  name?: string;
  boundary: "row" | "listitem" | "card" | "dialog";
  keySource: "test-id" | "heading" | "identifier-hash";
};
export type LocatorRecipe = { strategy: "test-id" | "role" | "scoped-role" | "label" | "text" | "image" | "request"; value: string; name?: string; scope?: LocatorScope; framePath?: string[] };
export type CoverageDebtReason = "ambiguous-locator" | "sensitive-locator" | "missing-accessible-name" | "missing-input-profile" | "out-of-scope-link" | "disabled-control" | "unsupported-control";
export type CoverageDebt = {
  schemaVersion: "lakda-coverage-debt/v1";
  debtId: string;
  reason: CoverageDebtReason;
  actionKind: string;
  role?: string;
  name?: string;
  nameDigest?: string;
  matchedCount?: number;
  scope: "not-applicable" | "resolved" | "ambiguous" | "unavailable";
  targetFingerprint: string;
};
export type CandidateDiscoveryResult = { candidates: ActionCandidate[]; coverageDebt: CoverageDebt[] };
export type MutationKind = "none" | "create" | "update" | "delete" | "purchase" | "publish" | "external-message" | "credential-change" | "parameter-mutation" | "skip" | "reorder" | "double-execution" | "race" | "unknown";
export type DialogHandling = "dismiss" | "hold" | "accept";
export type MutationClassification = { source: "mechanical" | "action-contract" | "heuristic" | "unknown" | "conflict"; ruleId: string; actionId?: string };
export type ProductActionContract = { actionId: string; mutationKind: MutationKind };
export type ActionContract = {
  enabledWhen?: Record<string, unknown>;
  ensures?: Record<string, unknown>;
  invariants?: Record<string, unknown>;
  dialog?: { handling: DialogHandling; messagePattern?: string; types?: string[] };
  requirementRefs?: string[];
};
export type ActionCandidate = {
  schemaVersion: AdaptiveSchemaVersion; candidateId: string; adapterId: string; targetRef: TargetRef; sourceFingerprint: string; actionKind: string;
  locatorRecipe: LocatorRecipe; inputProfileRef?: string; generatedBy: { ruleId: string; observationId: string; reason: string };
  risk: { weight: number; businessPriority?: "P0" | "P1" | "P2" | "P3"; mutationCost?: number }; mutationKind: MutationKind; mutationClassification?: MutationClassification; contract?: ActionContract;
};
export type SettleReadiness = { testId?: string; role?: string; name?: string; state?: "visible" | "hidden" };
export type SettlePolicy = { policyVersion: string; maxWaitMs: number; stableWindowMs: number; readiness?: SettleReadiness; networkQuietExclusions?: string[] };
export type SettleResult = { policyVersion: string; status: "settled" | "timed_out" | "target_lost" | "aborted"; elapsedMs: number; reasons: string[]; signals?: Record<string, { state: "quiet" | "pending" | "met" | "unmet"; reason: string }> };
export type ExecutionResult = {
  schemaVersion: AdaptiveSchemaVersion; executionId: string; candidateId: string; preFingerprint: string; postFingerprint?: string; startedAt: string; endedAt: string;
  status: "executed" | "denied" | "unsupported" | "timeout" | "target_lost" | "action_failed" | "infrastructure_error"; failureSignature?: string;
  recoveryStatus: "not_required" | "recovered" | "not_recovered" | "not_attempted"; targetChanges: Array<Record<string, unknown>>; settleResult: SettleResult; evidenceRefs: EvidenceArtifactRef[];
};
export type OracleResult = { schemaVersion: AdaptiveSchemaVersion; oracleId: string; oracleClass: "generic" | "product" | "security"; verdict: "pass" | "fail" | "inconclusive" | "candidate" | "confirmed"; severity: "info" | "warning" | "major" | "critical"; sourceRefs: string[]; requirementRefs: string[]; evidenceRefs: EvidenceArtifactRef[]; message: string };
export type AdapterCapabilities = { schemaVersion: AdaptiveSchemaVersion; adapterId: string; revision: string; targetKinds: TargetKind[]; actionKinds: string[]; observationCapabilities: string[]; evidenceCapabilities: string[]; recoveryStrategies: string[] };
export type AdapterError = { schemaVersion: AdaptiveSchemaVersion; adapterId: string; category: "unsupported" | "denied" | "timeout" | "target_lost" | "action_failed" | "infrastructure_error"; messageRef: string; originalErrorRef?: string; retryable: boolean };
export type AdaptiveGeneratorStrategy = "random" | "weighted-random" | "least-visited-transition" | "shortest-to-uncovered" | "risk-weighted-uncovered" | "llm-select";
export type AdaptiveStopCondition =
  | { type: "stateCoverage" | "actionCoverage" | "transitionCoverage" | "obligationCoverage"; atLeast: number }
  | { type: "noveltyPlateau"; windowActions: number; minActions: number }
  | { type: "durationMs"; atMost: number };
export type AdaptiveConfig = {
  schemaVersion: "lakda/adaptive-config/v1";
  adapter: { id: "playwright" | "airtest-poco" | "security"; endpoint?: string; initialTarget?: TargetRef };
  generator: { strategy: AdaptiveGeneratorStrategy; version?: string };
  actionContracts?: ProductActionContract[];
  stopWhen: { any?: AdaptiveStopCondition[]; all?: AdaptiveStopCondition[] };
  settlePolicy: SettlePolicy;
  fingerprintPolicy: { algorithmVersion: string; canonicalizationVersion: string };
  recovery: { maxBacktracks: number; maxAttemptsPerState: number };
  safety: { allowTargetKinds: TargetKind[]; denyActionIds: string[]; allowMutationKinds: MutationKind[] };
  securityProfileRef?: string;
  securityAuthorization?: AuthorizationRecord;
};

export type AdaptiveContract = Observation | StateFingerprint | ActionCandidate | ExecutionResult | OracleResult | EvidenceArtifactRef | AdapterCapabilities | AdapterError;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
type Validator = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
type AjvConstructor = new (options: object) => { compile(value: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const schema = JSON.parse(readFileSync(resolve(root, "schemas", "adaptive-contracts-v1.schema.json"), "utf8")) as object;
const coverageDebtSchema = JSON.parse(readFileSync(resolve(root, "schemas", "lakda-coverage-debt-v1.schema.json"), "utf8")) as object;
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);
const validateCandidateDiscovery = new Ajv({ allErrors: true, strict: false }).compile(coverageDebtSchema);
const sensitiveKey = /(?:authorization|cookie|secret|token|password|credential|raw(?:value|body|response)|(?:^|_)pii(?:$|_))/i;
const adapterObjectKey = /^(?:page|frame|browser|context|elementHandle|playwright|airtest|poco|zap)$/i;

export function assertNoSensitivePublicData(value: unknown, path = "$", seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKey.test(key)) throw new Error(`公開契約にsensitive fieldを含められません: ${path}.${key}`);
    if (adapterObjectKey.test(key)) throw new Error("public contract cannot contain adapter object: " + path + "." + key);
    assertNoSensitivePublicData(nested, `${path}.${key}`, seen);
  }
}

export function assertAdaptiveContract(value: unknown): asserts value is AdaptiveContract {
  if (!validateSchema(value)) throw new Error(`adaptive contract schemaに適合しません: ${validateSchema.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  if ((value as { schemaVersion?: unknown }).schemaVersion !== ADAPTIVE_SCHEMA_VERSION) throw new Error("unknown adaptive schemaVersion");
  assertNoSensitivePublicData(value);
}

export function assertCandidateDiscoveryResult(value: unknown): asserts value is CandidateDiscoveryResult {
  if (!validateCandidateDiscovery(value)) throw new Error(`candidate discovery schemaに適合しません: ${validateCandidateDiscovery.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  const result = value as CandidateDiscoveryResult;
  result.candidates.forEach(assertAdaptiveContract);
  for (const debt of result.coverageDebt) {
    if (debt.name && findSensitive(debt.name).length) throw new Error("coverage debtにsensitive nameを含められません");
    if (debt.name && debt.nameDigest) throw new Error("coverage debtはnameとnameDigestを同時に含められません");
  }
  assertNoSensitivePublicData(result);
}