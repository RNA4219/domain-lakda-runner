---
document_id: LAKDA-SPEC-AX-001
intent_id: INT-LAKDA-AUTONOMOUS-EXPLORATION-001
owner: RNA4219
status: implementation-complete-real-acceptance-pending
version: 0.3.0
last_updated: 2026-08-03
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
checklist: CHECKLIST-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md
---

# SPEC-01 自動・クロスプラットフォーム探索的テスト

## Objective

既存の`adaptive-explore`、state graph、scouting、strict replay、oracle、Artifact Policyを再利用し、PCとスマートフォンを同一の安全契約で自動探索するMVPを定義する。MVP完了はWebだけのfixture成功ではなく、Windows、Android、iOSの各実行laneとAirtest画像観測を含む。

対応チェックリストは[CHECKLIST-01](CHECKLIST-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md)、基礎契約は[適応型探索仕様](../adaptive-exploration/README.md)、Airtest詳細は[Airtest/Poco visual-device adapter](../adaptive-exploration/SPEC-05-AIRTEST-POCO-ADAPTER.md)を正本とする。

## Scope

### In

- PC WebをPlaywrightで自動探索する。
- スマートフォン向けWebをPlaywrightのmobile profileで自動探索する。
- Windows application／game、Android実機・emulator、iOS実機をAirtest visual-device adapterで自動探索する。
- 利用可能な場合だけPoco UI hierarchyを別provenanceとして併用する。
- 探索charter、session lifecycle、自動candidate選択、finding、resume、session reportを扱う。
- screenshot、trace、videoまたは明示的sampled framesをArtifact PolicyとHATE/v1へ接続する。

### Out

- macOS／Linux native desktop applicationのAirtest操作。
- iOS simulatorを実機product behaviorの本証跡として扱うこと。
- Playwright、Airtest、Poco、device bridge、screen recorderのengine再実装。
- LakdaによるAirtest、Python、AirtestIDE、emulator、device serviceの起動。
- 未知画面へのrandom tap、LLMが生成した座標・selector・URL・inputの実行。
- 全path網羅、完全自動defect認定、QEG record／Gate verdictの生成。
- 未許可のproduction mutation、課金、購入、公開、外部送信、credential変更。

## Requirements

