---
task_id: TASK.20260722-51
intent_id: INT-LAKDA-MNT-001
status: reviewing
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P2
depends_on: [TASK.20260722-50]
---

# Task Seed: Playwright Adapter責務分割

## Objective

Playwright Adapterを観測、candidate抽出、topology、実行、recoveryへ分割し、公開facadeと安全既定値を維持する。

## Scope

In: `src/adapters/playwright`分割、既存facade、characterisation test。Out: adapter契約や操作policyの変更。

## Requirements

REQ-MNT-MOD-001、REQ-MNT-MOD-004。AC-MNT-009。

## Plan

1. 現行公開exportと安全挙動をcharacterisation testで固定する。
2. 責務別moduleへ移動し既存fileをfacadeにする。
3. DOM/topology/recovery回帰を確認する。

## Patch

移動と契約変更を同時に行わず、既存import pathを保持する。

## Tests

`tests/adaptive/playwright-adapter.spec.ts`で観測、候補、安全実行、recoveryを回帰する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/playwright-adapter.spec.ts`
- `npm run typecheck`

## Notes

real browser未設定でもfixture characterisationを本証跡と誤認しない。

## Evidence

- 対象test: `tests/adaptive/playwright-adapter.spec.ts`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/playwright-adapter.spec.ts`、`npm run typecheck`。
- 状態: 統合Gate記録待ち。
