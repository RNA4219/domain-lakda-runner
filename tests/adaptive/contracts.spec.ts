import { expect, test } from "@playwright/test";
import { ADAPTIVE_SCHEMA_VERSION, assertAdaptiveContract } from "../../src/adaptive/contracts.js";

const fingerprint = {
  schemaVersion: ADAPTIVE_SCHEMA_VERSION,
  algorithmVersion: "sha256/v1",
  canonicalizationVersion: "canonical/v1",
  value: "state:abc",
  observationDigest: "digest:abc",
  componentSummary: { pathname: "/search", dialog: false },
};

test("adaptive contracts compile and accept a public fingerprint", () => {
  expect(() => assertAdaptiveContract(fingerprint)).not.toThrow();
});

test("adaptive contracts reject an unknown schema version", () => {
  expect(() => assertAdaptiveContract({ ...fingerprint, schemaVersion: "lakda/adaptive-contracts/v2" })).toThrow(/schema|unknown/i);
});

test("adaptive contracts reject secret and adapter object leaks", () => {
  const observation = {
    schemaVersion: ADAPTIVE_SCHEMA_VERSION,
    observationId: "obs-1",
    observedAt: "2026-07-14T00:00:00Z",
    targetRef: { targetId: "page-1", kind: "page" },
    completeness: "complete",
    ui: { primaryElements: [] },
    forms: [],
    dialogs: [],
    topology: { activeTargetId: "page-1", targets: [] },
    obligations: {},
    provenance: { adapterId: "playwright", runtime: "chromium", capabilityRevision: "1" },
  };
  expect(() => assertAdaptiveContract({ ...observation, ui: { password: "not-allowed" } })).toThrow(/sensitive/i);
  expect(() => assertAdaptiveContract({ ...observation, ui: { page: { internal: true } } })).toThrow(/adapter object/i);
});