| ID | 強度 | 契約 |
|---|---|---|
| REQ-AX-001 | Must | 実行前にversioned Exploration Charterを検証し、目的、risk領域、target revision、platform、adapter、persona、scope、予算、停止条件、capture policyを固定すること。 |
| REQ-AX-002 | Must | sessionを`draft / running / paused / completed / aborted`で管理し、全状態遷移をappend-only eventとして保存すること。 |
| REQ-AX-003 | Must | 自動探索を既定とし、通常のcandidate選択に人間の逐次入力を要求しないこと。operatorは開始、pause、resume、kill switch、reviewを担当すること。 |
| REQ-AX-004 | Must | resume時にcharter digest、target revision、config digest、persona、adapter capability、current fingerprintを再検証し、不一致時に暗黙継続しないこと。 |
| REQ-AX-005 | Must | 自動Generatorは安全検査済みcandidate集合だけを入力とし、未実行、least-visited、coverage gap、risk、noveltyをversioned規則とseeded tie-breakで評価すること。 |
| REQ-AX-006 | Must | LLMは安全検査済みcandidate IDの順位付け・選択または停止だけを補助し、候補追加、座標、selector、URL、input、oracle、outcomeを生成しないこと。 |
| REQ-AX-007 | Must | visual candidateはAirtest template match、Poco semantic hierarchy、またはversioned VisualCandidateProviderの検査済みregionから生成し、source、confidence、region、required capabilityを持つこと。 |
| REQ-AX-008 | Must | 安全なvisual candidateを生成できない未知画面では操作せず、`unknown-screen`と`coverage-debt`を記録すること。 |
| REQ-AX-009 | Must | run開始前にplatform、device connection、resolution、orientation、screenshot、input、template、Poco hierarchy、video、sampled frames、livenessのcapability snapshotを固定すること。 |
| REQ-AX-010 | Must | Windows、Android、iOSを別platform laneとして扱い、一つのlaneの成功やcapabilityを他laneへ暗黙適用しないこと。 |
| REQ-AX-011 | Must | visual target regionと入力座標はresolution、orientation、surfaceへ正規化し、生pixel座標だけをcandidate IDまたはreplay identityにしないこと。 |
| REQ-AX-012 | Must | Airtest画像、Poco hierarchy、device状態、Core派生値を別provenanceで保存し、source欠落や矛盾を完全Observationとして扱わないこと。 |
| REQ-AX-013 | Must | `crash / freeze / no-visual-change / unknown-screen / visual-anomaly`を別OracleResultとして記録し、単一静止画像やbaseline未定義差分だけでdefectにしないこと。 |
| REQ-AX-014 | Must | 自動検出した異常はまず`exploratory-finding`とし、strict replay、期待・実際、oracle ref、requirement ref、revisionが揃うまで`defect-evidence`へ昇格しないこと。 |
| REQ-AX-015 | Must | finding、non-pass、operator bookmarkでscreenshotを保持し、取得不能時はartifact failureまたは明示的capability debtにすること。 |
| REQ-AX-016 | Must | 通常探索は実行中録画し、findingまたはnon-pass時だけ保持し、passかつfindingなしでは削除すること。operator pinは保持を上書きできること。 |
| REQ-AX-017 | Must | `regression-replay`、実LLM `full` profile、full fixture acceptanceは録画を強制offとし、必要なfailure screenshot／traceを維持すること。 |
| REQ-AX-018 | Must | video capabilityがないplatformでは、明示された`sampled-frames/v1`だけを使用でき、sampled framesをvideoとして表示・登録しないこと。 |
| REQ-AX-019 | Must | screenshot、frame、video、hierarchy、note、findingをredaction、secret/PII scan、容量、SHA-256、HATE/v1登録へ通し、実device serialとraw credentialを公開証跡へ残さないこと。 |
| REQ-AX-020 | Must | session reportはcharter、platform、探索済み／未探索領域、coverage推移、finding、blocker、停止理由、capture状況、残留riskを持ち、Go/No-Goを生成しないこと。 |
| REQ-AX-021 | Must | MVP完了にはPC Web、mobile Web、Windows Airtest、Android Airtest、iOS Airtestのlane別acceptanceが必要で、未取得laneを`pending_external`として残すこと。 |

## Contract

### 1. 既存契約との関係

本仕様は新しい操作engineを追加しない。`adaptive-explore`を自動探索coreとして使用し、Playwrightまたはoperator管理のAirtest/Poco loopback bridgeをadapterとして選択する。`smoke`、`seeded-random`、`regression-replay`、`llm-explore`の既存意味と`lakda/action-plan/v1`を変更しない。

本仕様の`REQ-AX-*`はcross-platform integration profileの一次所有要件である。Observation、fingerprint、graph、Generator、Stop、replay、oracle、evidenceの基礎型は既存`REQ-CORE-*`〜`REQ-EVD-*`を再定義せず参照する。

### 2. Platform matrix

| lane | adapter | execution target | MVP evidence |
|---|---|---|---|
| `pc-web` | Playwright | Chromium desktop profile | fixed corpus＋approved real target |
| `mobile-web` | Playwright | versioned mobile viewport／touch profile | fixed responsive corpus＋approved real target |
| `windows-visual` | Airtest、任意Poco | Windows window／desktop application | approved Windows application real run |
| `android-visual` | Airtest、任意Poco | Android real device／emulator | real deviceを本証跡、emulatorをsimulatedとして分離 |
| `ios-visual` | Airtest、任意Poco | iOS real device | approved real device run。simulatorは本Gate不適格 |

各laneは独立したcapability、corpus、target revision、acceptance reportを持つ。platform間で同じtemplate IDを共有する場合も、画像bytes、scale、orientation、threshold、source revisionをlaneごとに固定する。

### 3. Exploration Charter

入力schemaは`lakda/exploration-charter/v1`とし、target接続前に検証する。

