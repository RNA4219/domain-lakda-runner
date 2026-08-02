---
document_id: LAKDA-SPEC-AE-005
status: review-ready
version: 0.2.0-draft
last_updated: 2026-08-02
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-05-AIRTEST-POCO-ADAPTER.md
---

# SPEC-05 Airtest/Poco visual-device adapter

## 1. 目的と導入条件

本仕様は、AirtestとPocoをWindows application／game、Android実機・emulator、iOS実機向けの外部操作基盤として接続し、Lakda Coreの共通Observation、candidate、ExecutionResult、OracleResult、証跡へ変換する方法を規定する。
対応チェックリストは[CHECKLIST-05](CHECKLIST-05-AIRTEST-POCO-ADAPTER.md)、受入方法は[評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を参照する。

本adapterは[自動・クロスプラットフォーム探索MVP](../autonomous-exploratory-testing/SPEC-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md)の必須laneである。実装依存順は共通コアとPlaywright adapterの受入後とするが、Airtest laneを後続releaseへ除外しない。application／game内部のunit/integration testを代替しない。

## 2. 一次所有要件

| 要件群 | 要件ID |
|---|---|
| visual-device adapter | REQ-GAME-001, REQ-GAME-002, REQ-GAME-003, REQ-GAME-004 |

## 3. capability宣言

run開始前に次を個別booleanまたはversioned capabilityとして固定する。

- device connection、platform、resolution、orientation。
- Airtest screenshot、template matching、tap、swipe、key、text。
- Poco SDK connection、UI hierarchy、semantic query、element operation。
- crash signal、process/liveness、frame sampling、video、sampled frames、evidence capture。

Poco不能時にAirtest画像認識が成功しても`pocoUiHierarchy=false`を保持する。実行中にAirtestとPocoの責務を暗黙交換しない。candidateは必要capabilityを宣言し、不足時は`unsupported`とする。

### 3.1 platform lane

| lane | target | executionMode |
|---|---|---|
| `windows-visual` | Windows window／desktop application | approved applicationは`real` |
| `android-visual` | Android real device／emulator | 実機は`real`、emulatorは`simulated` |
| `ios-visual` | iOS real device | approved実機だけ`real` |

laneごとにcapability digest、app revision、device alias digest、resolution、orientation、template revisionを固定する。raw device serial／aliasは公開artifactへ保存しない。Android成功をiOSまたはWindowsのcapability証跡へ流用しない。iOS simulatorとmacOS／Linux native desktopは本仕様のreal acceptance対象外とする。

## 4. TargetRefとObservation

TargetRefはdevice IDのdigest化されたstable alias、app/package/build ref、surface ID、orientationを持つ。実device serial／raw aliasの保存は許可せず、manifest／capabilityではSHA-256 digestだけを扱う。

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

Airtest template、Poco semantic node、またはversioned VisualCandidateProviderの検査済みregionだけをcandidate sourceにできる。threshold未満、animation／redaction mask内、deny zone、sensitive region、source不整合のcandidateは実行しない。LLM座標と未知画面へのrandom tapは禁止する。

text入力はSPEC-03のInputCaseだけを受け付ける。外部送信、購入、アカウント変更等は共通Safety Policyで既定denyとする。

## 6. 未知画面と状態識別

既知template、hierarchy cluster、許可済みVisualCandidateProviderのいずれにも一致しないObservationは`unknown-screen`として新しいexact fingerprint nodeへ登録する。安全なcandidateがなければ`coverage-debt`を保存して操作しない。未知画面を自動的にfailureまたは正常へ分類しない。

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

証跡はexecutionMode、platform lane、device/runtime、app revision、capability、screenshot/videoまたはsampled frames、UI hierarchy、操作trace、oracle resultを持つ。実機`real`だけを実機product behaviorの本証跡とし、emulator/simulatedとmockを区別する。

通常探索ではfindingまたはnon-pass時だけvideoを保持し、passかつfindingなしでは削除する。video capabilityがないlaneはcharterで明示した`sampled-frames/v1`だけを使用し、videoとして登録しない。`regression-replay`、実LLM `full` profile、full fixture acceptanceではvideoと連続sampled framesをoffにする。

## 9. failure対応

| 条件 | 共通結果 | 継続 |
|---|---|---|
| device disconnect | `target_lost` | 再接続strategyが明示され成功した場合のみ |
| Poco未接続 | `unsupported` | Airtest-only candidateだけ許可 |
| screenshot取得失敗 | `infrastructure_error` | complete Observationを要求する探索は停止 |
| orientation変化 | target change | 再観測・candidate再生成後のみ |
| safe visual candidateなし | coverage debt | unknown-screenを保存し、操作しない |
| crash/freeze | OracleResult | critical policyに従い停止・証跡確定 |

## 10. 規範シナリオ

- 正常: Windows、Android、iOSの各laneでcapabilityを固定し、Poco semantic nodeからtapしてAirtest画像とPoco hierarchyを別provenanceで再観測する。
- capability境界: Poco不能時にPoco candidateを生成せず、Airtest-only runとして明示する。
- 未知画面: exact node、coverage debt、探索的発見を作り、random tapもproduct defectへの自動昇格も行わない。
- freeze: animation mask外の画面、hierarchy、input responseがwindow内停止した場合に独立oracleを作る。
- 禁止: 未許可の課金tap、data clear、reinstallを実行しない。

## 11. 受入対応

- `AC-AE-015`: Windows application、Android実機、iOS実機のlane別corpusでcapability、provenance、未知画面、freeze/crash、captureを検証し、Poco不能の成功扱い、lane間証跡流用、random／LLM座標tapを各0件とする。

## Plan

1. loopback bridgeのcapability schemaへplatform lane、capture、livenessを追加する。
2. Airtest screenshot／templateとPoco hierarchyを別provenanceのObservationへ変換する。
3. normalized region、VisualCandidateProvider、unknown-screen／coverage-debtを実装する。
4. crash、freeze、no-change、visual anomalyとcapture policyを接続する。
5. Windows、Android、iOSをmock contract、simulated、approved realの順で個別受入する。

## Patch

- Coreは既存adapter SPIを使い、Airtest／Poco runtime objectを公開型へ追加しない。
- bridgeはoperator管理のloopback endpointのみとし、Lakdaから外部processを起動しない。
- platform固有差はcapabilityとlaneで表現し、暗黙fallbackや共通成功扱いを行わない。
- artifactは既存run directory、Artifact Policy、HATE/v1 manifestを再利用する。
- session-level HATEと五lane acceptance indexを利用し、個別fixture／real reportを単独でMVP eligibleへ昇格しない。

## Tests

- capability handshakeのWindows／Android／iOS matrixと未知platform拒否。
- Airtest-only、Airtest+Poco、Poco disconnect、device disconnect、orientation change。
- normalized region、template threshold、deny／mask領域、unknown-screen no-action。
- crash、freeze、no-change、visual anomalyのOracleResult分離。
- finding／non-pass capture、pass削除、video非対応sampled frames、regression／full off。
- platform別approved real acceptanceとartifact security／HATE再検証。

## Commands

- `npm run check:docs`
- `npm run check`
- `npm run acceptance:adaptive`
- `npm run acceptance:fixture`
- `npm run check:hate`
- `npm run pack:check`
- `npm run acceptance:exploration:fixture`
- `lakda explore acceptance --index <exploration-acceptance-index-v1.json> --trust-store <operator-trust-store.json>`
- 将来追加するWindows／Android／iOS別real acceptance command
- `git diff --check`

## Notes

Airtestのplatform APIとrecording capabilityは一様ではない。capability不足を別機能で暗黙補完せず、screenshotを全laneの基準証跡とし、videoとsampled framesを別artifact kindとして扱う。実装依存は段階化しても、統合MVPの完了条件からWindows、Android、iOSを除外しない。
