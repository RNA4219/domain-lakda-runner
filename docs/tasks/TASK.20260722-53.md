---
task_id: TASK.20260722-53
intent_id: INT-LAKDA-MNT-001
status: done
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P2
depends_on: [TASK.20260722-52]
---

# Task Seed: Combination責務分割

## Objective

Combination生成、model正規化、coverage計算、serializationを責務別moduleへ分割し、suite bytesとgeneratorVersion互換を維持する。

## Scope

In: `src/adaptive/combinations`内部module、既存facade、determinism test。Out: factor modelやIPOG契約の変更。

## Requirements

REQ-MNT-MOD-003、REQ-MNT-MOD-004。AC-MNT-009。

## Plan

1. 既存suite/action bytesをgolden characterisationとして固定する。
2. normalize/generate/coverage/serializeを分割する。
3. seed、tuple coverage、schemaを回帰する。

## Patch

既存`combinations.ts`を互換facadeとして残す。

## Tests

`tests/adaptive/combinations.spec.ts`でseed determinismとsuite互換を検証する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/combinations.spec.ts`
- `npm run test:contracts`

## Notes

generatorVersion変更が必要な契約変更は別Taskへ分離する。

## Evidence

- 対象test: `tests/adaptive/combinations.spec.ts`。
- 対象revision: `74a2a9b47cc106795320323a597dfdf5931cbead`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/combinations.spec.ts`、`npm run test:contracts`。
- 終了code: 対象commandはいずれも`0`。
- Acceptance: [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)。
