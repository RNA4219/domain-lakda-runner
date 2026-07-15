---
document_id: LAKDA-CHK-AE-002
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
specification: SPEC-02-STATE-GRAPH-EXPLORATION.md
---

# CHECKLIST-02 状態fingerprint・遷移グラフ・適応探索

対応仕様: [LAKDA-SPEC-AE-002](SPEC-02-STATE-GRAPH-EXPLORATION.md)
要件正本: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)
評価仕様: [LAKDA-EVAL-AE-001](EVALUATION-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AE-002-S-001 — 一次所有41要件が仕様節へ割り当てられている。
- [x] CHK-AE-002-S-002 — fingerprint canonicalization、volatile除外、衝突診断が定義されている。
- [x] CHK-AE-002-S-003 — node、edge、非決定性、trace再構築契約が定義されている。
- [x] CHK-AE-002-S-004 — GeneratorとStop Conditionの入出力、決定性、優先順位が定義されている。
- [x] CHK-AE-002-S-005 — coverageの分子・分母・revision・open-world注記が定義されている。
- [x] CHK-AE-002-S-006 — loop、backtrack、timeout、復旧不能時の扱いが定義されている。
- [x] CHK-AE-002-S-007 — `AC-AE-002`〜`AC-AE-007`と評価仕様への参照がある。
- [x] CHK-AE-002-S-008 — TBD、未決定事項、孤立した一次所有要件がない。

## B. 実装・受入チェック

実装・試験・real証跡が得られるまで未チェックとする。SHOULD/COULD未実装はunsupported capabilityとして記録する。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [ ] | CHK-AE-002-I-001 | REQ-FP-001 | §3 fingerprint | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-002 | REQ-FP-002 | §3 fingerprint | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-003 | REQ-FP-003 | §3 fingerprint | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-004 | REQ-FP-004 | §3 fingerprint | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-005 | REQ-FP-005 | §3 fingerprint | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-006 | REQ-FP-006 | §3 fingerprint | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-007 | REQ-GRAPH-001 | §4 graph | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-008 | REQ-GRAPH-002 | §4 graph | 決定的fixture・graph/trace検証 | 未取得 |
| [x] | CHK-AE-002-I-009 | REQ-GRAPH-003 | §4 graph | 決定的fixture・graph/trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [x] | CHK-AE-002-I-010 | REQ-GRAPH-004 | §4 graph | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [ ] | CHK-AE-002-I-011 | REQ-GRAPH-005 | §4 graph | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-012 | REQ-GRAPH-006 | §4 graph | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-013 | REQ-GRAPH-007 | §4 graph | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-014 | REQ-EXP-001 | §5 Generator | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-015 | REQ-EXP-002 | §5 Generator | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-016 | REQ-EXP-003 | §5 Generator | 決定的fixture・graph/trace検証 | 未取得 |
| [x] | CHK-AE-002-I-017 | REQ-EXP-004 | §5 Generator | 決定的fixture・graph/trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [ ] | CHK-AE-002-I-018 | REQ-EXP-005 | §5 Generator | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-019 | REQ-EXP-006 | §5 Generator | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-020 | REQ-EXP-007 | §5 Generator | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-021 | REQ-STOP-001 | §6 Stop Condition | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-022 | REQ-STOP-002 | §6 Stop Condition | 決定的fixture・graph/trace検証 | 未取得 |
| [x] | CHK-AE-002-I-023 | REQ-STOP-003 | §6 Stop Condition | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [ ] | CHK-AE-002-I-024 | REQ-STOP-004 | §6 Stop Condition | 決定的fixture・graph/trace検証 | 未取得 |
| [x] | CHK-AE-002-I-025 | REQ-STOP-005 | §6 Stop Condition | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [ ] | CHK-AE-002-I-026 | REQ-STOP-006 | §6 Stop Condition | 決定的fixture・graph/trace検証 | 未取得 |
| [x] | CHK-AE-002-I-027 | REQ-COV-001 | §7 coverage | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [x] | CHK-AE-002-I-028 | REQ-COV-002 | §7 coverage | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [x] | CHK-AE-002-I-029 | REQ-COV-003 | §7 coverage | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [x] | CHK-AE-002-I-030 | REQ-COV-004 | §7 coverage | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [x] | CHK-AE-002-I-031 | REQ-COV-005 | §7 coverage | 決定的fixture・graph/trace検証 | [AC-20260715-08](../../acceptance/AC-20260715-08.p3-p4-replay-hardening.md) |
| [ ] | CHK-AE-002-I-032 | REQ-COV-006 | §7 coverage | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-033 | REQ-COV-007 | §7 coverage | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-034 | REQ-COV-008 | §7 coverage | 決定的fixture・graph/trace検証 | 未取得 |
| [ ] | CHK-AE-002-I-035 | REQ-REC-001 | §8・§9 循環・復旧 | 決定的fixture・graph/trace検証 | 未取得 |
| [x] | CHK-AE-002-I-036 | REQ-REC-002 | §8・§9 循環・復旧 | 決定的fixture・graph/trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [x] | CHK-AE-002-I-037 | REQ-REC-003 | §8・§9 循環・復旧 | 決定的fixture・graph/trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [x] | CHK-AE-002-I-038 | REQ-REC-004 | §8・§9 循環・復旧 | 決定的fixture・graph/trace検証 | [AC-20260715-12](../../acceptance/AC-20260715-12.timeout-quarantine-recovery-safety.md) |
| [x] | CHK-AE-002-I-039 | REQ-REC-005 | §8・§9 循環・復旧 | 決定的fixture・graph/trace検証 | [AC-20260715-12](../../acceptance/AC-20260715-12.timeout-quarantine-recovery-safety.md) |
| [x] | CHK-AE-002-I-040 | REQ-REC-006 | §8・§9 循環・復旧 | 決定的fixture・graph/trace検証 | [AC-20260715-12](../../acceptance/AC-20260715-12.timeout-quarantine-recovery-safety.md) |
| [x] | CHK-AE-002-I-041 | REQ-REC-007 | §8・§9 循環・復旧 | 決定的fixture・graph/trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |

## C. 受入Gate

- [ ] CHK-AE-002-A-001 — `AC-AE-002`の100件×3回でfingerprint一致率・差分率100%、secret残存0件。
- [ ] CHK-AE-002-A-002 — `AC-AE-003`で保存graphとtrace再構築graphが一致した。
- [ ] CHK-AE-002-A-003 — `AC-AE-004`の100 runでcandidate選択列がbyte-identicalだった。
- [ ] CHK-AE-002-A-004 — `AC-AE-005`の全停止理由でhard cap超過操作0件だった。
- [ ] CHK-AE-002-A-005 — `AC-AE-006`で分母増加とcoverage低下を時系列表示できた。
- [ ] CHK-AE-002-A-006 — `AC-AE-007`でloop有限停止、timeout証跡、安全復旧、元failure保持を確認した。
- [ ] CHK-AE-002-A-007 — graph、coverage、recovery artifactのHATE/v1登録とsecurity scanを確認した。

証跡欄にはrun ID、fixture ID、graph revision、artifact相対path、SHA-256を記載する。
