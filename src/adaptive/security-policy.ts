import { createHash } from "node:crypto";

import type { MutationKind } from "./contracts.js";

export type AuthorizationRecord = {
  schemaVersion: "lakda/security-authorization/v2";
  authorizationId: string; owner: string;
  targets: {
    hosts: string[];
    pathPrefixes: string[];
    methods: string[];
    requestTemplateDigests: string[];
    targetRevision: string;
  };
  environment: "local" | "staging" | "production"; validFrom: string; validUntil: string;
  allowedMutationKinds: MutationKind[]; maxRatePerMinute: number; maxConcurrency: number;
  cleanupRef: string; killSwitchRef: string; approvalEvidenceRef: string;
  dataPolicyRef: string; stopContactRef: string;
  binding: { securityProfileDigest: string; capabilityDigest: string; bridgeDigest: string };
  signature: { algorithm: "ed25519"; signedPayloadDigest: string; signatureRef: string };
};
export type SecurityAuthorizationDecision = { allowed: true } | { allowed: false; reason: string };

const active = new Set<MutationKind>(["parameter-mutation", "skip", "reorder", "double-execution", "race", "update", "delete", "purchase", "publish", "external-message", "credential-change", "unknown"]);
const sha256 = /^sha256:[0-9a-f]{64}$/;
const methodPattern = /^[A-Z]+$/;

function withinPathPrefixes(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => {
    const normalized = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return normalized === "/" || pathname === normalized || pathname.startsWith(`${normalized}/`);
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function securityBindingDigest(value: unknown): string {
  return "sha256:" + createHash("sha256").update(canonical(value)).digest("hex");
}

export function securityPermitReceiptRef(record: AuthorizationRecord, input: { target: URL; method: string; requestTemplateDigest: string; mutationKind: MutationKind; requestOrdinal: number }): string {
  return securityBindingDigest({
    authorizationId: record.authorizationId,
    targetRevision: record.targets.targetRevision,
    target: `${input.target.origin}${input.target.pathname}`,
    method: input.method,
    requestTemplateDigest: input.requestTemplateDigest,
    mutationKind: input.mutationKind,
    requestOrdinal: input.requestOrdinal,
    binding: record.binding,
  });
}

export function evaluateSecurityAuthorization(record: AuthorizationRecord | undefined, input: {
  now: Date;
  target: URL;
  environment: AuthorizationRecord["environment"];
  mutationKind: MutationKind;
  method: string;
  requestTemplateDigest: string;
  activeRequests: number;
  recentRequests: number;
  capabilityDigest?: string;
  bridgeDigest?: string;
}): SecurityAuthorizationDecision {
  if (!record) return { allowed: false, reason: "authorization_missing" };
  if (record.schemaVersion !== "lakda/security-authorization/v2" || !record.authorizationId || !record.owner || !record.cleanupRef || !record.killSwitchRef || !record.approvalEvidenceRef || !record.dataPolicyRef || !record.stopContactRef || !record.targets.hosts.length || !record.targets.pathPrefixes.length || !record.targets.methods.length || !record.targets.requestTemplateDigests.length || !record.targets.targetRevision || !Number.isInteger(record.maxRatePerMinute) || record.maxRatePerMinute < 1 || !Number.isInteger(record.maxConcurrency) || record.maxConcurrency < 1 || !sha256.test(record.binding.securityProfileDigest) || !sha256.test(record.binding.capabilityDigest) || !sha256.test(record.binding.bridgeDigest) || record.signature.algorithm !== "ed25519" || !sha256.test(record.signature.signedPayloadDigest) || !record.signature.signatureRef) return { allowed: false, reason: "authorization_incomplete" };
  const validFrom = new Date(record.validFrom); const validUntil = new Date(record.validUntil);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validFrom > validUntil) return { allowed: false, reason: "authorization_invalid" };
  if (record.environment !== input.environment) return { allowed: false, reason: "environment_mismatch" };
  if (input.now < validFrom || input.now > validUntil) return { allowed: false, reason: "authorization_expired" };
  if (!record.targets.hosts.includes(input.target.hostname) || !withinPathPrefixes(input.target.pathname, record.targets.pathPrefixes)) return { allowed: false, reason: "scope_denied" };
  if (!methodPattern.test(input.method) || !record.targets.methods.includes(input.method)) return { allowed: false, reason: "method_denied" };
  if (!sha256.test(input.requestTemplateDigest) || !record.targets.requestTemplateDigests.includes(input.requestTemplateDigest)) return { allowed: false, reason: "request_template_denied" };
  if (input.capabilityDigest !== undefined && input.capabilityDigest !== record.binding.capabilityDigest) return { allowed: false, reason: "capability_binding_mismatch" };
  if (input.bridgeDigest !== undefined && input.bridgeDigest !== record.binding.bridgeDigest) return { allowed: false, reason: "bridge_binding_mismatch" };
  if (input.activeRequests >= record.maxConcurrency || input.recentRequests >= record.maxRatePerMinute) return { allowed: false, reason: "security_budget" };
  if (active.has(input.mutationKind) && (input.environment === "production" || !record.allowedMutationKinds.includes(input.mutationKind))) return { allowed: false, reason: input.environment === "production" ? "production_passive_only" : "mutation_denied" };
  return { allowed: true };
}
