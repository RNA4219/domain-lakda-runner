---
task_id: TASK.20260722-57
intent_id: INT-LAKDA-MNT-001
status: reviewing
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P1
depends_on: [TASK.20260722-56]
---

# Task Seed: Sanitized examples・package検証

## Objective

Playwright安全設定、factor model、replay、pending_external target manifestのsanitized exampleを追加し、schema/package/secret・PII検査へ接続する。

## Scope

In: `examples`、package files、example test、install/contents scan。Out: credential、storageState、ready real target、顧客入力。

## Requirements

REQ-MNT-MOD-005、REQ-MNT-MOD-006。AC-MNT-010。

## Plan

1. 4種の最小exampleをschemaへ適合させる。
2. package内容へexamplesを含める。
3. secret/PII/absolute path/ready target negativeを検証する。

## Patch

exampleはplaceholderとpending_externalだけを含み、実接続可能な値を収録しない。

## Tests

`tests/examples.spec.ts`とpackage contents/install testでschema、scan、公開内容を検証する。

## Commands

- `npx playwright test --workers=1 tests/examples.spec.ts`
- `npm run test:examples`
- `npm run pack:check`

## Notes

mock/fixture exampleは補助資料であり、本証跡として数えない。

## Evidence

- 対象test: `tests/examples.spec.ts`、package contents/install test。
- 対象command: `npx playwright test --workers=1 tests/examples.spec.ts`、`npm run test:examples`、`npm run pack:check`。
- 状態: 統合Gate記録待ち。
