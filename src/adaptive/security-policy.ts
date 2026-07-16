import type { MutationKind } from "./contracts.js";

export type AuthorizationRecord = {
  authorizationId: string; owner: string; targets: { hosts: string[]; pathPrefixes?: string[] };
  environment: "local" | "staging" | "production"; validFrom: string; validUntil: string;
  allowedMutationKinds: MutationKind[]; maxRatePerMinute: number; maxConcurrency: number;
  cleanupRef: string; killSwitchRef: string; approvalEvidenceRef: string;
};
export type SecurityAuthorizationDecision = { allowed: true } | { allowed: false; reason: string };

const active = new Set<MutationKind>(["parameter-mutation", "skip", "reorder", "double-execution", "race", "update", "delete", "purchase", "publish", "external-message", "credential-change", "unknown"]);

function withinPathPrefixes(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => {
    const normalized = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return normalized === "/" || pathname === normalized || pathname.startsWith(`${normalized}/`);
  });
}

export function evaluateSecurityAuthorization(record: AuthorizationRecord | undefined, input: { now: Date; target: URL; environment: AuthorizationRecord["environment"]; mutationKind: MutationKind; activeRequests: number; recentRequests: number }): SecurityAuthorizationDecision {
  if (!record) return { allowed: false, reason: "authorization_missing" };
  if (!record.authorizationId || !record.owner || !record.cleanupRef || !record.killSwitchRef || !record.approvalEvidenceRef || !record.targets.hosts.length || !Number.isInteger(record.maxRatePerMinute) || record.maxRatePerMinute < 1 || !Number.isInteger(record.maxConcurrency) || record.maxConcurrency < 1) return { allowed: false, reason: "authorization_incomplete" };
  const validFrom = new Date(record.validFrom); const validUntil = new Date(record.validUntil);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validFrom > validUntil) return { allowed: false, reason: "authorization_invalid" };
  if (record.environment !== input.environment) return { allowed: false, reason: "environment_mismatch" };
  if (input.now < validFrom || input.now > validUntil) return { allowed: false, reason: "authorization_expired" };
  if (!record.targets.hosts.includes(input.target.hostname) || (record.targets.pathPrefixes?.length && !withinPathPrefixes(input.target.pathname, record.targets.pathPrefixes))) return { allowed: false, reason: "scope_denied" };
  if (input.activeRequests >= record.maxConcurrency || input.recentRequests >= record.maxRatePerMinute) return { allowed: false, reason: "security_budget" };
  if (active.has(input.mutationKind) && (input.environment === "production" || !record.allowedMutationKinds.includes(input.mutationKind))) return { allowed: false, reason: input.environment === "production" ? "production_passive_only" : "mutation_denied" };
  return { allowed: true };
}
