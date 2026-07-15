---
document_id: LAKDA-CHK-LX-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
specification: SPEC-01-COMBINATION-TESTING.md
evaluation: EVALUATION-LAKDA-EXTENSION.md
---

# CHECKLIST-01 組み合わせモデル・生成・CLI

対応仕様: [SPEC-01](SPEC-01-COMBINATION-TESTING.md)
要件正本: [Lakda拡張要件定義書](../Lakda拡張要件定義書.md)
評価仕様: [EVALUATION-LAKDA-EXTENSION](EVALUATION-LAKDA-EXTENSION.md)

## A. 仕様完成チェック

- [x] CHK-LX-001-S-001 — COMB/CLIの一次所有要件が全件割り当てられている。
- [x] CHK-LX-001-S-002 — model、suite、verification、case executionの入出力が定義されている。
- [x] CHK-LX-001-S-003 — deterministic、constraint、mixed-strength、fail-closed境界が定義されている。
- [x] CHK-LX-001-S-004 — CLI互換、unknown ref/version、Safety Policy境界が定義されている。
- [x] CHK-LX-001-S-005 — 正常、境界、異常、禁止のシナリオとAC参照がある。
- [x] CHK-LX-001-S-006 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [ ] | CHK-LX-001-I-001 | REQ-LX-COMB-001 | schema/contract test | 未取得 |
| [ ] | CHK-LX-001-I-002 | REQ-LX-COMB-002 | factor kind test | 未取得 |
| [ ] | CHK-LX-001-I-003 | REQ-LX-COMB-003 | Playwright select fixture | 未取得 |
| [ ] | CHK-LX-001-I-004 | REQ-LX-COMB-004 | deterministic generator test | 未取得 |
| [ ] | CHK-LX-001-I-005 | REQ-LX-COMB-005 | constraint negative test | 未取得 |
| [ ] | CHK-LX-001-I-006 | REQ-LX-COMB-006 | independent verifier test | 未取得 |
| [ ] | CHK-LX-001-I-007 | REQ-LX-COMB-007 | mixed-strength scope test | 未取得 |
| [ ] | CHK-LX-001-I-008 | REQ-LX-COMB-008 | promotion reason/diff artifact test | 未取得 |
| [ ] | CHK-LX-001-I-009 | REQ-LX-COMB-009 | case mapping and Safety test | 未取得 |
| [ ] | CHK-LX-001-I-010 | REQ-LX-COMB-010 | LLM mutation denial test | 未取得 |
| [ ] | CHK-LX-001-I-011 | REQ-LX-COMB-011 | case budget test | 未取得 |
| [ ] | CHK-LX-001-I-012 | REQ-LX-CLI-001 | additive CLI contract test | 未取得 |
| [ ] | CHK-LX-001-I-013 | REQ-LX-CLI-002 | config backward compatibility | 未取得 |
| [ ] | CHK-LX-001-I-014 | REQ-LX-CLI-003 | existing mode regression | 未取得 |
| [ ] | CHK-LX-001-I-015 | REQ-LX-CLI-004 | unknown ref/version fail-closed | 未取得 |
| [ ] | CHK-LX-001-I-016 | REQ-LX-CLI-005 | help snapshot test | 未取得 |

対応受入ID: AC-LX-001, AC-LX-002, AC-LX-003, AC-LX-004, AC-LX-005, AC-LX-013
## C. 受入Gate

- [ ] CHK-LX-001-A-001 — AC-LX-001〜002のdeterminism、coverage、constraint、verifier証跡が揃っている。
- [ ] CHK-LX-001-A-002 — AC-LX-003〜005のoption、mixed-strength、Safety、budget証跡が揃っている。
- [ ] CHK-LX-001-A-003 — AC-LX-013で既存CLI/config/trace互換と新CLI helpが確認済み。
- [ ] CHK-LX-001-A-004 — 未検証suite、unknown ref、部分suiteを実行へ渡していない。

証跡欄にはrun ID、artifact相対path、SHA-256、テストrecordのいずれかを記載する。