| field | 規則 |
|---|---|
| `charterId`, `mission` | stable IDと探索目的。自然言語は操作命令として実行しない |
| `riskAreas` | 探索優先度の宣言。Safety Policyを緩和しない |
| `targetRef`, `targetRevision` | approved targetとimmutable revision |
| `platformLane`, `adapterId` | platform matrixのIDとbuilt-in adapter |
| `personaRef`, `fixtureRef` | 認証・初期状態の検査済み参照 |
| `scope` | allow target／host／app／surfaceとdeny action |
| `budgets` | duration、maxActions、visit、revisit、rate、artifact bytes |
| `stopWhen` | hard cap外側のplateau、coverage、obligation条件 |
| `capturePolicy` | screenshot、video、sampled frames、pin、classification、retention |
| `findingPolicy` | severity候補、dedupe、promotionに必要なoracle／replay |
| `profile` | settle／fingerprint／recoveryだけを型付きで指定し、安全mutation policyは上書き不可 |

charter欠落、未知version、未承認target、revision不一致、platform／adapter不整合、capture capability不足をtarget接続後に発見してはならない。必須capability不足はpreflightで非0終了する。

### 4. Session lifecycle

session schemaは`lakda/exploration-session/v1`とし、`sessionId`、charter digest、config digest、seed、platform lane、capability digest、target revision、state、started／ended、stop reason、artifact refsを持つ。

許可遷移は次だけとする。

```text
draft -> running
running -> paused | completed | aborted
paused -> running | aborted
```

resumeは再観測後のfingerprintが保存checkpointと一致する場合だけ同一sessionを継続する。不一致時は元sessionを変更せず、operator承認後にparent refを持つ新sessionへ分岐する。pauseまたはkill switch受理後に新しいadapter操作を開始しない。

### 5. Autonomous selection

既定policyは`autonomous-uncovered/v1`とする。

1. 最新Observationからcandidateを再生成する。
2. scope、deny、mutation、budget、guard、kill switchを適用する。
3. 未実行candidateを優先する。
4. least-visited transitionとcoverage gapを評価する。
5. risk areaとbusiness priorityをversioned weightとして加える。
6. stable candidate sortと単一seeded RNGでtie-breakする。
7. 選択、却下理由、RNG位置、graph revisionを保存する。

LLMを使用する場合は手順6の独立selectorとして安全候補IDだけを受け取る。利用不能、不正応答、提示外IDでは別Generatorへ暗黙fallbackせず、設定されたtermination policyで停止する。

### 6. Visual observationとcandidate

Airtestはscreenshot取得、template match、端末入力を「目と手」として提供する。Pocoは利用可能な場合だけsemantic hierarchyを提供する。Lakda Coreは両者のruntime objectを保存せず、versioned Observationへ変換する。

visual Observationは次を持つ。

- screenshot artifact ref、digest、width、height、orientation、surface。
- redaction／animation mask revision。
- template match ID、normalized region、confidence、matcher version。
- Poco hierarchy digest、semantic path、SDK capability。
- app／process liveness、app revision、device alias。
- perceptual digest、unknown-screen判定、source completeness。

`VisualCandidateProvider`はversion、provider ID、input screenshot digest、regions、confidence、provenanceを返す閉じたproviderとする。任意codeやraw promptでregionを追加しない。threshold未満、mask内、deny zone、sensitive region、source不整合のcandidateは実行しない。

### 7. Findingsと昇格

`lakda/exploratory-finding/v1`はfinding ID、session／state／step、summary、observation refs、expected／actualの有無、oracle refs、screenshot／trace／video refs、severity hypothesis、dedupe key、reproduction stateを持つ。

自動生成時のclassificationは必ず`exploratory-finding`である。`defect-evidence`への昇格は既存`investigate`でstrict replayし、同一または明示同値signatureを再現し、product oracleとrequirement refを追加した場合だけ許可する。元findingを上書きせず派生recordを作る。

### 8. Capture policy

探索sessionの既定は`retain-on-finding-or-non-pass`とする。

