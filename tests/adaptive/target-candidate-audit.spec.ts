import { expect, test } from "@playwright/test";
import { auditTargetCandidateCoverage } from "../../src/adaptive/target-candidate-audit.js";

test("target candidate audit accepts complete classification and required actions", () => {
  const audit = auditTargetCandidateCoverage([
    {
      candidates: [
        { mutationClassification: { actionId: "view-record" } },
        { mutationClassification: { actionId: "save-draft" } },
      ],
      coverageDebt: [{ reason: "missing-accessible-name" }],
      classification: { observedControls: 3, classifiedControls: 3, unclassifiedControls: 0 },
    },
  ], { p0ActionIds: ["view-record"], p1ActionIds: ["save-draft"] });

  expect(audit).toMatchObject({
    schemaVersion: "lakda/target-candidate-audit/v1",
    eligible: true,
    observedControls: 3,
    classifiedControls: 3,
    unclassifiedControls: 0,
    debtByReason: { "missing-accessible-name": 1 },
    violations: [],
  });
});

test("target candidate audit fails closed for incomplete classification and required debt", () => {
  const audit = auditTargetCandidateCoverage([
    {
      candidates: [{ mutationClassification: { actionId: "view-record" } }],
      coverageDebt: [{ actionId: "save-draft", reason: "ambiguous-locator" }],
      classification: { observedControls: 3, classifiedControls: 2, unclassifiedControls: 1 },
    },
  ], { p0ActionIds: ["save-draft"], p1ActionIds: ["publish-record"] });

  expect(audit.eligible).toBe(false);
  expect(audit.violations).toEqual(expect.arrayContaining([
    "candidate_classification_incomplete:0",
    "required_action_coverage_debt:save-draft",
    "required_action_not_observed:publish-record",
  ]));
});

test("target candidate audit fails closed when the required snapshot metrics are absent", () => {
  const audit = auditTargetCandidateCoverage([], { p0ActionIds: ["view-record"], p1ActionIds: [] });
  expect(audit.eligible).toBe(false);
  expect(audit.violations).toEqual(expect.arrayContaining(["candidate_snapshots_missing", "required_action_not_observed:view-record"]));
});