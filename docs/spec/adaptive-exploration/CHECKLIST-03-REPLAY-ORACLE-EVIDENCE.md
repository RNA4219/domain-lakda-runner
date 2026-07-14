---
document_id: LAKDA-CHK-AE-003
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
specification: SPEC-03-REPLAY-ORACLE-EVIDENCE.md
---

# CHECKLIST-03 入力生成・strict replay・oracle・証跡

対応仕様: [LAKDA-SPEC-AE-003](SPEC-03-REPLAY-ORACLE-EVIDENCE.md)
要件正本: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)
評価仕様: [LAKDA-EVAL-AE-001](EVALUATION-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AE-003-S-001 — 一次所有32要件が仕様節へ割り当てられている。
- [x] CHK-AE-003-S-002 — InputCaseのdomain、seed、同値・境界・異常分類、安全制約が定義されている。
- [x] CHK-AE-003-S-003 — dynamic trace、strict replay、divergenceの入出力と停止条件が定義されている。
- [x] CHK-AE-003-S-004 — immutable parent traceとfailure shrinkingの採否条件が定義されている。
- [x] CHK-AE-003-S-005 — generic/product/security oracleとclassification境界が定義されている。
- [x] CHK-AE-003-S-006 — real/simulated/mock資格、HATE/v1、QEG責務境界が定義されている。
- [x] CHK-AE-003-S-007 — 正常、境界、異常、禁止操作、復旧証跡シナリオがある。
- [x] CHK-AE-003-S-008 — `AC-AE-009`〜`AC-AE-013`と評価仕様への参照がある。
- [x] CHK-AE-003-S-009 — TBD、未決定事項、孤立した一次所有要件がない。

## B. 実装・受入チェック

実装、schema検証、replayおよび証跡が得られるまで未チェックとする。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [ ] | CHK-AE-003-I-001 | REQ-INP-001 | §3 InputGenerator | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-002 | REQ-INP-002 | §3 InputGenerator | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-003 | REQ-INP-003 | §3 InputGenerator | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-004 | REQ-INP-004 | §3 InputGenerator | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-005 | REQ-INP-005 | §3 InputGenerator | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-006 | REQ-INP-006 | §3 InputGenerator | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-007 | REQ-REP-001 | §4・§5 trace/replay | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-008 | REQ-REP-002 | §4・§5 trace/replay | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-009 | REQ-REP-003 | §4・§5 trace/replay | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-010 | REQ-REP-004 | §4・§5 trace/replay | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-011 | REQ-REP-005 | §4・§5 trace/replay | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-012 | REQ-REP-006 | §4・§5 trace/replay | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-013 | REQ-SHR-001 | §6 shrinking | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-014 | REQ-SHR-002 | §6 shrinking | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-015 | REQ-SHR-003 | §6 shrinking | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-016 | REQ-SHR-004 | §6 shrinking | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-017 | REQ-SHR-005 | §6 shrinking | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-018 | REQ-ORC-001 | §7 oracle | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-019 | REQ-ORC-002 | §7 oracle | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-020 | REQ-ORC-003 | §7 oracle | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-021 | REQ-ORC-004 | §7 oracle | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-022 | REQ-ORC-005 | §7 oracle | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-023 | REQ-ORC-006 | §7 oracle | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-024 | REQ-ORC-007 | §7 oracle | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-025 | REQ-EVD-001 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-026 | REQ-EVD-002 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-027 | REQ-EVD-003 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-028 | REQ-EVD-004 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-029 | REQ-EVD-005 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-030 | REQ-EVD-006 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-031 | REQ-EVD-007 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |
| [ ] | CHK-AE-003-I-032 | REQ-EVD-008 | §8 証跡 | schema・replay・oracle/evidence試験 | 未取得 |

## C. 受入Gate

- [ ] CHK-AE-003-A-001 — `AC-AE-009`で全入力classの決定性、PII/credentialと未許可mutation 0件を確認した。
- [ ] CHK-AE-003-A-002 — `AC-AE-010`でstrict replay成功率85%以上、意図的divergence検出100%を満たした。
- [ ] CHK-AE-003-A-003 — `AC-AE-011`で元trace不変、同一signature、短縮、無効guard実行0件を確認した。
- [ ] CHK-AE-003-A-004 — `AC-AE-012`でoracle分離とdefect/vulnerability誤昇格0件を確認した。
- [ ] CHK-AE-003-A-005 — `AC-AE-013`でexecutionMode資格、HATE/v1検証、QEG verdict生成0件を確認した。
- [ ] CHK-AE-003-A-006 — redaction、実bytes scan、SHA-256、classificationが全追加artifactへ反映された。

証跡欄にはrun ID、trace/shrink parent hash、oracle ID、artifact相対path、SHA-256を記載する。
