import { createHash, verify as verifySignature } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LakdaConfig } from "../core/types.js";
import { assertHateManifest } from "../core/hate.js";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type AjvInstance = { addSchema(value: object): void; compile(value: object): Validator; errorsText(errors: unknown, options?: object): string };
type AjvConstructor = new (options: object) => AjvInstance;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export class AcceptanceInputError extends Error {
  constructor(message: string) { super(message); this.name = "AcceptanceInputError"; }
}

export function acceptanceFailureExitCode(error: unknown): 1 | 2 {
  return error instanceof AcceptanceInputError ? 2 : 1;
}

export type JsonRecord<T = unknown> = { path: string; bytes: Buffer; value: T; sha256: string };
export type HateArtifactRef = { path: string; sha256: string; size: number };
export type VerifiedHateManifest = {
  manifest: { schema_version: "HATE/v1"; run_id: string; run_attempt: number; commit_sha: string; artifacts: Array<{ path: string; sha256: string; size_bytes: number }> };
  manifestPath: string;
  runDir: string;
  refs: HateArtifactRef[];
  byPath: Map<string, HateArtifactRef>;
};
export type ArtifactReferenceLike = { path: string; sha256: string; size?: number; size_bytes?: number };
export type CandidateAuditLike = {
  observedControls: number;
  classifiedControls: number;
  unclassifiedControls: number;
  candidateCount: number;
  coverageDebtCount: number;
  debtByReason: Record<string, number>;
  requiredActionIds: string[];
  observedActionIds: string[];
  debtActionIds: string[];
  eligible: boolean;
  violations: string[];
};
export type SecurityAuditLike = {
  acceptanceMode: "deny-all" | "authorized-active" | "passive";
  policyEvaluationCount: number;
  allowedPolicyCount: number;
  deniedPolicyCount: number;
  startedRequestCount: number;
  permitReceiptRefs: string[];
  cleanupAttempts: number;
  cleanupFailures: number;
  killSwitchChecks: number;
  eligible: boolean;
  violations: string[];
};
export type VerifyHateArtifactsOptions = { runDir?: string; expectedManifestPath?: string };

export type TargetManifest = {
  schemaVersion: "lakda/target-manifest/v1" | "lakda/target-manifest/v2";
  manifestId: string;
  status: "pending_external" | "ready";
  binding?: { targetRevision: string; configDigest: string };
  environment: { name: "staging"; baseUrlOrigin: string | null };
  access: { approved: boolean; authSource: string; approvalEvidenceRef: string };
  scope: { allowHosts: string[]; pathPrefixes: string[] };
  safety: { allowMutationKinds: string[]; resetProcedureRef: string; killSwitchRef: string };
  actionContracts: Array<{ actionId: string; mutationKind: string }>;
  settleProfile: { policyVersion: string; readiness?: object | null; networkQuietExclusions: string[] };
  acceptance: { p0ActionIds: string[]; p1ActionIds: string[] };
  security?: {
    acceptanceMode: "deny-all" | "authorized-active" | "passive";
    authorization: {
      authorizationId: string;
      validFrom: string;
      validUntil: string;
      approvalEvidenceRef: string;
      signatureRef: string;
      signedPayloadDigest: string;
      signature: { algorithm: "ed25519"; publicKeyPem: string; valueBase64: string };
    };
    requestScope: { methods: string[]; requestTemplateDigests: string[] };
    limits: { maxRatePerMinute: number; maxConcurrency: number };
    dataPolicyRef: string;
    stopContactRef: string;
    securityProfile: { ref: string; digest: string };
    bridgeBinding: { capabilityDigest: string; bridgeDigest: string };
  };
};

export const digest = (bytes: Uint8Array | string): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");
export const canonical = (value: unknown): string => Array.isArray(value)
  ? "[" + value.map(canonical).join(",") + "]"
  : value && typeof value === "object"
    ? "{" + Object.keys(value as Record<string, unknown>).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}"
    : JSON.stringify(value);

export function requiredEnvironment(name: string, aliases: string[] = []): string {
  for (const candidate of [name, ...aliases]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new AcceptanceInputError([name, ...aliases].join(" or ") + " is required");
}

export function assertCaseId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new AcceptanceInputError("case ID is invalid");
}