| condition | screenshot | trace | video | sampled frames |
|---|---|---|---|---|
| finding／non-pass | 必須 | capabilityがあれば必須 | capabilityがあれば保持 | videoなしで明示設定時だけ保持 |
| pass・findingなし | bookmarkだけ |通常policy | 削除 | 削除 |
| operator pin | pin対象を保持 | pin対象を保持 | 通常探索だけ保持可 | pin対象を保持 |
| regression replay | failure時保持 | failure時保持 | 強制off | 連続取得off |
| real LLM full | failure時保持 | failure時保持 | 強制off | 連続取得off |

Airtestまたはplatformがvideoを提供しない場合、Lakdaは暗黙に別recording engineを起動しない。`sampled-frames/v1`はinterval、maxFrames、maxBytes、capture sourceをcharterで固定し、artifact kindもvideoと分離する。

### 9. Public I/O

実装目標のCLIはadditiveに次を提供する。

```text
lakda explore run --charter <exploration-charter-v1.json>
lakda explore resume --session <exploration-session-v1.json>
lakda explore report --session <run-directory>
lakda explore pause --session <session-directory>
lakda explore kill --session <session-directory>
lakda explore bookmark --session <session-directory>
lakda explore fork --session <session-directory>
lakda explore acceptance --index <exploration-acceptance-index-v1.json> --trust-store <operator-trust-store.json>
```

上記CLIとschema、Playwright PC／mobile fixture、Airtest/Poco reference bridge、unknown-screen／capture policy、session HATEはfixtureと契約テストの範囲で実装済みである。個別real reportは`pending_external`を維持し、PC Web、mobile Web、Windows、Android、iOSの5 laneすべてについて、承認済みtarget（Webはrevision probeを含む）のreal evidence、署名・SHA-256・HATEを`lakda explore acceptance`で検証してから集約結果を`eligible`とする。real preflightで検証したtarget manifestはsource digestを保持したままsession canonical `target-manifest.json`へcopyし、acceptance時にsession-started event時刻で署名期限を再検証する。charter／config／platform／adapter／executionMode／targetRevision／capability／bridge binding、capability snapshot実bytes、run IDとrun HATEの完全1:1集合、session HATE包含、HATE security status、event hash-chain／projectionを再検証する。fixture／emulator／mock reportはacceptance indexへ登録せずreal Gateへ昇格しない。単一real reportの`real-lane-acceptance-required`は五lane集約時にだけ解決し、`technicalOutcome`非passed、capture failure、その他のreport blockerはentryをrejectedとする。承認済みtarget manifestまたは実機証跡が欠けるlaneは操作せず`pending_external`とする。

出力はCharterの`outputDir`にrun artifactを保存し、その兄弟の`.lakda/explorations/<session-id>/`（または指定された探索root）へsession artifactを保存する。run artifactとsession artifactは相対pathとdigestで結び付ける。

| artifact | schema／形式 | path |
|---|---|---|
| charter | `lakda/exploration-charter/v1` | `exploration/charter.json` |
| session | `lakda/exploration-session/v1` | `exploration/session.json` |
| lifecycle events | JSONL | `exploration/events.jsonl` |
| visual observations | JSONL＋artifact refs | `exploration/visual-observations.jsonl` |
| findings | `lakda/exploratory-finding/v1` JSONL | `exploration/findings.jsonl` |
| report | `lakda/exploration-report/v1` | `exploration/report.json` |
| state graph／coverage／trace | 既存adaptive schema | `adaptive/` |
| screenshots／frames／video | binary artifact | `artifacts/` |
| session HATE | 既存`HATE/v1` | `exports/artifact-manifest.json` |
| run HATE copy | 既存`HATE/v1` bytes／SHA-256 | `run-manifests/` |

全artifactは相対portable pathを使い、HATE/v1 manifestで実bytesのsize／SHA-256／classification／redaction／security statusを検証する。

### 10. Error and fail-closed behavior

