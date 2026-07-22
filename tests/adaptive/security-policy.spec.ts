import { expect, test } from "@playwright/test";
import { evaluateSecurityAuthorization, type AuthorizationRecord } from "../../src/adaptive/security-policy.js";

const templateDigest = "sha256:" + "1".repeat(64);
const authorization: AuthorizationRecord = {
  schemaVersion: "lakda/security-authorization/v2",
  authorizationId: "auth-1",
  owner: "security",
  targets: { hosts: ["127.0.0.1"], pathPrefixes: ["/safe"], methods: ["GET"], requestTemplateDigests: [templateDigest], targetRevision: "revision-1" },
  environment: "staging",
  validFrom: "2026-07-01T00:00:00Z",
  validUntil: "2026-08-01T00:00:00Z",
  allowedMutationKinds: ["parameter-mutation"],
  maxRatePerMinute: 2,
  maxConcurrency: 1,
  cleanupRef: "cleanup-1",
  killSwitchRef: "kill-1",
  approvalEvidenceRef: "approval-1",
  dataPolicyRef: "data-policy-1",
  stopContactRef: "stop-contact-1",
  binding: { securityProfileDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), bridgeDigest: "sha256:" + "4".repeat(64) },
  signature: { algorithm: "ed25519", signedPayloadDigest: "sha256:" + "5".repeat(64), signatureRef: "signature-1" },
};
const base = { now: new Date("2026-07-15T00:00:00Z"), target: new URL("http://127.0.0.1/safe/items"), environment: "staging" as const, mutationKind: "parameter-mutation" as const, method: "GET", requestTemplateDigest: templateDigest, activeRequests: 0, recentRequests: 0 };

test("security authorization is fail-closed for missing, scope, production, and budgets", () => {
  expect(evaluateSecurityAuthorization(undefined, base)).toEqual({ allowed: false, reason: "authorization_missing" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, target: new URL("http://127.0.0.1/outside") })).toEqual({ allowed: false, reason: "scope_denied" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, target: new URL("http://127.0.0.1/safe-other") })).toEqual({ allowed: false, reason: "scope_denied" });
  expect(evaluateSecurityAuthorization({ ...authorization, environment: "production" }, { ...base, environment: "production" })).toEqual({ allowed: false, reason: "production_passive_only" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, method: "POST" })).toEqual({ allowed: false, reason: "method_denied" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, requestTemplateDigest: "sha256:" + "9".repeat(64) })).toEqual({ allowed: false, reason: "request_template_denied" });
  expect(evaluateSecurityAuthorization(authorization, { ...base, activeRequests: 1 })).toEqual({ allowed: false, reason: "security_budget" });
  expect(evaluateSecurityAuthorization(authorization, base)).toEqual({ allowed: true });
});