async function schemaValidator(schemaName: string): Promise<{ validate: Validator; ajv: AjvInstance }> {
  const [schema, hateSchema] = await Promise.all([
    readFile(resolve(repositoryRoot, "schemas", schemaName), "utf8").then(JSON.parse) as Promise<object>,
    readFile(resolve(repositoryRoot, "vendor", "hate", "v1", "artifact-manifest.schema.json"), "utf8").then(JSON.parse) as Promise<object>,
  ]);
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(hateSchema);
  return { validate: ajv.compile(schema), ajv };
}

export async function assertSchema(value: unknown, schemaName: string, label: string, inputContract = false): Promise<void> {
  const { validate, ajv } = await schemaValidator(schemaName);
  if (validate(value)) return;
  const message = label + " is invalid: " + ajv.errorsText(validate.errors, { separator: "; " });
  if (inputContract) throw new AcceptanceInputError(message);
  throw new Error(message);
}

export async function readJsonRecord<T = unknown>(path: string, label: string, schemaName?: string, inputContract = false): Promise<JsonRecord<T>> {
  const absolute = resolve(path);
  let bytes: Buffer;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("not a regular file");
    bytes = await readFile(absolute);
  } catch {
    throw new AcceptanceInputError(label + " is unavailable");
  }
  let value: T;
  try { value = JSON.parse(bytes.toString("utf8")) as T; }
  catch { throw new AcceptanceInputError(label + " is invalid JSON"); }
  if (schemaName) await assertSchema(value, schemaName, label, inputContract);
  return { path: absolute, bytes, value, sha256: digest(bytes) };
}

export function withinPathPrefix(pathname: string, prefix: string): boolean {
  const normalized = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return normalized === "/" || pathname === normalized || pathname.startsWith(normalized + "/");
}

export function targetManifestSigningPayload(target: TargetManifest): string {
  const unsigned = structuredClone(target) as unknown as { security?: { authorization: Record<string, unknown> } };
  if (!unsigned.security) throw new AcceptanceInputError("security target manifest is missing a security binding");
  delete unsigned.security.authorization.signature;
  delete unsigned.security.authorization.signedPayloadDigest;
  return canonical(unsigned);
}

export function assertSecurityTargetManifestSignature(target: TargetManifest, now = new Date()): void {
  if (target.schemaVersion !== "lakda/target-manifest/v2" || !target.security) throw new AcceptanceInputError("security acceptance requires target manifest v2");
  const payload = targetManifestSigningPayload(target);
  if (target.security.authorization.signedPayloadDigest !== digest(payload)) throw new AcceptanceInputError("target manifest signed payload digest mismatch");
  const validFrom = new Date(target.security.authorization.validFrom);
  const validUntil = new Date(target.security.authorization.validUntil);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || now < validFrom || now > validUntil) throw new AcceptanceInputError("target manifest authorization is not currently valid");
  if (target.security.authorization.approvalEvidenceRef !== target.access.approvalEvidenceRef) throw new AcceptanceInputError("target manifest approval evidence binding mismatch");
  let verified: boolean;
  try {
    verified = verifySignature(null, Buffer.from(payload, "utf8"), target.security.authorization.signature.publicKeyPem, Buffer.from(target.security.authorization.signature.valueBase64, "base64"));
  } catch {
    verified = false;
  }
  if (!verified) throw new AcceptanceInputError("target manifest authorization signature is invalid");
}

export async function loadReadyTargetManifest(path: string): Promise<JsonRecord<TargetManifest>> {
  const record = await readJsonRecord<TargetManifest>(path, "target manifest");
  const schemaName = record.value?.schemaVersion === "lakda/target-manifest/v1"
    ? "lakda-target-manifest-v1.schema.json"
    : record.value?.schemaVersion === "lakda/target-manifest/v2"
      ? "lakda-target-manifest-v2.schema.json"
      : undefined;
  if (!schemaName) throw new AcceptanceInputError("target manifest version is unsupported");
  await assertSchema(record.value, schemaName, "target manifest", true);
  if (record.value.status !== "ready" || !record.value.access.approved) throw new AcceptanceInputError("target manifest remains pending_external");
  if (record.value.schemaVersion === "lakda/target-manifest/v2") assertSecurityTargetManifestSignature(record.value);
  return record;
}

export function assertTargetManifestBinding(target: TargetManifest, targetRevision: string, configDigest: string): void {
  if (!target.binding || target.binding.targetRevision !== targetRevision || target.binding.configDigest !== configDigest) {
    throw new AcceptanceInputError("target manifest revision/config binding does not match immutable corpus case");
  }
}

