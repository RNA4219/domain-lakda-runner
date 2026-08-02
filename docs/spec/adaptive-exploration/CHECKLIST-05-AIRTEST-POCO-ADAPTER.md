---
document_id: LAKDA-CHK-AE-005
status: implementation-complete-real-acceptance-pending
version: 0.3.0-draft
last_updated: 2026-08-03
specification: SPEC-05-AIRTEST-POCO-ADAPTER.md
---

# CHECKLIST-05 Airtest/Poco visual-device adapter

対応仕様: [LAKDA-SPEC-AE-005](SPEC-05-AIRTEST-POCO-ADAPTER.md)
要件正本: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)
評価仕様: [LAKDA-EVAL-AE-001](EVALUATION-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AE-005-S-001 — 一次所有4要件をMustとして仕様節へ割り当てている。
- [x] CHK-AE-005-S-002 — Windows、Android実機・emulator、iOS実機のlane、capability、暗黙fallback禁止が定義されている。
- [x] CHK-AE-005-S-003 — Airtest画像、Poco UI hierarchy、device、Coreのprovenance分離が定義されている。
- [x] CHK-AE-005-S-004 — normalized region、template／Poco／VisualCandidateProvider、未知画面no-actionが定義されている。
- [x] CHK-AE-005-S-005 — crash、freeze、no-change、visual anomalyのoracle分離が定義されている。
- [x] CHK-AE-005-S-006 — lane別実機証跡、capture policy、復旧、禁止操作、capability不足時の扱いが定義されている。
- [x] CHK-AE-005-S-007 — `AC-AE-015`と評価仕様への参照がある。
- [x] CHK-AE-005-S-008 — Workflow-cookbookのPlan／Patch／Tests／Commands／Notesがあり、TBDと孤立要件がない。

## B. 実装・受入チェック

参照bridgeとfixture契約の実装完了はB欄へ記録し、Windows、Android実機、iOS実機のlane別証跡はC欄へ分離する。B欄の完了をreal Gateへ転記しない。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [x] | CHK-AE-005-I-001 | REQ-GAME-001 | §3〜§8 | Windows／Android／iOS lane・capability/oracle契約試験 | `tests/exploration.spec.ts`; `tests/adaptive/visual-oracle.spec.ts` |
| [x] | CHK-AE-005-I-002 | REQ-GAME-002 | §3〜§8 | provenance／normalized region／candidate試験 | `tests/exploration.spec.ts`; `tests/airtest-poco-bridge-contract.spec.ts` |
| [x] | CHK-AE-005-I-003 | REQ-GAME-003 | §3〜§9 | Poco不能／capture不能／no-fallback試験 | `tests/airtest-poco-bridge-contract.spec.ts` |
| [x] | CHK-AE-005-I-004 | REQ-GAME-004 | §6〜§9 | unknown／crash／freeze／capture試験 | `tests/adaptive/visual-oracle.spec.ts`; `tests/exploration.spec.ts` |

## C. 受入Gate

- [ ] CHK-AE-005-A-001 — CoreとPlaywright adapterの前提受入が完了している。
- [ ] CHK-AE-005-A-002 — `AC-AE-015`のWindows、Android実機、iOS実機corpusでAirtest/Poco capabilityとprovenanceを個別検証した。
- [ ] CHK-AE-005-A-003 — 未知画面、freeze、crashを別OracleResultとして検証した。
- [ ] CHK-AE-005-A-004 — Poco不能の成功扱い、lane間証跡流用、random／LLM座標tapが各0件だった。
- [ ] CHK-AE-005-A-005 — 実機realとemulator/simulated/mockが区別され、captureを含むHATE/v1検証を通過した。
- [ ] CHK-AE-005-A-006 — video非対応laneでsampled framesがvideoと分離され、regression／fullの連続録画が0件だった。

証跡欄にはplatform lane、device alias digest、app revision、run ID、capability snapshot／digest、capture kind、artifact SHA-256を記載する。raw device serial／aliasを記録せず、一つのlaneの証跡を別laneへ転記しない。五lane集約は`lakda explore acceptance`の署名・SHA-256・HATE検証結果を参照する。
