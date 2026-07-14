import { expect, test } from "@playwright/test";
import { assertAdaptiveContract, type Observation } from "../../src/adaptive/contracts.js";
import { canonicalizeObservation, fingerprintObservation } from "../../src/adaptive/fingerprint.js";

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1",
    observationId: "obs-1",
    observedAt: "2026-07-14T00:00:00.000Z",
    targetRef: { targetId: "page-1", kind: "page", origin: "http://127.0.0.1" },
    completeness: "complete",
    url: "http://127.0.0.1/search?b=2&a=1#ignored",
    ui: { primary: [{ role: "button", name: "Search" }], title: "Search" },
    forms: [{ id: "search", fields: [{ name: "q", type: "search" }] }],
    dialogs: [],
    topology: { activeTargetId: "page-1", targetKinds: ["page"] },
    networkSummary: [{ method: "GET", status: 200, timestamp: "volatile" }],
    obligations: { "AC-AE-101": "met" },
    provenance: { adapterId: "playwright", runtime: "chromium", capabilityRevision: "1" },
    ...overrides,
  };
}

test("fingerprint is stable across volatile observation metadata", () => {
  const first = observation();
  const second = observation({
    observationId: "obs-2",
    observedAt: "2026-07-14T00:01:00.000Z",
    networkSummary: [{ method: "GET", status: 200, timestamp: "other-volatile" }],
  });

  expect(canonicalizeObservation(first)).toBe(canonicalizeObservation(second));
  const fingerprints = Array.from({ length: 300 }, () => fingerprintObservation(second));
  expect(new Set(fingerprints.map((entry) => entry.value)).size).toBe(1);
  expect(fingerprintObservation(first).value).toBe(fingerprintObservation(second).value);
  expect(() => assertAdaptiveContract(fingerprintObservation(first))).not.toThrow();
});

test("fingerprint changes for a material URL or primary UI change", () => {
  const source = observation();
  expect(fingerprintObservation(source).value).not.toBe(fingerprintObservation(observation({ url: "http://127.0.0.1/detail?id=1" })).value);
  expect(fingerprintObservation(source).value).not.toBe(fingerprintObservation(observation({ ui: { primary: [{ role: "button", name: "Buy" }] } })).value);
});