export function applyTargetManifest(config: LakdaConfig, target: TargetManifest): void {
  if (!config.baseUrl || !config.adaptive) throw new AcceptanceInputError("real acceptance requires adaptive config and baseUrl");
  const baseUrl = new URL(config.baseUrl);
  if (target.environment.baseUrlOrigin !== baseUrl.origin) throw new AcceptanceInputError("target manifest origin does not match config");
  if (!target.scope.allowHosts.includes(baseUrl.hostname) || canonical([...target.scope.allowHosts].sort()) !== canonical([...config.safety.allowHosts].sort())) {
    throw new AcceptanceInputError("target manifest host scope does not match config");
  }
  if (!target.scope.pathPrefixes.some(prefix => withinPathPrefix(baseUrl.pathname, prefix))) throw new AcceptanceInputError("target manifest path scope does not match config");
  if (target.settleProfile.policyVersion !== config.adaptive.settlePolicy.policyVersion) throw new AcceptanceInputError("target manifest settle policy does not match config");
  if (canonical(target.settleProfile.readiness ?? null) !== canonical(config.adaptive.settlePolicy.readiness ?? null)) throw new AcceptanceInputError("target manifest readiness does not match config");
  for (const kind of config.adaptive.safety.allowMutationKinds) {
    if (!target.safety.allowMutationKinds.includes(kind)) throw new AcceptanceInputError("target manifest mutation allowlist does not cover config");
  }
  if (canonical(config.adaptive.actionContracts ?? []) !== canonical(target.actionContracts)) throw new AcceptanceInputError("target manifest action contracts do not match config");
  if (target.schemaVersion === "lakda/target-manifest/v2") {
    const security = target.security;
    const authorization = config.adaptive.securityAuthorization;
    if (!security || config.adaptive.adapter.id !== "security" || !authorization || config.adaptive.securityEnvironment !== target.environment.name) {
      throw new AcceptanceInputError("target manifest security mode does not match config");
    }
    if (
      authorization.authorizationId !== security.authorization.authorizationId ||
      authorization.approvalEvidenceRef !== security.authorization.approvalEvidenceRef ||
      authorization.validFrom !== security.authorization.validFrom ||
      authorization.validUntil !== security.authorization.validUntil ||
      authorization.signature.signedPayloadDigest !== security.authorization.signedPayloadDigest ||
      authorization.signature.signatureRef !== security.authorization.signatureRef ||
      authorization.targets.targetRevision !== target.binding?.targetRevision ||
      canonical([...authorization.targets.methods].sort()) !== canonical([...security.requestScope.methods].sort()) ||
      canonical([...authorization.targets.requestTemplateDigests].sort()) !== canonical([...security.requestScope.requestTemplateDigests].sort()) ||
      authorization.maxRatePerMinute !== security.limits.maxRatePerMinute ||
      authorization.maxConcurrency !== security.limits.maxConcurrency ||
      authorization.dataPolicyRef !== security.dataPolicyRef ||
      authorization.stopContactRef !== security.stopContactRef ||
      config.adaptive.securityProfileRef !== security.securityProfile.ref ||
      authorization.binding.securityProfileDigest !== security.securityProfile.digest ||
      authorization.binding.capabilityDigest !== security.bridgeBinding.capabilityDigest ||
      authorization.binding.bridgeDigest !== security.bridgeBinding.bridgeDigest
    ) {
      throw new AcceptanceInputError("target manifest security authorization binding does not match config");
    }
  }
  config.safety.allowHosts = [...target.scope.allowHosts];
  config.safety.pathPrefixes = [...target.scope.pathPrefixes];
  config.adaptive.settlePolicy.networkQuietExclusions = [...target.settleProfile.networkQuietExclusions];
}

function assertPortableSegments(path: string, label: string): void {
  if (!path || path.includes("\0") || path.includes("\\") || /^[A-Za-z]:/.test(path) || path.startsWith("/") || path.endsWith("/") || path.includes("//")) {
    throw new AcceptanceInputError(label + " is not a canonical portable path");
  }
  const segments = path.split("/");
  if (segments.some(segment => segment === "." || segment === ".." || segment.length === 0)) {
    throw new AcceptanceInputError(label + " contains a non-portable path segment");
  }
}

export function portableRunPath(runDir: string, path: string, label = "HATE artifact path"): string {
  if (!isAbsolute(path)) assertPortableSegments(path, label);
  const absolute = resolve(runDir, path);
  const rel = relative(resolve(runDir), absolute);
  if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) {
    throw new AcceptanceInputError(label + " escapes run directory");
  }
  const portable = rel.replaceAll("\\", "/");
  assertPortableSegments(portable, label);
  return portable;
}

