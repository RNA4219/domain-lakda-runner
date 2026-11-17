---
document_id: LAKDA-E2E-SPEC-03
status: review-ready
version: 0.1.0-draft
last_updated: 2026-11-17
requirements: ../../../REQUIREMENTS-E2E-PLATFORM.md
checklist: CHECKLIST-03-LINUX-BROWSER-RELEASE.md
---

# SPEC-03-LINUX-BROWSER-RELEASE.md: Linux Chromium and release readiness

## Objective

Linux CI and package smoke; stable publication pending.

## Primary owner IDs

REQ-E2E-03 / priority P0 / P1

## Public I/O

Linux CI and package smoke; stable publication pending.

## Contract

A dedicated Ubuntu 24.04 job checks docs, typecheck, lint, build, actual Chromium test suite and isolated package consumer. Firefox/WebKit remain unsupported. Stable public release is deferred pending validation and author signoff.

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

- AC-03-01: Positive and negative contract tests pass.
- AC-03-02: Existing data and schema remain compatible.
- AC-03-03: Actual caller/target verification is attached before real acceptance.

## Author decisions / pending

- Production source approval and external target acceptance still needed.
- Stable tag, Linux architecture scope, and Firefox/WebKit support are not promised.
- Strict no-external-process interpretation conflicts with existing chromium.launch,
  so no new browser spawning mechanism is introduced.

## Non-goals

K-01..K-07 are not duplicated. No automatic scheduled run, notification,
Gate verdict, or fixture-to-real promotion.
