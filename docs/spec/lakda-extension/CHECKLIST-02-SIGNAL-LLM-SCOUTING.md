---
document_id: LAKDA-CHK-LX-002
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
specification: SPEC-02-SIGNAL-LLM-SCOUTING.md
evaluation: EVALUATION-LAKDA-EXTENSION.md
---

# CHECKLIST-02 Signal・LLM scouting

対応仕様: [SPEC-02](SPEC-02-SIGNAL-LLM-SCOUTING.md)
要件正本: [Lakda拡張要件定義書](../Lakda拡張要件定義書.md)
評価仕様: [EVALUATION-LAKDA-EXTENSION](EVALUATION-LAKDA-EXTENSION.md)

## A. 仕様完成チェック

- [x] CHK-LX-002-S-001 — Signal、Lead、LLM context/responseの一次所有要件が全件割り当てられている。
- [x] CHK-LX-002-S-002 — rule-first、ref allowlist、schema reject、degradationの契約が定義されている。
- [x] CHK-LX-002-S-003 — raw prompt/response、secret、PII、selector、confirmed verdictの禁止境界が定義されている。
- [x] CHK-LX-002-S-004 — 正常、境界、異常、禁止シナリオとAC参照がある。
- [x] CHK-LX-002-S-005 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [ ] | CHK-LX-002-I-001 | REQ-LX-SIG-001 | rule registry fixture | 未取得 |
| [ ] | CHK-LX-002-I-002 | REQ-LX-SIG-002 | source ref/digest test | 未取得 |
| [ ] | CHK-LX-002-I-003 | REQ-LX-SIG-003 | stable ID/dedupe test | 未取得 |
| [ ] | CHK-LX-002-I-004 | REQ-LX-SIG-004 | LLM new Signal denial | 未取得 |
| [ ] | CHK-LX-002-I-005 | REQ-LX-SIG-005 | exploratory classification test | 未取得 |
| [ ] | CHK-LX-002-I-006 | REQ-LX-SIG-006 | rule-only fallback test | 未取得 |
| [ ] | CHK-LX-002-I-007 | REQ-LX-LLM-001 | loopback/attestation test | 未取得 |
| [ ] | CHK-LX-002-I-008 | REQ-LX-LLM-002 | context redaction test | 未取得 |
| [ ] | CHK-LX-002-I-009 | REQ-LX-LLM-003 | strict schema negative | 未取得 |
| [ ] | CHK-LX-002-I-010 | REQ-LX-LLM-004 | ref allowlist test | 未取得 |
| [ ] | CHK-LX-002-I-011 | REQ-LX-LLM-005 | forbidden field rejection | 未取得 |
| [ ] | CHK-LX-002-I-012 | REQ-LX-LLM-006 | timeout/provider no-switch test | 未取得 |
| [ ] | CHK-LX-002-I-013 | REQ-LX-LLM-007 | JSONL evidence/redaction test | 未取得 |
| [ ] | CHK-LX-002-I-014 | REQ-LX-LLM-008 | Lead cap test | 未取得 |

対応受入ID: AC-LX-006, AC-LX-007, AC-LX-008
## C. 受入Gate

- [ ] CHK-LX-002-A-001 — AC-LX-006で期待Signal、stable ID、dedupe、根拠外Signal 0件を証明した。
- [ ] CHK-LX-002-A-002 — AC-LX-007でresponse境界違反を100%拒否した。
- [ ] CHK-LX-002-A-003 — AC-LX-008でtimeout等の暗黙provider切替と証跡欠落0件を証明した。
- [ ] CHK-LX-002-A-004 — LLM不在時のrule-only継続がpartial扱いを維持した。

証跡欄にはrun ID、artifact相対path、SHA-256、テストrecordのいずれかを記載する。