async function realRunDirectory(runDir: string): Promise<string> {
  try {
    const resolved = await realpath(resolve(runDir));
    if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
    return resolved;
  } catch {
    throw new AcceptanceInputError("run directory is unavailable");
  }
}

export async function resolveRunFile(runDir: string, path: string, label: string): Promise<{ path: string; portable: string }> {
  const portable = portableRunPath(runDir, path, label);
  const realRoot = await realRunDirectory(runDir);
  let resolved: string;
  try {
    resolved = await realpath(resolve(runDir, portable));
    if (!(await stat(resolved)).isFile()) throw new Error("not a regular file");
  } catch {
    throw new AcceptanceInputError(label + " is unavailable");
  }
  const realRelative = relative(realRoot, resolved);
  if (!realRelative || realRelative === ".." || realRelative.startsWith("..\\") || realRelative.startsWith("../") || isAbsolute(realRelative)) {
    throw new AcceptanceInputError(label + " resolves outside run directory");
  }
  return { path: resolved, portable };
}

function canonicalPathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function normalizeArtifactRef(ref: ArtifactReferenceLike, label: string): HateArtifactRef {
  const path = ref.path;
  assertPortableSegments(path, label + " path");
  const size = ref.size ?? ref.size_bytes;
  if (!Number.isInteger(size) || (size ?? -1) < 0 || !/^sha256:[0-9a-f]{64}$/.test(ref.sha256)) {
    throw new AcceptanceInputError(label + " is invalid");
  }
  return { path, sha256: ref.sha256, size: size as number };
}

export async function verifyHateArtifacts(manifestPath: string, options: VerifyHateArtifactsOptions = {}): Promise<VerifiedHateManifest> {
  const absoluteManifest = resolve(manifestPath);
  const runDir = resolve(options.runDir ?? dirname(dirname(absoluteManifest)));
  const manifestPortable = portableRunPath(runDir, absoluteManifest, "HATE manifest path");
  if (options.expectedManifestPath) {
    assertPortableSegments(options.expectedManifestPath, "expected HATE manifest path");
    if (manifestPortable !== options.expectedManifestPath) throw new AcceptanceInputError("HATE manifest is not at the expected run location");
  }
  const resolvedManifest = await resolveRunFile(runDir, absoluteManifest, "HATE manifest");
  let manifest: VerifiedHateManifest["manifest"];
  try {
    manifest = JSON.parse(await readFile(resolvedManifest.path, "utf8")) as VerifiedHateManifest["manifest"];
    assertHateManifest(manifest);
  } catch (error) {
    if (error instanceof AcceptanceInputError) throw error;
    throw new AcceptanceInputError("HATE manifest is invalid");
  }
  const refs: HateArtifactRef[] = [];
  const byPath = new Map<string, HateArtifactRef>();
  const canonicalPaths = new Set<string>();
  for (const artifact of manifest.artifacts) {
    assertPortableSegments(artifact.path, "HATE artifact path");
    const portable = portableRunPath(runDir, artifact.path);
    const key = canonicalPathKey(portable);
    if (canonicalPaths.has(key)) throw new AcceptanceInputError("HATE manifest contains duplicate canonical artifact path");
    canonicalPaths.add(key);
    const resolvedArtifact = await resolveRunFile(runDir, portable, "HATE artifact");
    let bytes: Buffer;
    try { bytes = await readFile(resolvedArtifact.path); }
    catch { throw new AcceptanceInputError("HATE artifact is unavailable"); }
    if (artifact.size_bytes !== bytes.length || artifact.sha256 !== digest(bytes)) throw new AcceptanceInputError("HATE artifact digest mismatch: " + artifact.path);
    const ref = { path: portable, sha256: artifact.sha256, size: artifact.size_bytes };
    refs.push(ref);
    byPath.set(portable, ref);
  }
  return { manifest, manifestPath: absoluteManifest, runDir, refs, byPath };
}

export function assertManifestIdentity(verified: VerifiedHateManifest, runId: string, attempt: number): void {
  if (verified.manifest.run_id !== runId || verified.manifest.run_attempt !== attempt) throw new AcceptanceInputError("HATE manifest identity does not match case report");
}

