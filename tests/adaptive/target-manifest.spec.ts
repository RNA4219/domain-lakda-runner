import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type AjvInstance = { compile(schema: object): Validator };
type AjvConstructor = new (options: object) => AjvInstance;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
const schema = readJson("schemas/lakda-target-manifest-v1.schema.json");
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
