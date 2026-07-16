import { expect, test } from "@playwright/test";
import { evaluateSecurityAuthorization, type AuthorizationRecord } from "../../src/adaptive/security-policy.js";

const authorization: AuthorizationRecord = { authorizationId: "auth-1", owner: "security", targets: { hosts: ["127.0.0.1"], pathPrefixes: ["/safe"] }, environment: "staging", validFrom: "2026-07-01T00:00:00Z", validUntil: "2026-08-01T00:00:00Z", allowedMutationKinds: ["parameter-mutation"], maxRatePerMinute: 2, maxConcurrency: 1, cleanupRef: "cleanup-1", killSwitchRef: "kill-1", approvalEvidenceRef: "approval-1" };
const base = { now: new Date("2026-07-15T00:00:00Z"), target: new URL("http://127.0.0.1/safe/items"), environment: "staging" as const, mutationKind: "parameter-mutation" as const, activeRequests: 0, recentRequests: 0 };

test("security authorization is fail-closed for missing, scope, production, and budgets", () => {
  expect(evaluateSecurityAuthorization(undefined, base)).toEqual({ allowed: false, reason: "authorization_missing" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, target: new URL("http://127.0.0.1/outside") })).toEqual({ allowed: false, reason: "scope_denied" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, target: new URL("http://127.0.0.1/safe-other") })).toEqual({ allowed: false, reason: "scope_denied" });
  expect(evaluateSecurityAuthorization({ ...authorization, environment: "production" }, { ...base, environment: "production" })).toEqual({ allowed: false, reason: "production_passive_only" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, activeRequests: 1 })).toEqual({ allowed: false, reason: "security_budget" });
  expect(evaluateSecurityAuthorization(authorization, base)).toEqual({ allowed: true });
});
