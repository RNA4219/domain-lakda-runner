---
task_id: TASK.20260715-39
intent_id: INT-LAKDA-EXT-004
status: completed
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: loopback scout・report・strict replay investigate

| 項目 | 値 |
|---|---|
| phase | P9 |
| primary spec | [Lakda拡張要件定義書](../spec/Lakda拡張要件定義書.md) |
| linked checklist | [Checklist-02](../spec/lakda-extension/CHECKLIST-02-SCOUTING.md)、[Checklist-03](../spec/lakda-extension/CHECKLIST-03-INVESTIGATION-EVIDENCE.md) |
| acceptance | AC-LX-007〜009、013 |

## Objective

strict JSONかつloopback限定のLLM scout、lead report、replay一回固定のinvestigateを追加する。LLM失敗時に暗黙provider切替をしない。

## Evidence

- src/core/llm.ts、src/adaptive/scouting.ts、src/adaptive/investigation.ts、src/cli.ts
- schemas/lakda-llm-scout-context-v1.schema.json、lakda-llm-scout-response-v1.schema.json、lakda-investigation-v1.schema.json
- tests/adaptive/extensions.spec.ts、tests/cli.spec.ts