| condition | result | behavior |
|---|---|---|
| charter／approval／revision不正 | config error | target接続前に非0終了 |
| platform／capability不一致 | unsupported | 暗黙fallbackせず終了 |
| screenshot取得不能 | infrastructure error | complete visual Observation必須laneは停止 |
| safe visual candidateなし | coverage debt | unknown-screenを保存し操作しない |
| resume fingerprint不一致 | divergence | 同一sessionを継続しない |
| device disconnect | target lost | 明示recovery成功時だけ再観測 |
| artifact／redaction／scan失敗 | artifact failure | successへ変換せず証跡確定後停止 |
| kill switch／pause | safety stop | 受理後の新規操作0件 |

## Scenarios

- 正常Web: PC Webで未実行transitionを優先し、findingなしのpassed sessionからvideoを削除する。
- 正常Android: Airtest screenshotとPoco hierarchyを別provenanceで取得し、安全なtemplate candidateをtapする。
- Airtest-only: Poco未接続を明示し、template candidateだけでAndroid／Windowsを探索する。
- iOS: real device capabilityを固定し、video非対応時は明示されたsampled framesだけを取得する。
- 未知画面: template、Poco、VisualCandidateProviderのいずれも安全候補を返さず、random tapせずcoverage debtを保存する。
- finding: freeze候補をexploratory findingとして保持し、strict replay前にdefectへ昇格しない。
- resume: app revisionまたはfingerprint差分を検出し、元sessionをimmutableにしたまま分岐を要求する。
- 禁止: LLM座標、未許可課金領域、raw device serial、scope外targetを実行・公開しない。

## Acceptance Criteria

| ID | 合格条件 |
|---|---|
| AC-AX-001 | charter欠落、未知version、revision／platform／adapter不一致の全caseがtarget接続前に非0終了する。 |
| AC-AX-002 | 同一charter、seed、Observation列、candidate列の100 runで自動選択列がbyte-identicalで、未提示candidate実行0件。 |
| AC-AX-003 | PC Web、mobile Web、Windows、Android、iOSの各laneでcapability snapshotとexecutionModeが分離され、lane間暗黙流用0件。 |
| AC-AX-004 | image-only corpusで安全候補がない全画面がunknown-screen／coverage-debtとなり、random／LLM座標tap 0件。 |
| AC-AX-005 | pause／kill switch受理後の新規操作0件。resume fingerprint差分の暗黙継続0件。 |
| AC-AX-006 | crash、freeze、no-change、unknown、visual anomalyが別OracleResultとなり、自動defect昇格0件。 |
| AC-AX-007 | finding／non-pass動画保持率100%、pass・findingなし削除率100%、regression／実LLM full／full fixture acceptanceの録画件数0。video非対応laneはsampled framesと明示される。 |
| AC-AX-008 | 全追加artifactがredaction、scan、size、SHA-256、HATE/v1検証を通り、secret／raw device serial残存0件。 |
| AC-AX-009 | Windows real application、Android real device、iOS real deviceのlane別reportが揃うまで統合MVP Gateを`pending_external`とする。 |
| AC-AX-010 | 既存modeのcontract testが全件passし、LakdaによるQEG record／Gate verdict生成0件。 |

## Plan

1. Exploration Charter、Session、Finding、Reportのschemaとpreflightを固定する。
2. 既存adaptive coordinatorへsession lifecycleと`autonomous-uncovered/v1`をadditiveに接続する。
3. Playwright PC／mobile laneを固定corpusで受入する。
4. Airtest/Poco loopback bridgeをWindows、Android、iOSのcapability matrixへ拡張する。
5. VisualCandidateProvider、unknown-screen、coverage-debt、visual oracleを実装する。
6. finding／non-pass capture retention、sampled frames、HATE/v1登録を実装する。
7. fixture acceptance後に、承認済みWindows application、Android実機、iOS実機でlane別real acceptanceを取得する。
8. manual-bbと外部QEGへ証跡を渡し、Lakda側の最終状態は`pending_external`または技術結果に限定する。

## Patch