export async function assertReportBound(verified: VerifiedHateManifest, reportPath: string, refs: ArtifactReferenceLike[]): Promise<void> {
  const resolvedReport = await resolveRunFile(verified.runDir, resolve(reportPath), "case report");
  const portable = resolvedReport.portable;
  let bytes: Buffer;
  try { bytes = await readFile(resolvedReport.path); }
  catch { throw new AcceptanceInputError("case report is unavailable"); }
  const reportRef = verified.byPath.get(portable);
  if (!reportRef || reportRef.sha256 !== digest(bytes) || reportRef.size !== bytes.length) throw new AcceptanceInputError("case report is not bound to final HATE manifest");
  const seen = new Set<string>();
  for (const ref of refs) {
    const normalized = normalizeArtifactRef(ref, "artifact reference");
    const key = canonicalPathKey(normalized.path);
    if (seen.has(key)) continue;
    seen.add(key);
    const actual = verified.byPath.get(normalized.path);
    if (!actual || actual.sha256 !== normalized.sha256 || actual.size !== normalized.size) throw new AcceptanceInputError("artifact reference mismatch: " + normalized.path);
  }
}

function assertSortedUnique(values: string[], label: string): void {
  const sorted = [...new Set(values)].sort();
  if (canonical(values) !== canonical(sorted)) throw new AcceptanceInputError(label + " must be sorted and unique");
}

function assertCandidateAuditRecordConsistency(audit: CandidateAuditLike, target?: TargetManifest["acceptance"]): void {
  assertSortedUnique(audit.requiredActionIds, "candidate audit requiredActionIds");
  assertSortedUnique(audit.observedActionIds, "candidate audit observedActionIds");
  assertSortedUnique(audit.debtActionIds, "candidate audit debtActionIds");
  assertSortedUnique(audit.violations, "candidate audit violations");
  if (audit.eligible !== (audit.violations.length === 0)) {
    throw new AcceptanceInputError("candidate audit eligibility is inconsistent with violations");
  }
  if (target) {
    const p0 = [...new Set(target.p0ActionIds)].sort();
    const p1 = [...new Set(target.p1ActionIds)].sort();
    if (p0.some(actionId => p1.includes(actionId))) throw new AcceptanceInputError("target acceptance action IDs overlap");
    const required = [...new Set([...p0, ...p1])].sort();
    if (canonical(audit.requiredActionIds) !== canonical(required)) throw new AcceptanceInputError("candidate audit requiredActionIds do not match target manifest");
  }
}

export function assertCandidateAuditInvariants(audit: CandidateAuditLike, target?: TargetManifest["acceptance"]): void {
  assertCandidateAuditRecordConsistency(audit, target);
  if (!audit.eligible || audit.coverageDebtCount !== 0 || audit.unclassifiedControls !== 0 || audit.violations.length !== 0 || audit.debtActionIds.length !== 0) {
    throw new AcceptanceInputError("candidate audit is not eligible");
  }
  if (audit.observedControls !== audit.classifiedControls || audit.classifiedControls !== audit.candidateCount + audit.coverageDebtCount) {
    throw new AcceptanceInputError("candidate audit control counts are inconsistent");
  }
  if (Object.keys(audit.debtByReason).length !== 0) throw new AcceptanceInputError("candidate audit debt summary is inconsistent");
  const observed = new Set(audit.observedActionIds);
  if (audit.requiredActionIds.some(actionId => !observed.has(actionId))) throw new AcceptanceInputError("candidate audit omits a required observed action");
}

export function assertSecurityAuditInvariants(audit: SecurityAuditLike): void {
  assertSortedUnique(audit.permitReceiptRefs, "security audit permitReceiptRefs");
  assertSortedUnique(audit.violations, "security audit violations");
  if (audit.policyEvaluationCount !== audit.allowedPolicyCount + audit.deniedPolicyCount) throw new AcceptanceInputError("security audit policy counts are inconsistent");
  if (audit.startedRequestCount !== audit.permitReceiptRefs.length) throw new AcceptanceInputError("security audit request counter is inconsistent with permit receipts");
  if (audit.cleanupFailures > audit.cleanupAttempts) throw new AcceptanceInputError("security audit cleanup counts are inconsistent");
  const violations = [...audit.violations];
  if (audit.policyEvaluationCount < 1) violations.push("policy_evaluation_missing");
  if (audit.killSwitchChecks < 1) violations.push("kill_switch_check_missing");
  if (audit.cleanupFailures > 0) violations.push("cleanup_failed");
  if (audit.acceptanceMode === "deny-all") {
    if (audit.allowedPolicyCount !== 0 || audit.startedRequestCount !== 0 || audit.cleanupAttempts !== 0) violations.push("deny_all_started_request");
  } else if (audit.allowedPolicyCount < 1 || audit.startedRequestCount < 1 || audit.cleanupAttempts < 1) {
    violations.push("authorized_execution_evidence_missing");
  }
  const normalized = [...new Set(violations)].sort();
  if (canonical(normalized) !== canonical(audit.violations) || audit.eligible !== (normalized.length === 0)) {
    throw new AcceptanceInputError("security audit eligibility is inconsistent with evidence");
  }
}

