---
document_id: LAKDA-CHK-MNT-005
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
specification: SPEC-05-MODULE-BOUNDARIES-EXAMPLES.md
---

# CHECKLIST-05 Module Boundaries / Examples

対応仕様: [SPEC-05](SPEC-05-MODULE-BOUNDARIES-EXAMPLES.md)

## A. 仕様完成チェック

- [x] CHK-MNT-005-S-001 — 分割責務、互換facade、sanitized example境界が定義されている。
- [x] CHK-MNT-005-S-002 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [ ] | CHK-MNT-005-I-001 | REQ-MNT-MOD-001 | Playwright boundary test | 未取得 |
| [ ] | CHK-MNT-005-I-002 | REQ-MNT-MOD-002 | coordinator characterisation | 未取得 |
| [ ] | CHK-MNT-005-I-003 | REQ-MNT-MOD-003 | combination/CLI facade test | 未取得 |
| [ ] | CHK-MNT-005-I-004 | REQ-MNT-MOD-004 | public contract regression | 未取得 |
| [ ] | CHK-MNT-005-I-005 | REQ-MNT-MOD-005 | example schema test | 未取得 |
| [ ] | CHK-MNT-005-I-006 | REQ-MNT-MOD-006 | secret/PII/package scan | 未取得 |

## C. 受入Gate

- [ ] CHK-MNT-005-A-001 — AC-MNT-009で公開契約とdeterministic出力の同等性を確認した。
- [ ] CHK-MNT-005-A-002 — AC-MNT-010でexample/schema/package/security検査を確認した。
- [ ] CHK-MNT-005-A-003 — exampleにreal-ready target、credential、storageStateが0件である。
