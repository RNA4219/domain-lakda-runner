---
document_id: LAKDA-CHK-LX-003
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
specification: SPEC-03-INVESTIGATE-EVIDENCE.md
evaluation: EVALUATION-LAKDA-EXTENSION.md
---

# CHECKLIST-03 investigate・promote・証跡

対応仕様: [SPEC-03](SPEC-03-INVESTIGATE-EVIDENCE.md)
要件正本: [Lakda拡張要件定義書](../Lakda拡張要件定義書.md)
評価仕様: [EVALUATION-LAKDA-EXTENSION](EVALUATION-LAKDA-EXTENSION.md)

## A. 仕様完成チェック

- [x] CHK-LX-003-S-001 — investigate、promote、shrinking、Evidenceの一次所有要件が全件割り当てられている。
- [x] CHK-LX-003-S-002 — strict replay、status、promotion条件、immutable parentが定義されている。
- [x] CHK-LX-003-S-003 — shrinking、安全、redaction、HATE/QEG、real/mock資格が定義されている。
- [x] CHK-LX-003-S-004 — 正常、境界、異常、禁止シナリオとAC参照がある。
- [x] CHK-LX-003-S-005 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [ ] | CHK-LX-003-I-001 | REQ-LX-INV-001 | ref/digest verification | 未取得 |
| [ ] | CHK-LX-003-I-002 | REQ-LX-INV-002 | strict replay divergence test | 未取得 |
| [ ] | CHK-LX-003-I-003 | REQ-LX-INV-003 | investigation status schema | 未取得 |
| [ ] | CHK-LX-003-I-004 | REQ-LX-INV-004 | promotion policy negative | 未取得 |
| [ ] | CHK-LX-003-I-005 | REQ-LX-INV-005 | immutable parent/derived linkage | 未取得 |
| [ ] | CHK-LX-003-I-006 | REQ-LX-INV-006 | three-phase shrink test | 未取得 |
| [ ] | CHK-LX-003-I-007 | REQ-LX-INV-007 | safety/kill switch shrink test | 未取得 |
| [ ] | CHK-LX-003-I-008 | REQ-LX-EVD-001 | artifact store policy test | 未取得 |
| [ ] | CHK-LX-003-I-009 | REQ-LX-EVD-002 | artifact/security failure outcome test | 未取得 |
| [ ] | CHK-LX-003-I-010 | REQ-LX-EVD-003 | HATE manifest validation | 未取得 |
| [ ] | CHK-LX-003-I-011 | REQ-LX-EVD-004 | executionMode qualification test | 未取得 |
| [ ] | CHK-LX-003-I-012 | REQ-LX-EVD-005 | QEG generation negative | 未取得 |
| [ ] | CHK-LX-003-I-013 | REQ-LX-EVD-006 | KPI denominator/revision test | 未取得 |
| [ ] | CHK-LX-003-I-014 | REQ-LX-EVD-007 | raw value redaction/digest test | 未取得 |

対応受入ID: AC-LX-009, AC-LX-010, AC-LX-011, AC-LX-012, AC-LX-014
## C. 受入Gate

- [ ] CHK-LX-003-A-001 — AC-LX-009〜011のreplay、promotion、shrink証跡が揃っている。
- [ ] CHK-LX-003-A-002 — AC-LX-012でredaction、scan、digest、HATE/v1が検証済みである。
- [ ] CHK-LX-003-A-003 — AC-LX-014でreal/mock資格、target revision、config digest、oracle/HATE refsが揃っている。
- [ ] CHK-LX-003-A-004 — LakdaがQEG record/verdict、approval、waiverを生成していない。

証跡欄にはrun ID、artifact相対path、SHA-256、テストrecordのいずれかを記載する。
