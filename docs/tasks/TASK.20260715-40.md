---
task_id: TASK.20260715-40
intent_id: INT-LAKDA-EXT-005
status: completed
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: reproduced限定promote・immutable parent

| 項目 | 値 |
|---|---|
| phase | P10 |
| primary spec | [Lakda拡張要件定義書](../spec/Lakda拡張要件定義書.md) |
| linked checklist | [Checklist-03](../spec/lakda-extension/CHECKLIST-03-INVESTIGATION-EVIDENCE.md) |
| acceptance | AC-LX-004、010 |

## Objective

reproduced investigationだけをtrace/suiteへpromoteし、parent investigation digestとartifact refsを派生記録へ固定する。

## Evidence

- src/adaptive/investigation.ts
- schemas/lakda-promotion-v1.schema.json
- tests/adaptive/extensions.spec.ts
