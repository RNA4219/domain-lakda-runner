---
task_id: TASK.20260715-37
intent_id: INT-LAKDA-EXT-002
status: completed
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: pairwise・mixed-strength・独立verify・combo CLI

| 項目 | 値 |
|---|---|
| phase | P8 |
| primary spec | [Lakda拡張要件定義書](../spec/Lakda拡張要件定義書.md) |
| linked checklist | [Checklist-01](../spec/lakda-extension/CHECKLIST-01-COMBINATION.md) |
| acceptance | AC-LX-001〜005、013 |

## Objective

seed付き決定的suite生成、指定groupだけのmixed-strength、独立coverage verifier、case resolver、combo gen/verifyを提供する。

## Evidence

- src/adaptive/combinations.ts
- src/cli.ts
- schemas/lakda-combination-case-v1.schema.json、lakda-combination-suite-v1.schema.json
- tests/adaptive/combinations.spec.ts、tests/cli.spec.ts
- typecheck/build/target tests pass

## Boundary

case budget超過、未知factor/value、duplicate case、coverage欠落は非0で終了する。
