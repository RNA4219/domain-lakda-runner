---
document_id: LAKDA-CHK-AE-005
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
specification: SPEC-05-AIRTEST-POCO-ADAPTER.md
---

# CHECKLIST-05 Airtest/Poco ゲームadapter

対応仕様: [LAKDA-SPEC-AE-005](SPEC-05-AIRTEST-POCO-ADAPTER.md)
要件正本: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)
評価仕様: [LAKDA-EVAL-AE-001](EVALUATION-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AE-005-S-001 — 一次所有4要件が仕様節へ割り当てられている。
- [x] CHK-AE-005-S-002 — Airtest/Poco/device capabilityと暗黙fallback禁止が定義されている。
- [x] CHK-AE-005-S-003 — 画像、UI hierarchy、deviceのprovenance分離が定義されている。
- [x] CHK-AE-005-S-004 — tap/swipe/key/text、未知画面、fingerprint連携が定義されている。
- [x] CHK-AE-005-S-005 — crash、freeze、no-change、visual anomalyのoracle分離が定義されている。
- [x] CHK-AE-005-S-006 — 実機証跡、復旧、禁止操作、capability不足時の扱いが定義されている。
- [x] CHK-AE-005-S-007 — `AC-AE-015`と評価仕様への参照がある。
- [x] CHK-AE-005-S-008 — TBD、未決定事項、孤立した一次所有要件がない。

## B. 実装・受入チェック

Core/Playwright受入後の実装とopt-in実機証跡が得られるまで未チェックとする。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [ ] | CHK-AE-005-I-001 | REQ-GAME-001 | §3〜§8 | opt-in実機・capability/oracle試験 | 未取得 |
| [ ] | CHK-AE-005-I-002 | REQ-GAME-002 | §3〜§8 | opt-in実機・capability/oracle試験 | 未取得 |
| [ ] | CHK-AE-005-I-003 | REQ-GAME-003 | §3〜§8 | opt-in実機・capability/oracle試験 | 未取得 |
| [ ] | CHK-AE-005-I-004 | REQ-GAME-004 | §3〜§8 | opt-in実機・capability/oracle試験 | 未取得 |

## C. 受入Gate

- [ ] CHK-AE-005-A-001 — CoreとPlaywright adapterの前提受入が完了している。
- [ ] CHK-AE-005-A-002 — `AC-AE-015`のopt-in実機corpusでAirtest/Poco capabilityとprovenanceを検証した。
- [ ] CHK-AE-005-A-003 — 未知画面、freeze、crashを別OracleResultとして検証した。
- [ ] CHK-AE-005-A-004 — Poco不能を成功Observationとして扱った件数0を確認した。
- [ ] CHK-AE-005-A-005 — 実機real証跡とsimulated/mockが区別され、HATE/v1検証を通過した。

証跡欄にはdevice alias、app revision、run ID、capability snapshot、artifact SHA-256を記載する。
