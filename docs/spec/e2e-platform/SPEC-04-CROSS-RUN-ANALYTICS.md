---
document_id: LAKDA-E2E-SPEC-04
status: review-ready
version: 0.1.0-draft
last_updated: 2026-11-17
requirements: ../../../REQUIREMENTS-E2E-PLATFORM.md
checklist: CHECKLIST-04-CROSS-RUN-ANALYTICS.md
---

# SPEC-04-CROSS-RUN-ANALYTICS.md: Verified cross-run trends

## Objective

lakda runs trend --index index.json --runs-dir .lakda/runs --out new-report-dir.

## Primary owner IDs

REQ-E2E-04 / priority P1

## Public I/O

lakda runs trend --index index.json --runs-dir .lakda/runs --out new-report-dir.

## Contract

Read-only runs trend command reads a reviewed index, verifies HATE manifest and bytes through existing readers, separates real and fixture/mock/emulator labels, emits JSON and local HTML without modifying source run directories.

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

- AC-04-01: Positive and negative contract tests pass.
- AC-04-02: Existing data and schema remain compatible.
- AC-04-03: Actual caller/target verification is attached before real acceptance.

## Author decisions / pending

- Production source approval and external target acceptance still needed.
- Stable tag, Linux architecture scope, and Firefox/WebKit support are not promised.
- Strict no-external-process interpretation conflicts with existing chromium.launch,
  so no new browser spawning mechanism is introduced.

## Non-goals

K-01..K-07 are not duplicated. No automatic scheduled run, notification,
Gate verdict, or fixture-to-real promotion.
