---
document_id: LAKDA-CHK-AX-001
intent_id: INT-LAKDA-AUTONOMOUS-EXPLORATION-001
owner: RNA4219
status: implementation-complete-real-acceptance-pending
version: 0.3.0
last_updated: 2026-08-03
specification: SPEC-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md
---

# CHECKLIST-01 自動・クロスプラットフォーム探索的テスト

対応仕様: [LAKDA-SPEC-AX-001](SPEC-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md)

基礎要件: [LAKDA-REQ-002](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)

## A. 仕様完成チェック

- [x] CHK-AX-001-S-001 — Objective、In／Out、既存modeの非破壊境界が定義されている。
- [x] CHK-AX-001-S-002 — PC Web、mobile Web、Windows、Android、iOSのplatform laneと証跡資格が定義されている。
- [x] CHK-AX-001-S-003 — Exploration Charter、Session lifecycle、resume／fork契約が定義されている。
- [x] CHK-AX-001-S-004 — 自動Generator、LLM権限、visual candidate、unknown-screen時の操作禁止が定義されている。
- [x] CHK-AX-001-S-005 — Airtest／Poco／device／Core provenance、normalized region、capability境界が定義されている。
- [x] CHK-AX-001-S-006 — finding、strict replay、defect-evidence昇格境界が定義されている。
- [x] CHK-AX-001-S-007 — finding／non-pass保持、regression／full録画off、sampled frames区別が定義されている。
- [x] CHK-AX-001-S-008 — public CLI、schema、artifact path、error／fail-closed対応が定義されている。
- [x] CHK-AX-001-S-009 — `AC-AX-001`〜`AC-AX-010`の合格条件とreal acceptance境界が定義されている。
- [x] CHK-AX-001-S-010 — Workflow-cookbookのPlan／Patch／Tests／Commands／Notesが揃い、TBDと孤立要件がない。

## B. 実装・受入チェック

fixture実装の契約テストとreal device証跡を分けて記録する。B欄の完了はローカル実装とfixture契約の完了を表し、real Gateの完了を表さない。一部laneの成功で統合MVPを完了扱いにしない。real device証跡未取得のC欄は未チェックのまま`pending_external`とする。real acceptanceはsession canonical target manifest／charter／capability snapshot／実run HATE／session HATEのbytes・digest・署名・security status、hash-chain projection、run IDの完全1:1 bindingを再検証する。fixture／emulator／mockはreal Gate証跡に転記しない。

