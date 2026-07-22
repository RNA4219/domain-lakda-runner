import { expect, test } from "@playwright/test";
import { auditTargetCandidateCoverage } from "../../src/adaptive/target-candidate-audit.js";

const classifiedCandidate = (actionId: string, mutationKind = "none", source = "mechanical") => ({
  mutationKind,
  mutationClassification: { actionId, source, ruleId: "test-classification/v1" },
});

test("target candidate audit accepts complete classification and required actions", () => {
  const audit = auditTargetCandidateCoverage([
    {
      candidates: [
        classifiedCandidate("view-record"),
        classifiedCandidate("save-draft"),
      ],
      coverageDebt: [],
      classification: { observedControls: 2, classifiedControls: 2, unclassifiedControls: 0 },
    },
  ], { p0ActionIds: ["view-record"], p1ActionIds: ["save-draft"] });

  expect(audit).toMatchObject({
    schemaVersion: "lakda/target-candidate-audit/v1",
    eligible: true,
    observedControls: 2,
    classifiedControls: 2,
    unclassifiedControls: 0,
    debtByReason: {},
    violations: [],
  });
});

test("target candidate audit rejects any coverage debt even outside required actions", () => {
  const audit = auditTargetCandidateCoverage([{
    candidates: [classifiedCandidate("view-record")],
    coverageDebt: [{ reason: "missing-accessible-name" }],
    classification: { observedControls: 2, classifiedControls: 2, unclassifiedControls: 0 },
  }], { p0ActionIds: ["view-record"], p1ActionIds: [] });
  expect(audit.eligible).toBe(false);
  expect(audit.violations).toContain("candidate_coverage_debt_present");
});
test("target candidate audit fails closed for incomplete classification and required debt", () => {
  const audit = auditTargetCandidateCoverage([
    {
      candidates: [classifiedCandidate("view-record")],
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

test("target candidate audit rejects unknown, conflicting, or missing mutation classification", () => {
  const audit = auditTargetCandidateCoverage([{
    candidates: [classifiedCandidate("view-record", "unknown", "conflict"), { mutationKind: "none" }],
    coverageDebt: [],
    classification: { observedControls: 2, classifiedControls: 2, unclassifiedControls: 0 },
  }], { p0ActionIds: ["view-record"], p1ActionIds: [] });
  expect(audit.eligible).toBe(false);
  expect(audit.violations).toEqual(expect.arrayContaining([
    "candidate_mutation_unclassified:0:0",
    "candidate_mutation_unclassified:0:1",
  ]));
});

test("target candidate audit fails closed when the required snapshot metrics are absent", () => {
  const audit = auditTargetCandidateCoverage([], { p0ActionIds: ["view-record"], p1ActionIds: [] });
  expect(audit.eligible).toBe(false);
  expect(audit.violations).toEqual(expect.arrayContaining(["candidate_snapshots_missing", "required_action_not_observed:view-record"]));
});