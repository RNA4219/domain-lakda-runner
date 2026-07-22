---
task_id: TASK.20260722-48
intent_id: INT-LAKDA-MNT-001
status: reviewing
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-46, TASK.20260722-47]
---

# Task Seed: P11 v2 report・target candidate audit

## Objective

P11新規実行をv2 reportへ移行し、target manifest ID/digest、candidate audit、P0/P1欠落、coverage debt、未分類controlをfail-closedで扱う。

## Scope

In: P11 runner/verifier、v2 schema、target candidate audit、legacy v1読取。Out: 歴史的v1 artifactの変更、未承認targetへの接続。

## Requirements

REQ-MNT-ACC-002、REQ-MNT-ACC-004、REQ-MNT-ACC-005、REQ-MNT-ACC-006。AC-MNT-004。

## Plan

1. target manifestとcandidate集合を接続前に監査する。
2. v2 reportへmanifest identityとaudit結果を保存する。
3. legacy v1読取とHATE tamper negativeを回帰する。

## Patch

P11の新規出力だけをv2とし、既存v1 bytesとreader互換を維持する。

## Tests

`extension-real-acceptance.spec.ts`と`target-candidate-audit.spec.ts`でv2/legacy/tamperを検証する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/extension-real-acceptance.spec.ts tests/adaptive/target-candidate-audit.spec.ts`
- `npm run test:contracts`

## Notes

未追跡RC5文書と既存Acceptance/QEG artifactは変更しない。

## Evidence

- 対象test: `tests/adaptive/extension-real-acceptance.spec.ts`、`tests/adaptive/target-candidate-audit.spec.ts`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/extension-real-acceptance.spec.ts tests/adaptive/target-candidate-audit.spec.ts`、`npm run test:contracts`。
- 状態: 統合Gate記録待ち。
