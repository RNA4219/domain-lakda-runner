---
task_id: TASK.20260715-38
intent_id: INT-LAKDA-EXT-003
status: completed
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: rule-first Signal・stable ID・Lead grouping

| 項目 | 値 |
|---|---|
| phase | P9 |
| primary spec | [Lakda拡張要件定義書](../spec/Lakda拡張要件定義書.md) |
| linked checklist | [Checklist-02](../spec/lakda-extension/CHECKLIST-02-SCOUTING.md) |
| acceptance | AC-LX-006 |

## Objective

trace/oracle/timeout/topology/coverage/safety拒否を根拠付きSignalへ変換し、stable ID/dedupeとLead cap 3のrule-only groupingを実装する。

## Evidence

- src/adaptive/scouting.ts
- schemas/lakda-exploration-signal-v1.schema.json、lakda-exploration-lead-v1.schema.json
- tests/adaptive/extensions.spec.ts
