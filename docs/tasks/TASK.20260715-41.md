---
task_id: TASK.20260715-41
intent_id: INT-LAKDA-EXT-006
status: completed
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: shrinking・Artifact Store/HATE・KPI

| 項目 | 値 |
|---|---|
| phase | P10 |
| primary spec | [Lakda拡張要件定義書](../spec/Lakda拡張要件定義書.md) |
| linked checklist | [Checklist-03](../spec/lakda-extension/CHECKLIST-03-INVESTIGATION-EVIDENCE.md) |
| acceptance | AC-LX-011〜012 |

## Objective

case/sequence/input縮約のSafety・scope・budget・kill switch、redaction/scan/digest/HATE経路、revision付きKPIを固定する。

## Evidence

- src/adaptive/investigation.ts
- schemas/lakda-kpi-v1.schema.json
- tests/adaptive/extensions.spec.ts
- 既存Artifact Store/HATE export経路を再利用
