---
task_id: TASK.20260722-47
intent_id: INT-LAKDA-MNT-001
status: done
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-46]
---

# Task Seed: P7 real acceptance共通core移行

## Objective

P7 runner/verifierを共通acceptance coreへ移行し、既存report互換、pending_external、HATE bytes/hash再検証を維持する。

## Scope

In: adaptive P7 runner/verifier、P7 schema互換、preflight negative。Out: 実browser実行、既存P7 Acceptance記録の再生成。

## Requirements

REQ-MNT-ACC-001、REQ-MNT-ACC-002、REQ-MNT-ACC-003、REQ-MNT-ACC-005、REQ-MNT-ACC-006。AC-MNT-003、AC-MNT-004。

## Plan

1. P7固有入力を共通preflightへ正規化する。
2. 接続前pending_externalとexit code 2を固定する。
3. 既存report readerと最終HATE bytes/hash検証を回帰する。

## Patch

P7 wrapperのCLI/env互換を維持し、検証処理だけを共通coreへ委譲する。

## Tests

`tests/adaptive/real-acceptance-runner.spec.ts`と`real-acceptance-contracts.spec.ts`で移行前後の互換性を確認する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/real-acceptance-runner.spec.ts tests/adaptive/real-acceptance-contracts.spec.ts`
- `npm run acceptance:adaptive`

## Notes

実環境未設定時のP7は`pending_external`のままとし、fixtureを本証跡へ昇格しない。

## Evidence

- 対象test: `tests/adaptive/real-acceptance-runner.spec.ts`、`tests/adaptive/real-acceptance-contracts.spec.ts`。
- 対象revision: `74a2a9b47cc106795320323a597dfdf5931cbead`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/real-acceptance-runner.spec.ts tests/adaptive/real-acceptance-contracts.spec.ts`、`npm run acceptance:adaptive`。
- 終了code: 対象commandはいずれも`0`。
- Acceptance: [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)。
