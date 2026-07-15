---
document_id: LAKDA-CHK-AE-004
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
specification: SPEC-04-PLAYWRIGHT-ADAPTER.md
---

# CHECKLIST-04 Playwright Web/SaaS adapter

対応仕様: [LAKDA-SPEC-AE-004](SPEC-04-PLAYWRIGHT-ADAPTER.md)
要件正本: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)
評価仕様: [LAKDA-EVAL-AE-001](EVALUATION-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AE-004-S-001 — 一次所有10要件が仕様節へ割り当てられている。
- [x] CHK-AE-004-S-002 — Chromium受入、capability固定、共通契約変換が定義されている。
- [x] CHK-AE-004-S-003 — DOM、URL、通信、console/pageerror等のObservation変換が定義されている。
- [x] CHK-AE-004-S-004 — semantic locatorとstale candidate拒否が定義されている。
- [x] CHK-AE-004-S-005 — DOM modal、JS dialog、frame、popup、新規tabのlifecycleが定義されている。
- [x] CHK-AE-004-S-006 — active外pageのgeneric rule、error対応、strict replayが定義されている。
- [x] CHK-AE-004-S-007 — 正常、境界、異常、禁止、replayシナリオがある。
- [x] CHK-AE-004-S-008 — `AC-AE-008`、`AC-AE-010`、`AC-AE-014`への参照がある。
- [x] CHK-AE-004-S-009 — TBD、未決定事項、孤立した一次所有要件がない。

## B. 実装・受入チェック

Chromium実行と証跡が得られるまで未チェックとする。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [x] | CHK-AE-004-I-001 | REQ-WEB-001 | §4・§7〜§9 target topology | Chromium固定corpus・trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [x] | CHK-AE-004-I-002 | REQ-WEB-002 | §4・§7〜§9 target topology | Chromium固定corpus・trace検証 | [AC-20260715-11](../../acceptance/AC-20260715-11.playwright-dialog-target-topology.md) |
| [x] | CHK-AE-004-I-003 | REQ-WEB-003 | §4・§7〜§9 target topology | Chromium固定corpus・trace検証 | [AC-20260715-10](../../acceptance/AC-20260715-10.playwright-frame-offpage-events.md) |
| [x] | CHK-AE-004-I-004 | REQ-WEB-004 | §4・§7〜§9 target topology | Chromium固定corpus・trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [x] | CHK-AE-004-I-005 | REQ-WEB-005 | §4・§7〜§9 target topology | Chromium固定corpus・trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [ ] | CHK-AE-004-I-006 | REQ-WEB-006 | §4・§7〜§9 target topology | Chromium固定corpus・trace検証 | 未取得 |
| [x] | CHK-AE-004-I-007 | REQ-WEB-007 | §4・§7〜§9 target topology | Chromium固定corpus・trace検証 | [AC-20260715-10](../../acceptance/AC-20260715-10.playwright-frame-offpage-events.md) |
| [x] | CHK-AE-004-I-008 | REQ-PW-001 | §3・§5・§6 Playwright | Chromium固定corpus・trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [x] | CHK-AE-004-I-009 | REQ-PW-002 | §3・§5・§6 Playwright | Chromium固定corpus・trace検証 | [AC-20260715-09](../../acceptance/AC-20260715-09.adaptive-contract-topology-recovery.md) |
| [ ] | CHK-AE-004-I-010 | REQ-PW-003 | §3・§5・§6 Playwright | Chromium固定corpus・trace検証 | 未取得 |

## C. 受入Gate

- [ ] CHK-AE-004-A-001 — `AC-AE-008`の全target種別で関係、scope、active target、generic ruleを記録した。
- [ ] CHK-AE-004-A-002 — active外pageのpageerror、crash、HTTP異常の欠落0件を確認した。
- [ ] CHK-AE-004-A-003 — `AC-AE-010`のWeb topologyを含むstrict replayが評価閾値を満たした。
- [ ] CHK-AE-004-A-004 — `AC-AE-014`でadapter object漏出、fallback、lossy error変換0件を確認した。
- [ ] CHK-AE-004-A-005 — screenshot、trace、network等の保存証跡がredaction・scan・HATE/v1検証を通過した。

証跡欄にはcorpus case、browser/runtime、run ID、artifact相対path、SHA-256を記載する。
