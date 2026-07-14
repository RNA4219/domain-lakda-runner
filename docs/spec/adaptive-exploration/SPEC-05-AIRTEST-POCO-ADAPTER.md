---
document_id: LAKDA-SPEC-AE-005
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-05-AIRTEST-POCO-ADAPTER.md
---

# SPEC-05 Airtest/Poco ゲームadapter

## 1. 目的と導入条件

本仕様は、AirtestとPocoをゲーム・実機向けの外部操作基盤として接続し、Lakda Coreの共通Observation、candidate、ExecutionResult、OracleResult、証跡へ変換する方法を規定する。
対応チェックリストは[CHECKLIST-05](CHECKLIST-05-AIRTEST-POCO-ADAPTER.md)、受入方法は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を参照する。

本adapterは共通コアとPlaywright adapterの受入後に実装する。ゲームエンジン内部unit/integration testを代替しない。

## 2. 一次所有要件

| 要件群 | 要件ID |
|---|---|
| ゲームadapter | REQ-GAME-001, REQ-GAME-002, REQ-GAME-003, REQ-GAME-004 |

## 3. capability宣言

run開始前に次を個別booleanまたはversioned capabilityとして固定する。

- device connection、platform、resolution、orientation。
- Airtest screenshot、template matching、tap、swipe、key、text。
- Poco SDK connection、UI hierarchy、semantic query、element operation。
- crash signal、process/liveness、frame sampling、video/evidence capture。

Poco不能時にAirtest画像認識が成功しても`pocoUiHierarchy=false`を保持する。実行中にAirtestとPocoの責務を暗黙交換しない。candidateは必要capabilityを宣言し、不足時は`unsupported`とする。

## 4. TargetRefとObservation

TargetRefはdevice IDの非秘密stable alias、app/package/build ref、surface ID、orientationを持つ。実device serialの保存はpolicyでredactionする。

Observationは次のprovenanceを分離する。

| source | 内容 |
|---|---|
| Airtest | screenshot digest、template match ID、座標領域、confidence、取得時刻 |
| Poco | hierarchy digest、node semantic path、type/name/state、SDK version |
| device | app/process状態、orientation、resolution、入力可否 |
| Core | redaction、fingerprint component、obligation、persona/fixture |

画像とUI hierarchyの結果が矛盾する場合は上書き統合せず、両provenanceと矛盾flagを保持する。取得不能なsourceを空の成功Observationにしない。

## 5. candidateと操作

candidate action kindは`tap`、`swipe`、`key`、`text`を基本とする。各candidateはsource provenance、target regionまたはsemantic path、required capability、生成時fingerprint、risk/mutation分類を持つ。

座標はresolution/orientationと画像領域に正規化し、生pixel座標だけをstable IDにしない。Poco candidateはsemantic hierarchy pathを使い、runtime objectを保存しない。

text入力はSPEC-03のInputCaseだけを受け付ける。外部送信、購入、アカウント変更等は共通Safety Policyで既定denyとする。

## 6. 未知画面と状態識別

既知templateまたはhierarchy clusterに一致しないObservationは`unknown-screen`として新しいexact fingerprint nodeへ登録する。未知画面を自動的にfailureまたは正常へ分類しない。

登録recordはscreenshot digest、redaction済みthumbnail/evidence ref、perceptual digest、hierarchy digest可否、直前action、first/last seen、visit countを持つ。類似cluster化してもexact nodeを失わない。

## 7. game oracle

次を別OracleResultとして扱う。

- `crash`: process終了、OS/app crash signal、明示終了。
- `freeze`: livenessはあるがversioned windowで画面、hierarchy、input responseが停止。
- `no-visual-change`: action後に画像・hierarchy変化が閾値未満。freezeとは別。
- `unknown-screen`: 未登録state。探索的発見であり直ちにdefectではない。
- `visual-anomaly`: 明示baselineまたはproduct oracleとの差分。

freeze判定は単一の同一画像だけで確定せず、sampling window、animation mask、expected idle state、input responseを考慮する。baseline未定義の視覚差分をproduct defectへ昇格しない。

## 8. recoveryと証跡

recoveryは安全なback、明示key、app fixture reset、prefix replayとして宣言する。app restart、data clear、reinstallは明示fixture policyと許可がある場合だけ実行する。

証跡はexecutionMode、device/runtime、app revision、capability、screenshot/video、UI hierarchy、操作trace、oracle resultを持つ。実機`real`だけを実機product behaviorの本証跡とし、emulator/simulatedとmockを区別する。

## 9. failure対応

| 条件 | 共通結果 | 継続 |
|---|---|---|
| device disconnect | `target_lost` | 再接続strategyが明示され成功した場合のみ |
| Poco未接続 | `unsupported` | Airtest-only candidateだけ許可 |
| screenshot取得失敗 | `infrastructure_error` | complete Observationを要求する探索は停止 |
| orientation変化 | target change | 再観測・candidate再生成後のみ |
| crash/freeze | OracleResult | critical policyに従い停止・証跡確定 |

## 10. 規範シナリオ

- 正常: Poco semantic nodeからtapし、Airtest画像とPoco hierarchyを別provenanceで再観測する。
- capability境界: Poco不能時にPoco candidateを生成せず、Airtest-only runとして明示する。
- 未知画面: exact nodeと探索的発見を作るが、product defectへ自動昇格しない。
- freeze: animation mask外の画面、hierarchy、input responseがwindow内停止した場合に独立oracleを作る。
- 禁止: 未許可の課金tap、data clear、reinstallを実行しない。

## 11. 受入対応

- `AC-AE-015`: opt-in実機corpusでcapability、provenance、未知画面、freeze/crashを検証し、Poco不能を成功扱いした件数0。
