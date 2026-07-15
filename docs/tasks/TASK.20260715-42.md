---
task_id: TASK.20260715-42
intent_id: INT-LAKDA-EXT-007
status: pending_external
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: extension case単位real acceptance

| 項目 | 値 |
|---|---|
| phase | P11 |
| primary spec | [Lakda拡張要件定義書](../spec/Lakda拡張要件定義書.md) |
| linked checklist | [Checklist-03](../spec/lakda-extension/CHECKLIST-03-INVESTIGATION-EVIDENCE.md) |
| acceptance | AC-LX-014 |

## Objective

承認済みtargetのcase単位runner/verifierでimmutable corpus、case ID、target revision/config digest、executionMode、OracleResult refs、HATE refsを記録する。

## Implementation

- scripts/run-lakda-extension-real-acceptance.mjs
- scripts/verify-lakda-extension-real-acceptance.mjs
- schemas/lakda-extension-acceptance-corpus-v1.schema.json
- schemas/lakda-extension-acceptance-case-v1.schema.json
- npm run acceptance:extension:real
- npm run acceptance:extension:verify-real

## Evidence and status

未設定環境ではtargetへ接続せず、非0終了かつpending_externalを出力する。fixture/mockはAC-LX-014の完了証跡に数えない。manual-bb/QEGは外部工程で実施し、Lakdaはverdictを生成しない。