| 完了 | チェックID | 要件ID | 仕様節 | 検証方法 | 証跡 |
|---|---|---|---|---|---|
| [x] | CHK-AX-001-I-001 | REQ-AX-001 | Charter | schema／preflight negative test | `tests/exploration.spec.ts` |
| [x] | CHK-AX-001-I-002 | REQ-AX-002 | Session lifecycle | state transition／append-only event test | `tests/exploration.spec.ts` |
| [x] | CHK-AX-001-I-003 | REQ-AX-003 | Autonomous selection | unattended fixture run | `tests/exploration.spec.ts` |
| [x] | CHK-AX-001-I-004 | REQ-AX-004 | Session lifecycle | resume capability／fingerprint divergence、explicit fork test | `tests/exploration.spec.ts`; `tests/adaptive/coordinator.spec.ts` |
| [x] | CHK-AX-001-I-005 | REQ-AX-005 | Autonomous selection | 100-run deterministic selection test | `tests/adaptive/registries.spec.ts` |
| [x] | CHK-AX-001-I-006 | REQ-AX-006 | Autonomous selection | LLM unknown ID／coordinate denial | `tests/adaptive/registries.spec.ts` |
| [x] | CHK-AX-001-I-007 | REQ-AX-007 | Visual observation | template／Poco／provider provenance test | `tests/exploration.spec.ts`; `tests/airtest-poco-bridge-contract.spec.ts` |
| [x] | CHK-AX-001-I-008 | REQ-AX-008 | Visual observation | unknown-screen no-action test | `tests/exploration.spec.ts`; `tests/adaptive/visual-oracle.spec.ts` |
| [x] | CHK-AX-001-I-009 | REQ-AX-009 | Platform matrix | capability handshake／digest test | `tests/exploration.spec.ts` |
| [x] | CHK-AX-001-I-010 | REQ-AX-010 | Platform matrix | lane isolation／fixture昇格拒否 test | `tests/exploration.spec.ts` |
| [x] | CHK-AX-001-I-011 | REQ-AX-011 | Visual observation | resolution／orientation normalization test | `tests/exploration.spec.ts` |
| [x] | CHK-AX-001-I-012 | REQ-AX-012 | Visual observation | missing／conflicting source test | `tests/airtest-poco-bridge-contract.spec.ts` |
| [x] | CHK-AX-001-I-013 | REQ-AX-013 | Findings／oracle | five visual oracle classifications | `tests/adaptive/visual-oracle.spec.ts` |
| [x] | CHK-AX-001-I-014 | REQ-AX-014 | Findings／promotion | automatic promotion denial／strict replay test | `tests/adaptive/p10-cli.spec.ts`; `tests/adaptive/visual-oracle.spec.ts` |
| [x] | CHK-AX-001-I-015 | REQ-AX-015 | Capture policy | finding／non-pass／bookmark screenshot test | `tests/adaptive/bookmark.spec.ts`; `tests/core.spec.ts` |
| [x] | CHK-AX-001-I-016 | REQ-AX-016 | Capture policy | retain／delete／pin video test | `tests/v02.spec.ts` |
| [x] | CHK-AX-001-I-017 | REQ-AX-017 | Capture policy | regression／full forced-off test | `tests/v02.spec.ts`; `tests/real-llm-evidence.spec.js` |
| [x] | CHK-AX-001-I-018 | REQ-AX-018 | Capture policy | sampled frames kind／budget test | `tests/airtest-poco-bridge-contract.spec.ts` |
| [x] | CHK-AX-001-I-019 | REQ-AX-019 | Artifact security | redaction／scan／HATE revalidation | `tests/binary-attestation.spec.ts`; `tests/adaptive/bookmark.spec.ts`; `tests/v02.spec.ts` |
| [x] | CHK-AX-001-I-020 | REQ-AX-020 | Session report | report schema／QEG boundary test | `tests/exploration.spec.ts` |
| [x] | CHK-AX-001-I-021 | REQ-AX-021 | Real acceptance | five-lane acceptance aggregator contract | `tests/exploration.spec.ts`（real lane証跡は未取得） |

## C. 受入Gate

- [x] CHK-AX-001-A-001 — `AC-AX-001`のfixture契約で不正charterがtarget接続前に全件拒否された。
- [x] CHK-AX-001-A-002 — `AC-AX-002`の100 runで自動選択列がbyte-identical、未提示candidate実行0件だった。
- [x] CHK-AX-001-A-003 — `AC-AX-003`のfixture契約で5 platform laneのcapabilityとexecutionModeが分離された。
- [x] CHK-AX-001-A-004 — `AC-AX-004`のfixture契約でunknown-screenへのrandom／LLM座標tapが0件だった。
- [x] CHK-AX-001-A-005 — `AC-AX-005`のfixture契約でpause／kill後の新規操作とresume暗黙継続が0件だった。
- [x] CHK-AX-001-A-006 — `AC-AX-006`のfixture契約でvisual oracleが分離され、自動defect昇格が0件だった。
- [x] CHK-AX-001-A-007 — `AC-AX-007`のfixture契約でcapture保持／削除／強制off／sampled frames区別が全件一致した。
- [ ] CHK-AX-001-A-008 — `AC-AX-008`で全artifactがsecurity／HATE検証を通り、秘密値残存0件だった。
- [ ] CHK-AX-001-A-009 — `AC-AX-009`でWindows、Android実機、iOS実機のreal reportが別々に取得された。
- [x] CHK-AX-001-A-010 — `AC-AX-010`の全回帰Gateがpassし、LakdaによるQEG verdict生成0件を確認した（real/manual-bb/QEG Gateは外部のまま）。

## Evidence record

証跡欄には最低限、charter ID、session ID、platform lane、device alias、target／app revision、capability digest、run ID、artifact相対path、SHA-256、executionModeを記録する。fixture、emulator、mockだけの結果をWindows／Android／iOS real Gateへ転記しない。
