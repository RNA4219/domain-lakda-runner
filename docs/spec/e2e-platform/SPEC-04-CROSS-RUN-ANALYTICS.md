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

### Imported E2E measurements

`lakda import e2e --result result.json --output-dir runs` imports a completed result. This mainline input subset requires a timezone-qualified ISO `generated_at` and a nonempty `scenario_results` array. Each scenario has `status` (`passed` or `failed`), and may have a nonnegative numeric `duration_ms`. A failed scenario makes the run failed. An optional result-level `status` must agree. The importer writes a new HATE-bound run and prints its `runRef`. Only normalized scenario measurements and layer are retained. Import supplies no replay approvals, execution-mode assertions, target revision, native action history, or binary evidence.

```json
{"generated_at":"2026-11-12T01:39:22Z","layer":"device","scenario_results":[{"status":"passed","duration_ms":63070},{"status":"passed","duration_ms":100000}]}
```

For `lakda/run-metadata/v1` with mode `external-playwright`, `startedAt` records result generation and `endedAt` records ingestion. Trend and report sum the verified metadata's `scenario_results[].duration_ms` across all statuses. Zero is measured. Absent or empty scenario data, any missing, negative, nonnumeric or nonfinite measurement, or a sum above the safe numeric range yields `null`. Only measured totals enter duration count, nearest-rank median and p95 (at least 20 measurements). Native runs keep their recorded elapsed duration.

The reviewed `lakda/trend-index/v1` entry must match the run's browser classification. For imported runs use `external` for device, unknown, mixed or unsupported browser evidence. Use `chromium` only for a browser-layer result with explicit `browser: "chromium"` on every scenario. This is source-reported browser evidence. The importer and both readers apply that rule independently of a top-level browser field, including legacy defaults. Native Chromium runs still use `chromium`, including legacy native records that omit the field. Evidence kind and authorization retain their existing checks.

Older external runs remain read-only. When the verified metadata has no scenario measurements, re-importing the original completed result into a new run is the way to recover measured totals. Imported reports have unknown native action counts and a degraded receipt (exit 2); `report verify` can still verify the resulting bundle. The separate `lakda/external-surface-run/v1` SDK measures live surface coverage and uses its own index and readers.

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

Native run schemas retain the integer seed. Imported summaries allow an unknown seed (`null`), and their report views carry the browser label and scenario measurements used to verify the displayed total. Persisted evidence is immutable.
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
