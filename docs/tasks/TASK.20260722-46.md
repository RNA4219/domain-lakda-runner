---
task_id: TASK.20260722-46
intent_id: INT-LAKDA-MNT-001
status: done
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-45]
---

# Task Seed: Real Acceptance共通core

## Objective

P7/P11で重複していたschema検証、canonical digest、corpus/case preflight、target manifest照合、HATE bytes/hash検証を接続前の共通coreへ集約する。

## Scope

In: `src/acceptance`の共通preflight/digest/HATE verificationと共通契約test。Out: real target接続、既存Acceptance artifactの書換え。

## Requirements

REQ-MNT-ACC-001、REQ-MNT-ACC-002、REQ-MNT-ACC-003、REQ-MNT-ACC-006。AC-MNT-003。

## Plan

1. P7/P11の重複処理と終了codeをcharacterisation testで固定する。
2. 純粋なschema/digest/preflight/HATE検証moduleへ分離する。
3. 接続前fail-closedとexit 0/1/2の契約を共通testで確認する。

## Patch

`src/acceptance`を唯一の共通実装とし、各runnerはtarget接続前に同coreを呼び出す。

## Tests

`tests/adaptive/acceptance-common.spec.ts`でdigest、path境界、missing input、tamper、終了codeを検証する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/acceptance-common.spec.ts`
- `npm run test:contracts`

## Notes

共通coreはbrowser/bridgeを生成せず、QEG verdictも生成しない。

## Evidence

- 対象test: `tests/adaptive/acceptance-common.spec.ts`。
- 対象revision: `74a2a9b47cc106795320323a597dfdf5931cbead`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/acceptance-common.spec.ts`、`npm run test:contracts`。
- 終了code: 対象commandはいずれも`0`。
- Acceptance: [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)。