export function assertAcceptanceReportSemantics(report: {
  revision: string;
  configDigest: string;
  corpus: { targetRevision: string; caseConfigDigest: string };
  expected: { outcome: string };
  actual: { outcome: string; exitCode: number };
  oracleResultRefs: ArtifactReferenceLike[];
  artifactRefs?: ArtifactReferenceLike[];
  hateArtifactRefs?: ArtifactReferenceLike[];
  candidateAudit?: CandidateAuditLike;
  securityAudit?: SecurityAuditLike;
  verdict: string;
  environment?: { origin?: string };
}, options: {
  targetAcceptance?: TargetManifest["acceptance"];
  targetOrigin?: string | null;
  requireCandidateAudit?: boolean;
  requireEligibleHandoff?: boolean;
  requireSecurityAudit?: boolean;
} = {}): void {
  if (report.revision !== report.corpus.targetRevision) throw new AcceptanceInputError("report revision does not match corpus binding");
  if (report.configDigest !== report.corpus.caseConfigDigest) throw new AcceptanceInputError("report config digest does not match corpus binding");
  const requireEligibleHandoff = options.requireEligibleHandoff ?? true;
  const outcomeMatches = report.expected.outcome === report.actual.outcome;
  const candidateAuditEligible = report.candidateAudit ? report.candidateAudit.eligible : !options.requireCandidateAudit;
  const securityAuditEligible = report.securityAudit ? report.securityAudit.eligible : !options.requireSecurityAudit;
  const auditEligible = candidateAuditEligible && securityAuditEligible;
  const expectedVerdict = outcomeMatches && auditEligible ? "passed" : "failed";
  if (requireEligibleHandoff) {
    if (report.verdict !== "passed" || expectedVerdict !== "passed") throw new AcceptanceInputError("report outcome is not eligible for external handoff");
  } else if (report.verdict !== expectedVerdict) {
    throw new AcceptanceInputError("report verdict is inconsistent with outcome and candidate audit");
  }
  const expectedExitCode = report.actual.outcome === "passed" ? 0 : report.actual.outcome === "error" ? 1 : 2;
  if (report.actual.exitCode !== expectedExitCode) throw new AcceptanceInputError("report exit code does not match actual outcome");
  if (report.oracleResultRefs.length !== 1) throw new AcceptanceInputError("report requires exactly one OracleResult reference");
  const oracle = normalizeArtifactRef(report.oracleResultRefs[0], "OracleResult reference");
  if (oracle.path !== "adaptive/oracle-results.jsonl") throw new AcceptanceInputError("OracleResult reference path is invalid");
  const evidenceRefs = report.artifactRefs ?? report.hateArtifactRefs ?? [];
  const matchingOracleRefs = evidenceRefs.map(ref => normalizeArtifactRef(ref, "evidence reference")).filter(ref => ref.path === oracle.path);
  if (matchingOracleRefs.length !== 1 || canonical(matchingOracleRefs[0]) !== canonical(oracle)) {
    throw new AcceptanceInputError("OracleResult reference is inconsistent with evidence references");
  }
  if (options.requireCandidateAudit || report.candidateAudit) {
    if (!report.candidateAudit) throw new AcceptanceInputError("candidate audit is required");
    assertCandidateAuditRecordConsistency(report.candidateAudit, options.targetAcceptance);
    if (requireEligibleHandoff || report.candidateAudit.eligible) {
      assertCandidateAuditInvariants(report.candidateAudit, options.targetAcceptance);
    }
  }
  if (options.requireSecurityAudit || report.securityAudit) {
    if (!report.securityAudit) throw new AcceptanceInputError("security audit is required");
    assertSecurityAuditInvariants(report.securityAudit);
  }
  if (options.targetOrigin !== undefined && report.environment?.origin !== options.targetOrigin) {
    throw new AcceptanceInputError("report origin does not match target manifest");
  }
}
