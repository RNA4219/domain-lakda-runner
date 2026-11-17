---
document_id: LAKDA-E2E-SPEC-05
status: review-ready
version: 0.1.0-draft
last_updated: 2026-11-17
requirements: ../../../REQUIREMENTS-E2E-PLATFORM.md
checklist: CHECKLIST-05-REUSABLE-WORKFLOW.md
---

# SPEC-05-REUSABLE-WORKFLOW.md: Pinned reusable product workflow

## Objective

Product repository invokes workflow_call at immutable commit SHA.

## Primary owner IDs

REQ-E2E-05 / priority P0

## Public I/O

Product repository invokes workflow_call at immutable commit SHA.

## Contract

A workflow_call accepts case folder, target base URL, GitHub environment and explicit real/isolation assertions. Source and manifest hashes are checked before replay; failure artifacts retained. Runtime checkout is fixed to a SHA, not mutable main.

A human-reviewed source is required before claiming an executed E2E case.
Non-executed, inconclusive, partial, infrastructure errors and missing artifacts
cannot become successful real E2E evidence. No component here issues Gate verdicts.

## Plan

1. Reuse existing validated contracts and preserve old run directories.
2. Keep CI orchestration outside Lakda core; all new outputs are new-only.
3. Add positive and fail-closed negative tests before adoption.
4. Confirm actual Linux CI and independently review real-target evidence.

## Patch

No required fields added to existing schemas. Persisted evidence is immutable.
No new arbitrary code execution, network sender or subprocess logic in Lakda.

## Tests

- Valid inputs and successful deterministic outputs
- Invalid, missing and tampered review/evidence inputs
- Read-only storage, classification and version-boundary checks
- Linux and consumer verification where runtime-dependent

## Commands

- npm run check
- npm run test:contracts
- npm run pack:check

## Acceptance criteria

- AC-05-01: Positive and negative contract tests pass.
- AC-05-02: Existing data and schema remain compatible.
- AC-05-03: Actual caller/target verification is attached before real acceptance.

## Author decisions / pending

- Production source approval and external target acceptance still needed.
- Stable tag, Linux architecture scope, and Firefox/WebKit support are not promised.
- Strict no-external-process interpretation conflicts with existing chromium.launch,
  so no new browser spawning mechanism is introduced.

## Non-goals

K-01..K-07 are not duplicated. No automatic scheduled run, notification,
Gate verdict, or fixture-to-real promotion.
