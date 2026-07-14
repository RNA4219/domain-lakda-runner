---
document_id: LAKDA-CHK-AE-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
specification: SPEC-01-COMMON-CORE.md
---

# CHECKLIST-01 共通コア・動的candidate・安全制御

対応仕様: [LAKDA-SPEC-AE-001](SPEC-01-COMMON-CORE.md)
要件正本: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)
評価仕様: [LAKDA-EVAL-AE-001](EVALUATION-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AE-001-S-001 — 一次所有33要件が仕様節へ明示的に割り当てられている。
- [x] CHK-AE-001-S-002 — Observation、ActionCandidate、ActionContract、ExecutionResult、OracleResult、EvidenceArtifactRefの入出力が定義されている。
- [x] CHK-AE-001-S-003 — 操作前後の再観測、settle、candidate破棄・再生成の順序が定義されている。
- [x] CHK-AE-001-S-004 — adapter error、guard拒否、timeout、kill switch、復旧不能時の扱いが定義されている。
- [x] CHK-AE-001-S-005 — 正常、境界、異常、禁止操作シナリオが存在する。
- [x] CHK-AE-001-S-006 — `AC-AE-001`、`AC-AE-014`、`AC-AE-016`と評価仕様への参照がある。
- [x] CHK-AE-001-S-007 — TBD、未決定事項、孤立した一次所有要件がない。

## B. 実装・受入チェック

この節は実装・検証証跡が得られるまで未チェックとする。mockまたはsimulatedだけでreal必須条件を完了扱いにしない。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [ ] | CHK-AE-001-I-001 | REQ-CORE-001 | §4 共通契約 | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-002 | REQ-CORE-002 | §4 共通契約 | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-003 | REQ-CORE-003 | §4 共通契約 | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-004 | REQ-CORE-004 | §4 共通契約 | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-005 | REQ-CORE-005 | §4 共通契約 | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-006 | REQ-CORE-006 | §4 共通契約 | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-007 | REQ-CORE-007 | §4 共通契約 | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-008 | REQ-OBS-001 | §4.1・§5 観測とsettle | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-009 | REQ-OBS-002 | §4.1・§5 観測とsettle | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-010 | REQ-OBS-003 | §4.1・§5 観測とsettle | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-011 | REQ-OBS-004 | §4.1・§5 観測とsettle | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-012 | REQ-OBS-005 | §4.1・§5 観測とsettle | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-013 | REQ-OBS-006 | §4.1・§5 観測とsettle | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-014 | REQ-ACT-001 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-015 | REQ-ACT-002 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-016 | REQ-ACT-003 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-017 | REQ-ACT-004 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-018 | REQ-ACT-005 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-019 | REQ-ACT-006 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-020 | REQ-ACT-007 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-021 | REQ-ACT-008 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-022 | REQ-ACT-009 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-023 | REQ-ACT-010 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-024 | REQ-ACT-011 | §4.2・§4.3・§6 candidate | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-025 | REQ-ADP-001 | §7 adapter interface | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-026 | REQ-ADP-002 | §7 adapter interface | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-027 | REQ-ADP-003 | §7 adapter interface | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-028 | REQ-ADP-004 | §7 adapter interface | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-029 | REQ-SAFE-001 | §8 Safety Policy | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-030 | REQ-SAFE-002 | §8 Safety Policy | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-031 | REQ-SAFE-003 | §8 Safety Policy | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-032 | REQ-SAFE-004 | §8 Safety Policy | 実装・自動/手動試験 | 未取得 |
| [ ] | CHK-AE-001-I-033 | REQ-SAFE-005 | §8 Safety Policy | 実装・自動/手動試験 | 未取得 |

## C. 受入Gate

- [ ] CHK-AE-001-A-001 — `AC-AE-001`の固定Web corpusでstale candidate実行0件を証明した。
- [ ] CHK-AE-001-A-002 — `AC-AE-014`でadapter object漏出、暗黙fallback、lossy error変換0件を証明した。
- [ ] CHK-AE-001-A-003 — `AC-AE-016`でdeny、budget超過、kill switch後のactive操作0件を証明した。
- [ ] CHK-AE-001-A-004 — 追加artifactがHATE/v1 manifestで検証され、QEG verdictをLakdaが生成していない。

証跡欄にはrun ID、artifact相対path、SHA-256、試験recordのいずれかを記載する。