- 新規schemaとmoduleは`schemas/lakda-exploration-*.schema.json`、`src/exploration/`へ分離する。
- CLIは`lakda explore`をadditiveに追加し、既存`lakda run`／`replay`の意味を変更しない。
- platform固有処理はPlaywright adapterまたはoperator管理Airtest/Poco bridgeに残し、Coreへruntime objectを漏らさない。
- Airtest/Poco bridgeをLakda packageへ同梱・自動起動せず、loopback JSON contractだけを公開する。
- artifact retentionは既存Artifact Store／Policy／HATE exporterを再利用し、別manifest形式を作らない。
- schema、CLI、adapter、tests、README、RUNBOOK、要件、評価、Task Seed、Skillを同一実装変更で同期する。

## Tests

### Unit／contract

- Charter／Session／Finding／Report schemaの正常、境界、未知version、追加key拒否。
- autonomous selectionのstable sort、seed、risk／coverage weight、未提示ID拒否。
- normalized region、orientation変換、template／Poco／provider provenance。
- finding promotion、resume divergence、capture retention、sampled frames kind。

### Integration

- Playwright PC／mobile fixed corpusの自動探索。
- mock Airtest bridgeによるWindows／Android／iOS capability matrix。
- Airtest-only、Airtest+Poco、Poco disconnect、device disconnect、screenshot failure。
- unknown-screen、freeze、no-change、visual anomaly、finding retention。

### Real acceptance

- acceptance indexの各entryは`executionMode: real`に固定し、5 lane（PC Web／mobile Web／Windows／Android／iOS）を全件揃えなければ`eligible`にしない。entryはsession canonical target manifest、charter、capability snapshot、実run HATE、session HATEのbytes／digestとhash-chain projectionを再検証する。
- 承認済みWindows applicationでreal visual run。
- Android実機とemulatorをreal／simulatedとして分離したrun。
- iOS実機run。simulatorだけではGateを満たさない。
- screenshot／videoまたはsampled framesの実bytes scanとHATE/v1再照合。
- reportに`real-lane-acceptance-required`だけが残る場合は集約時に解決する。`technicalOutcome !== passed`、`capture.failures`非空、その他のreport blockerは署名／HATEが正しくても不合格とする。

## Commands

- `npm run check:docs`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run acceptance:adaptive`
- `npm run acceptance:fixture`
- `npm run check:hate`
- `npm run pack:check`
- `npx playwright test tests/exploration.spec.ts --workers=1`
- 実機real acceptance: 承認済みtarget manifestを明示したoperator-runで実施（未提供時は`pending_external`）
- `git diff --check`

## Notes

### Rationale

自動探索の価値は、PlaywrightのDOM探索だけでなく、画像主体のapplication／gameを同じstate graph、Safety Policy、finding、replay、evidenceへ接続することで成立する。MVPのplatform範囲を縮めず、実装依存順だけをCore→Web→visual-deviceとする。

AirtestはWindows、Android、iOSを対象にするが、platformごとに利用可能APIとrecording能力が異なる。この差をcapability snapshotとlane別acceptanceで表現し、共通機能を装う暗黙fallbackを禁止する。

### Risks

- 画像内PII、通知、software keyboard、device identifierのredactionはDOMより難しく、real acceptance前に専用negative corpusが必要である。
- animation、解像度、orientation、render差分によりstateが過剰分裂するため、mask revisionとexact fingerprintを分離する必要がある。
- Airtest内蔵screen recordingはplatform差があるため、video非対応laneでは別recording engineを暗黙起動せずsampled framesを明示する。
- 実機、署名、接続、app fixture、device labが未準備ならreal laneは`pending_external`のままである。

### Follow-ups

- VisualCandidateProviderの許可実装、model／OCR利用可否、供給元attestationを実装Task Seedで固定する。
- real device corpus、app revision、redaction mask、operator、retention期間をplatform別Acceptance Recordへ記録する。
- macOS／Linux native desktop対応はAirtest以外のoperator-managed adapterを別仕様として評価する。

### References

- [Airtest Project公式ドキュメント](https://airtest.doc.io.netease.com/en/)
- [Airtest platform support](https://airtest.doc.io.netease.com/en/IDEdocs/airtest_framework/0_airtest_info/)
- [Airtest screen recording](https://airtest.doc.io.netease.com/en/IDEdocs/airtest_framework/5_airtest_recording/)
