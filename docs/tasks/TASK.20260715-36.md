---
task_id: TASK.20260715-36
intent_id: INT-LAKDA-EXT-001
status: completed
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: factor model・select option・constraint

| 項目 | 値 |
|---|---|
| phase | P8 |
| primary spec | [Lakda拡張要件定義書](../spec/Lakda拡張要件定義書.md) |
| linked checklist | [Checklist-01](../spec/lakda-extension/CHECKLIST-01-COMBINATION.md) |
| acceptance | AC-LX-001〜003 |

## Objective

CombinationFactorModel、constraint DSL、visible/enabled select option抽出を追加し、raw secret/PIIとdisabled/hidden値をfactorへ入れない。

## Evidence

- src/adaptive/combinations.ts
- src/adapters/playwright.ts
- schemas/lakda-combination-factor-model-v1.schema.json
- tests/adaptive/combinations.spec.ts、tests/adaptive/playwright-adapter.spec.ts
- typecheck、対象8件pass

## Boundary

fixture/mockは実環境受入を完了扱いにしない。既存mode/config/traceは変更しない。
