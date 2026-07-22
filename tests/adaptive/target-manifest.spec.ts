import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { assertSecurityTargetManifestSignature, digest, targetManifestSigningPayload, type TargetManifest } from "../../src/acceptance/common.js";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type AjvInstance = { compile(schema: object): Validator };
type AjvConstructor = new (options: object) => AjvInstance;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
const schema = readJson("schemas/lakda-target-manifest-v1.schema.json");
const securitySchema = readJson("schemas/lakda-target-manifest-v2.schema.json");
const manifests = [
  "docs/targets/saas-crm.pending-external.json",
  "docs/targets/saas-commerce.pending-external.json",
  "docs/targets/saas-collaboration.pending-external.json",
].map(readJson);

test("three SaaS target manifests remain pending external without connection data", () => {
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  expect(manifests.map(manifest => manifest.targetClass).sort()).toEqual(["collaboration-workspace", "commerce-card", "crm-list"]);
  for (const manifest of manifests) {
    expect(validate(manifest)).toBe(true);
    expect(manifest).toMatchObject({ status: "pending_external", environment: { baseUrlOrigin: null }, access: { approved: false, authSource: "pending_external" }, scope: { allowHosts: [] } });
  }
});

test("a ready target manifest fails closed until its real approval, scope, and acceptance controls are supplied", () => {
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  const incompleteReady = { ...manifests[0], status: "ready" };
  expect(validate(incompleteReady)).toBe(false);
  const ready = {
    ...manifests[0], status: "ready", owner: "owner@example.test",
    binding: { targetRevision: "revision-1", configDigest: "sha256:" + "0".repeat(64) },
    environment: { name: "staging", baseUrlOrigin: "https://staging.example.test" },
    access: { approved: true, authSource: "github-environment", approvalEvidenceRef: "approval-ref" },
    scope: { allowHosts: ["staging.example.test"], pathPrefixes: ["/app"] },
    safety: { allowMutationKinds: ["none"], resetProcedureRef: "reset-ref", killSwitchRef: "kill-ref" },
    privacy: { piiPolicyRef: "pii-ref", sensitiveValuesPersisted: false },
    actionContracts: [{ actionId: "view-record", mutationKind: "none" }],
    settleProfile: { policyVersion: "consensus/v1", readiness: null, networkQuietExclusions: [] },
    acceptance: { p0ActionIds: ["view-record"], p1ActionIds: [] },
  };
  expect(validate(ready)).toBe(true);
  expect(validate({ ...ready, scope: { ...ready.scope, pathPrefixes: [] } })).toBe(false);
  const manifestApprovedExclusion = { ...ready, settleProfile: { ...ready.settleProfile, networkQuietExclusions: ["/api/poll"] } };
  expect(validate(manifestApprovedExclusion)).toBe(true);
  expect(validate({ ...manifestApprovedExclusion, settleProfile: { ...manifestApprovedExclusion.settleProfile, networkQuietExclusions: ["https://unscoped.example/poll"] } })).toBe(false);
});

test("signed target manifest v2 binds authorization, request scope, profile, and bridge revision", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = {
    ...manifests[0],
    schemaVersion: "lakda/target-manifest/v2",
    manifestId: "security-ready-target",
    targetClass: "security-http",
    status: "ready",
    owner: "owner@example.test",
    binding: { targetRevision: "revision-1", configDigest: "sha256:" + "0".repeat(64) },
    environment: { name: "staging", baseUrlOrigin: "https://staging.example.test" },
    access: { approved: true, authSource: "github-environment", approvalEvidenceRef: "approval-ref" },
    scope: { allowHosts: ["staging.example.test"], pathPrefixes: ["/api"] },
    safety: { allowMutationKinds: ["none", "parameter-mutation"], resetProcedureRef: "reset-ref", killSwitchRef: "kill-ref" },
    privacy: { piiPolicyRef: "pii-ref", sensitiveValuesPersisted: false },
    actionContracts: [{ actionId: "probe-api", mutationKind: "parameter-mutation" }],
    settleProfile: { policyVersion: "consensus/v1", readiness: null, networkQuietExclusions: [] },
    acceptance: { p0ActionIds: ["probe-api"], p1ActionIds: [] },
    security: {
      acceptanceMode: "authorized-active",
      authorization: {
        authorizationId: "authorization-1",
        validFrom: "2026-07-01T00:00:00Z",
        validUntil: "2027-07-01T00:00:00Z",
        approvalEvidenceRef: "approval-ref",
        signatureRef: "signature-1",
        signedPayloadDigest: "sha256:" + "0".repeat(64),
        signature: { algorithm: "ed25519", publicKeyPem, valueBase64: "AA==" },
      },
      requestScope: { methods: ["GET"], requestTemplateDigests: ["sha256:" + "1".repeat(64)] },
      limits: { maxRatePerMinute: 10, maxConcurrency: 1 },
      dataPolicyRef: "data-policy-ref",
      stopContactRef: "stop-contact-ref",
      securityProfile: { ref: "security-profile", digest: "sha256:" + "2".repeat(64) },
      bridgeBinding: { capabilityDigest: "sha256:" + "3".repeat(64), bridgeDigest: "sha256:" + "4".repeat(64) },
    },
  } as unknown as TargetManifest;
  const payload = targetManifestSigningPayload(manifest);
  manifest.security!.authorization.signedPayloadDigest = digest(payload);
  manifest.security!.authorization.signature.valueBase64 = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");

  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(securitySchema);
  expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  expect(() => assertSecurityTargetManifestSignature(manifest, new Date("2026-07-22T00:00:00Z"))).not.toThrow();

  const tampered = structuredClone(manifest);
  tampered.security!.limits.maxConcurrency = 2;
  expect(() => assertSecurityTargetManifestSignature(tampered, new Date("2026-07-22T00:00:00Z"))).toThrow(/digest mismatch/);
});
