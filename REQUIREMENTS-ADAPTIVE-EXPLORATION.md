---
document_id: LAKDA-REQ-002
status: normative-draft
version: 0.1.0-draft
last_updated: 2026-07-14
parent: REQUIREMENTS.md
target: post-v1
---

# Lakda 適応型探索・共通コア追加要件

## 1. 文書の位置づけ

本書は、`domain-lakda-runner` の post-v1 に追加する適応型探索、状態遷移グラフ、
複数操作基盤adapter、replay、oracle、証跡の規範ドラフトである。

現行v1の受入、公開契約、安全境界、HATE/QEG連携は [REQUIREMENTS.md](REQUIREMENTS.md)
と [SPECIFICATION.md](SPECIFICATION.md) を正本とする。本書の `Must` は、現行v1の
Mustを意味せず、本書を対象とするpost-v1 milestoneの受入に必須であることを示す。

解釈が競合する場合は、次の順で扱う。

1. 現行v1の実行・安全・証跡・Gate境界は `REQUIREMENTS.md` を優先する。
2. post-v1適応型探索の機能契約は本書を優先する。
3. 実装前に[適応型探索仕様書群](docs/spec/adaptive-exploration/)、schema、[適応型探索評価仕様](docs/spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md)、Task Seedへ具体化する。
4. 本書だけを根拠に既存mode、schema、artifactを破壊的変更しない。

要件強度は次のとおりである。

- **Must**: post-v1適応型探索milestoneの受入に必須
- **Should**: 設計へ含めるが、後続milestoneでの実装を許容
- **Could**: 評価後に採否を決める候補
- **Out**: Lakdaの責務外または禁止

## 2. 位置づけと中心価値

Lakdaは、Web、ゲーム、認証済みセキュリティ探索を共通の状態遷移モデルで扱い、
安全に探索し、再現可能な証跡を生成するローカル優先のテストオーケストレーターを
目指す。

Lakdaは操作技術そのものを再実装しない。Playwright、Airtest/Poco、ZAP等を
「目と手」として利用し、Lakda Coreが次を担当する。

- 状態の観測、正規化、fingerprint化
- 安全な操作候補の生成と選択
- 状態遷移グラフ、探索履歴、coverageの管理
- 予算、禁止操作、停止、復旧、kill switch
- generic oracleとproduct固有oracleの実行
- seed付き選択、strict replay、failure shrinking
- HATE/v1へ渡せる証跡の生成

adapter追加は、共通コア契約とPlaywright adapterの受入完了後に段階実施する。
現行 `seeded-random` は実行前にplanを確定するdeterministic modeとして維持し、
動的再観測を伴う探索は新しい `adaptive-explore` modeとして分離する。

## 3. 対象範囲

### 3.1 Web / SaaS

- PlaywrightによるDOM、URL、page、frame、dialog、通信状態の観測
- 表示中かつ操作可能な要素からの候補抽出
- form入力、画面遷移、認証後flow、popup、新規tabの探索
- console、HTTP、page error、timeout、表示状態異常の検知
- product固有のguard、postcondition、invariant、obligationの評価

### 3.2 ゲーム

- Airtestによる実機・ゲーム画面の取得、画像認識、入力
- Pocoによる利用可能な場合のUI階層取得とUI要素操作
- tap、swipe、key、text等のadapter操作
- 未知画面の登録、状態識別、クラッシュ、フリーズ、視覚異常の観測

PocoのUI階層は常に利用可能とはみなさない。adapterは画像認識、UI階層、
実機入力等のcapabilityを実行前に宣言し、利用不能なcapabilityへ暗黙fallbackしない。

### 3.3 セキュリティ

- 明示的に許可された環境に対する認証済み探索型DAST
- persona / role間の認可差分
- ID、query、path、body parameterの許可済み変異
- 手順のskip、reorder、replay、二重実行、回数制限の検査
- 専用許可profileでのrace検査
- 入力の同値、境界、異常値探索
- ZAP等の既存DASTとの連携
- 発見経路、request、response、状態遷移の再現証跡化

Lakdaは「完全自動ペンテスト」を称さず、人間のペンテストを補助し、許可済み範囲を
継続的に再検査する。セキュリティ候補と確認済み脆弱性を分離する。

## 4. 共通契約

共通コアとadapter間の規範契約は次を基本とする。

| 契約 | 責務 |
|---|---|
| `Observation` | ある時点の画面、通信、app、persona、target構造のredaction済み観測 |
| `StateFingerprint` | versioned canonical observationから生成した状態識別子 |
| `ActionCandidate` | 現在状態で実行候補となる安全検査前の宣言型操作 |
| `ActionContract` | candidateのguard、postcondition、invariant、risk、mutation契約 |
| `ExecutionResult` | 操作の実行可否、結果、前後状態、時間、target移動、failure参照 |
| `OracleResult` | generic / product / security oracleの独立した評価結果 |
| `EvidenceArtifactRef` | 保存済みartifactとHATE/v1 entryを結ぶ参照 |

### 4.1 共通契約要件

| ID | 強度 | 要件 |
|---|---|---|
| REQ-CORE-001 | Must | Coreはadapter固有のPlaywright、Airtest、Poco、ZAP objectを公開契約へ漏らさず、共通契約を介して観測・候補・実行・oracle・証跡を扱うこと。 |
| REQ-CORE-002 | Must | すべての共通契約はschema versionを持ち、未知versionの暗黙変換を禁止すること。 |
| REQ-CORE-003 | Must | `Observation`はraw secret、cookie、authorization、form値、実PIIを含まず、保存前redactionと保存後scanの対象になること。 |
| REQ-CORE-004 | Must | `ActionCandidate`はstable ID、adapter ID、target ref、action kind、locator recipe、input profile ref、生成根拠、risk、mutation分類を持つこと。 |
| REQ-CORE-005 | Must | `ExecutionResult`はcandidate ID、pre/post fingerprint、開始・終了時刻、status、failure signature、recovery status、evidence refsを持つこと。 |
| REQ-CORE-006 | Must | `OracleResult`はoracle ID、oracle class、verdict、severity、source refs、requirement refs、evidence refsを持ち、実行結果から分離して保存できること。 |
| REQ-CORE-007 | Must | `EvidenceArtifactRef`はHATE/v1 artifact entryを複製せず、検査済みpath、SHA-256、size、classification、redaction、security statusへの対応を保持すること。 |

## 5. 観測と状態fingerprint

### 5.1 観測

| ID | 強度 | 要件 |
|---|---|---|
| REQ-OBS-001 | Must | adapterは初回操作前と各操作後に対象を再観測し、candidate集合を再生成すること。 |
| REQ-OBS-002 | Must | 再観測はaction完了だけでなく、versioned settle policyによるDOM、navigation、page/frame、networkの安定判定後に行うこと。 |
| REQ-OBS-003 | Must | Web観測は正規化URL、主要表示要素、role/name、enabled/visible状態、form構造、modal/dialog、page/frame topology、主要通信結果、persona、obligation状態を取得できること。 |
| REQ-OBS-004 | Must | adapterは観測対象を`targetRef`で識別し、browser context、page/tab、popup、frame、device、game surfaceを区別できること。 |
| REQ-OBS-005 | Must | 観測の失敗、部分取得、capability不足を成功観測として扱わず、`complete / partial / unavailable`を明示すること。 |
| REQ-OBS-006 | Should | 画像主体adapterはperceptual digestと主要領域の識別結果を構造化Observationへ含めること。 |

### 5.2 fingerprint

| ID | 強度 | 要件 |
|---|---|---|
| REQ-FP-001 | Must | `StateFingerprint`はfingerprint algorithm versionとcanonicalization policy versionを含むこと。 |
| REQ-FP-002 | Must | Web fingerprintは正規化URL、redaction済みDOM構造、主要表示要素、persona、page/frame topology、modal/dialog、obligation、主要通信状態から構成できること。 |
| REQ-FP-003 | Must | timestamp、nonce、random ID、animation値、実入力値、token、cookie等のvolatileまたはsensitive値を既定でfingerprintから除外すること。 |
| REQ-FP-004 | Must | 同一のversioned canonical Observationはbyte-identicalなfingerprint inputと同一fingerprintを生成すること。 |
| REQ-FP-005 | Must | fingerprint衝突または過剰な状態分裂を検出できるよう、fingerprintとは別にredaction済みobservation digestと構成要素summaryを保存すること。 |
| REQ-FP-006 | Should | exact fingerprintと類似状態clusterを分離し、類似度による統合が原Observationとexact nodeを失わせないこと。 |

## 6. 動的candidateとaction局所契約

### 6.1 candidate生成

| ID | 強度 | 要件 |
|---|---|---|
| REQ-ACT-001 | Must | Web adapterは表示中、enabled、操作可能で、許可されたrole/action kindに一致する要素だけをcandidate生成対象にすること。 |
| REQ-ACT-002 | Must | 「表示中かつ操作可能」は安全を意味しない。生成candidateはCoreのallow host、deny action、mutation、fixture reset、rate/resource policyを通過した場合だけ実行可能になること。 |
| REQ-ACT-003 | Must | candidate IDはelement handleや列挙順へ依存せず、adapter、target、semantic locator、action kind、input profileから安定生成すること。 |
| REQ-ACT-004 | Must | candidateは生成時Observationとstate fingerprintを参照し、別stateで暗黙再利用しないこと。 |
| REQ-ACT-005 | Must | LLMはcandidate IDの選択だけを補助でき、任意selector、URL、path、input値、code、commandをcandidateへ追加できないこと。 |
| REQ-ACT-006 | Must | dynamic candidate modeを既存`actionCatalog` modeから分離し、既存`smoke`、`seeded-random`、`regression-replay`の公開契約を変更しないこと。 |

### 6.2 guard、postcondition、invariant

| ID | 強度 | 要件 |
|---|---|---|
| REQ-ACT-007 | Must | `ActionContract.enabledWhen`を実行直前の最新Observationで評価し、不成立candidateを実行しないこと。 |
| REQ-ACT-008 | Must | `ActionContract.ensures`を操作後Observationに対する期待として評価し、不一致をoracle resultへ記録すること。 |
| REQ-ACT-009 | Must | `ActionContract.invariants`は操作前後で維持すべきpersona、認証、host、data境界等を表し、違反を独立したoracle resultへ記録すること。 |
| REQ-ACT-010 | Must | 局所契約が未定義のdynamic candidateはgeneric guardだけで実行できるが、product固有の成功を推測せず`inconclusive`を許容すること。 |
| REQ-ACT-011 | Should | requirement、business priority、risk weight、mutation costをactionへ関連付け、探索優先度へ使用できること。 |
## 7. form入力生成

| ID | 強度 | 要件 |
|---|---|---|
| REQ-INP-001 | Must | form入力値はversioned `InputGenerator`とseed、field domain、input profileから生成し、LLMの自由文を直接使用しないこと。 |
| REQ-INP-002 | Must | `InputGenerator`は最低限、正常同値class、境界値、境界直外、empty/null相当、format異常、length異常を表現できること。 |
| REQ-INP-003 | Must | 生成値はcase ID、generator version、seed、domain ref、valid/invalid分類、期待oracle refを持つこと。 |
| REQ-INP-004 | Must | 実PII、実credential、実決済情報を生成せず、synthetic値または明示fixtureだけを使用すること。 |
| REQ-INP-005 | Must | submit、upload、決済、送信、作成等のmutationを伴う入力flowは既定denyとし、明示許可、fixture reset、action budgetを必要とすること。 |
| REQ-INP-006 | Should | OpenAPI、HTML constraint、product schemaからdomain候補を導出できるが、導出結果を安全policyより優先しないこと。 |

## 8. 状態遷移グラフ

| ID | 強度 | 要件 |
|---|---|---|
| REQ-GRAPH-001 | Must | 各runは観測したstate nodeと実行したtransition edgeからversioned state transition graphを構築すること。 |
| REQ-GRAPH-002 | Must | nodeはfingerprint、observation digest、first/last seen、visit count、known candidates、obligation状態、evidence refsを持つこと。 |
| REQ-GRAPH-003 | Must | edgeはfrom、candidate/action、to、attempt count、outcome count、latency summary、oracle refs、failure signatures、evidence refsを持つこと。 |
| REQ-GRAPH-004 | Must | 同一state/actionから複数to stateが観測された場合、上書きせず非決定的transitionとしてすべて保持すること。 |
| REQ-GRAPH-005 | Must | timeout、denied、guard不成立、recovery、reset、backtrackを通常成功transitionと区別して記録すること。 |
| REQ-GRAPH-006 | Must | graph artifactはrun action traceから再構築可能で、保存済みgraphとの不一致を検証できること。 |
| REQ-GRAPH-007 | Should | revision間でnode/edgeの追加、消失、outcome変化、非決定性増加を比較できること。 |

## 9. 探索GeneratorとStop Condition

### 9.1 分離契約

| ID | 強度 | 要件 |
|---|---|---|
| REQ-EXP-001 | Must | 「どう歩くか」を決めるGeneratorと「いつ終了するか」を決めるStop Conditionを独立した設定・型として分離すること。 |
| REQ-EXP-002 | Must | `adaptive-explore`は同一config、seed、同一Observation列、同一candidate列に対して同一candidate選択列を生成すること。 |
| REQ-EXP-003 | Must | tie-breakとrandom選択は単一seeded RNGとstable candidate sortを使用し、wall clock、network完了順、object列挙順を乱数入力にしないこと。 |
| REQ-EXP-004 | Must | 最低限`random`、`weighted-random`、`least-visited-transition`をGeneratorとして提供すること。 |
| REQ-EXP-005 | Should | graphが到達経路を持つ場合、`shortest-to-uncovered`を提供すること。 |
| REQ-EXP-006 | Should | risk、business priority、未実行、mutation costを用いた`risk-weighted-uncovered`を提供すること。 |
| REQ-EXP-007 | Must | LLM選択は独立Generatorとして扱い、coverage、safety、stop、oracle、outcomeの権限を持たないこと。 |

### 9.2 Stop Condition

| ID | 強度 | 要件 |
|---|---|---|
| REQ-STOP-001 | Must | Stop Conditionは`any`と`all`の明示的な論理合成を扱えること。 |
| REQ-STOP-002 | Must | `durationMs`、`maxActions`、Action Budget、kill switchを常にhard capとして適用し、coverage条件で無効化できないこと。 |
| REQ-STOP-003 | Must | 直近N actionで新規state、known candidate、transition、obligationのいずれも増えない`noveltyPlateau`を扱えること。 |
| REQ-STOP-004 | Must | plateauは`minActions`到達前に成立させず、window、観測項目、終了理由を証跡へ保存すること。 |
| REQ-STOP-005 | Must | coverageによる停止は分母とgraph revisionを記録し、未知状態を含む絶対的なシステム網羅率と表現しないこと。 |
| REQ-STOP-006 | Must | obligation未達、critical failure、認証喪失、scope逸脱、artifact/security failureではcoverage達成にかかわらず安全側へ停止すること。 |

## 10. coverageと探索評価

観測後付けgraphでは未発見状態を分母にできないため、`state coverage`を絶対的な
システム網羅率として扱わない。すべてのcoverageは`discovered-model`または
固定obligationに対する指標であることを明示する。

| ID | 強度 | 要件 |
|---|---|---|
| REQ-COV-001 | Must | discovered state count、new state count、novel state rateを報告すること。 |
| REQ-COV-002 | Must | 既知の`(state, candidate)`に対するexecuted action coverageを報告すること。 |
| REQ-COV-003 | Must | 観測済みgraphに対するtransition coverageを、分子・分母・graph revision付きで報告すること。 |
| REQ-COV-004 | Must | 連続する2 transitionの既知組合せに対するtransition-pair coverageを報告できること。 |
| REQ-COV-005 | Must | requirementまたはobligation集合が固定されている場合、obligation coverageを別指標として報告すること。 |
| REQ-COV-006 | Must | 新規candidate発見により分母が増えcoverageが低下することを許容し、時系列を保持すること。 |
| REQ-COV-007 | Should | loop、再訪、non-deterministic edge、failure edgeを含む探索効率指標を報告すること。 |
| REQ-COV-008 | Could | graph規模とcycle列挙上限を固定したうえでround-trip coverageを追加すること。 |

## 11. 循環抑制、backtrack、復旧

| ID | 強度 | 要件 |
|---|---|---|
| REQ-REC-001 | Must | 循環を絶対禁止せず、state visit budget、edge revisit budget、loop penalty、plateauで重複探索を抑制すること。 |
| REQ-REC-002 | Must | backtrackは`browser-back`、`close-target`、`fixture-reset-and-prefix-replay`等の明示strategyとして扱い、通常actionと区別して記録すること。 |
| REQ-REC-003 | Must | backtrack実行前後にfingerprintを取得し、期待stateへ戻れない場合は探索を継続せずdivergenceを記録すること。 |
| REQ-REC-004 | Must | timeout時はpre-state、candidate、target、elapsed、screenshot/trace可否、通信状態、post-timeout Observation、failure signatureを保存すること。 |
| REQ-REC-005 | Must | timeout後の探索継続はtargetが観測可能でscope内にあり、personaとinvariantが維持され、critical failureがない場合だけ許可すること。 |
| REQ-REC-006 | Must | timeout candidateを同一stateで自動再試行せず、quarantineまたはrevisit budgetへ反映すること。 |
| REQ-REC-007 | Must | 復旧成功が元のtimeout、oracle failure、run failureを成功へ上書きしないこと。 |

## 12. modal、iframe、popup、新規tab

| ID | 強度 | 要件 |
|---|---|---|
| REQ-WEB-001 | Must | DOM modalとbrowser JavaScript dialogを別のtarget/event種別として観測すること。 |
| REQ-WEB-002 | Must | 未知のJavaScript dialogを既定でacceptせず、deny policy、action contract、mutation分類に従いdismiss、hold、許可済みacceptを選ぶこと。 |
| REQ-WEB-003 | Must | same-originおよび明示allow hostのiframeをframe targetとして登録し、frame内candidateへframe pathを付与すること。 |
| REQ-WEB-004 | Must | cross-origin frameはorigin scopeとcapabilityを検査し、観測不能部分を完全Observationとして扱わないこと。 |
| REQ-WEB-005 | Must | popupまたは新規tab生成時は新pageを登録し、opener、URL、trigger action、allow host、lifecycleを記録すること。 |
| REQ-WEB-006 | Must | active targetの切替、close、復帰をaction traceへ保存し、replay時に同じtarget関係を検証すること。 |
| REQ-WEB-007 | Must | context内の全pageへgeneric machine ruleを適用し、active page以外のpageerror、crash、HTTP異常を欠落させないこと。 |

## 13. replayとfailure shrinking

### 13.1 strict replay

| ID | 強度 | 要件 |
|---|---|---|
| REQ-REP-001 | Must | 動的探索traceは各stepのcandidate descriptor、target ref、input case、pre/post fingerprint、settle result、execution result、oracle refsを保存すること。 |
| REQ-REP-002 | Must | 動的traceは現行`lakda/action-plan/v1`を暗黙拡張せず、新しいversioned schemaで保存すること。 |
| REQ-REP-003 | Must | strict replayはstep実行前のguardとpre-fingerprintを検証し、不一致時に別candidateへ暗黙置換しないこと。 |
| REQ-REP-004 | Must | post-fingerprint、target topology、oracle resultが期待と異なる場合、`replay-divergence`としてstep、期待値、実値を保存すること。 |
| REQ-REP-005 | Must | replayは同じURLや見た目を保証するものではなく、記録済み操作と状態契約の再検証であることをmetadataへ明示すること。 |
| REQ-REP-006 | Must | popup、frame、modal、generated input、backtrack、recoveryを含むtraceを再生できること。 |

### 13.2 failure shrinking

| ID | 強度 | 要件 |
|---|---|---|
| REQ-SHR-001 | Should | replay fidelityの受入後、failureを維持する最短または局所最小sequenceを探索するfailure shrinkerを提供すること。 |
| REQ-SHR-002 | Should | 元traceと元証跡をimmutableに保持し、縮約traceを派生artifactとしてparent trace、algorithm、attempt、結果とともに保存すること。 |
| REQ-SHR-003 | Should | 縮約candidateはguard、persona、scope、fixture reset、target topologyを満たし、同一failure signatureまたは明示同値signatureを再現すること。 |
| REQ-SHR-004 | Should | cycle removalを先に評価し、その後にvalidity-preservingなsegment eliminationを行うこと。 |
| REQ-SHR-005 | Must | destructive action、実決済、外部送信、active security actionを含むsequenceを明示許可なしに自動縮約実行しないこと。 |

## 14. oracle分離

| ID | 強度 | 要件 |
|---|---|---|
| REQ-ORC-001 | Must | generic oracle、product oracle、security oracleを別registry、別resultとして扱うこと。 |
| REQ-ORC-002 | Must | generic oracleはpageerror、crash、console error、HTTP異常、timeout、認証喪失、artifact/security failure等の共通観測だけを判定すること。 |
| REQ-ORC-003 | Must | product oracleはrequirement、obligation、guard、postcondition、invariant等の明示契約を必要とし、未定義期待結果を推測しないこと。 |
| REQ-ORC-004 | Must | security oracleは`candidate / confirmed / rejected / inconclusive`を区別し、scanner alertまたはLLM判断だけで`confirmed`にしないこと。 |
| REQ-ORC-005 | Must | defect evidenceは再現trace、期待結果、実結果、oracle ref、requirement ref、対象revision、実行環境を持つこと。 |
| REQ-ORC-006 | Must | requirementまたはproduct oracleへ未接続の異常は`exploratory finding`として保存し、自動的にdefectへ昇格しないこと。 |
| REQ-ORC-007 | Must | LLMはoracle候補、要約、重複候補を提案できるが、単独でfailure、defect、脆弱性、Gate verdictを確定しないこと。 |

## 15. 証跡の扱い

### 15.1 実行modeと証跡資格

| ID | 強度 | 要件 |
|---|---|---|
| REQ-EVD-001 | Must | runとartifactは`executionMode=real / simulated / mock`、target environment、adapter、device/browser/runtime、revisionを記録すること。 |
| REQ-EVD-002 | Must | 実serverまたは実機に対する`real`実行だけをproduct behaviorの本証跡として扱うこと。 |
| REQ-EVD-003 | Must | mock、fixture、状態注入はunit/contract/integrationの補助証跡として保持できるが、real実行を要求する受入条件を満たした扱いにしないこと。 |
| REQ-EVD-004 | Must | `exploratory finding`、`defect evidence`、`security candidate`、`confirmed vulnerability`を別classificationとして保存すること。 |
| REQ-EVD-005 | Must | artifactは現行Artifact Store、Artifact Policy、Outcome Policy、HATE Exporterの確定順序、redaction、scan、hash契約を継承すること。 |
| REQ-EVD-006 | Must | transition graph、coverage report、replay trace、shrink report、oracle resultsをHATE/v1 manifestへ検査済みartifactとして登録できること。 |
| REQ-EVD-007 | Must | LakdaはHATE/v1 artifact manifestまでを生成し、QEG quality-evidence-record、Gate verdict、approval、waiverを直接生成しないこと。 |
| REQ-EVD-008 | Must | 最終Go / Conditional Go / No-Go / DisqualifiedはHATE adapterを介したQEGだけが決定すること。 |

## 16. adapter要件

### 16.1 共通adapter

| ID | 強度 | 要件 |
|---|---|---|
| REQ-ADP-001 | Must | adapterは`capabilities`、`observe`、`generateCandidates`、`execute`、`recover`、`captureEvidence`の境界を持つこと。 |
| REQ-ADP-002 | Must | adapter capabilityは実行前に固定し、実行中の暗黙backend切替または異なる操作基盤へのfallbackを禁止すること。 |
| REQ-ADP-003 | Must | adapter固有errorを共通の`unsupported / denied / timeout / target_lost / action_failed / infrastructure_error`へlosslessに対応付け、元error refを保持すること。 |
| REQ-ADP-004 | Must | Coreはadapterのfailureをoracle failure、runner error、artifact failureへ勝手に統合せず、Outcome Policyへ独立入力として渡すこと。 |

### 16.2 Playwright adapter

| ID | 強度 | 要件 |
|---|---|---|
| REQ-PW-001 | Must | 最初の適応型探索adapterは現行Playwright実装を基礎とし、Chromiumで受入すること。 |
| REQ-PW-002 | Must | locatorはuser-facing role/name、test ID、label等の宣言型recipeを優先し、element handleをreplay契約に保存しないこと。 |
| REQ-PW-003 | Must | DOM、URL、page/frame、console、request/response、dialog、download、popup lifecycleのうち有効な観測をObservationへ統合すること。 |

### 16.3 Airtest / Poco adapter

| ID | 強度 | 要件 |
|---|---|---|
| REQ-GAME-001 | Should | CoreとPlaywright adapterの受入後、Airtest/Pocoを外部操作基盤として接続すること。 |
| REQ-GAME-002 | Should | Airtestの画像認識結果とPocoのUI階層結果を別provenanceでObservationへ記録すること。 |
| REQ-GAME-003 | Should | Poco SDK未接続またはUI階層取得不能を画像認識成功で隠さず、capability不足として記録すること。 |
| REQ-GAME-004 | Should | crash、freeze、画面無変化、未知画面、視覚異常を別oracle resultとして扱うこと。 |

### 16.4 Security adapter

| ID | 強度 | 要件 |
|---|---|---|
| REQ-SECX-001 | Must | security profileは対象owner、許可scope、environment、期間、操作種別、rate、concurrency、停止連絡先を持つauthorization recordを必要とすること。 |
| REQ-SECX-002 | Must | authorization recordが欠落、期限切れ、scope不一致の場合、active mutationとscanを開始しないこと。 |
| REQ-SECX-003 | Must | productionは既定でpassive observationのみとし、active scan、parameter mutation、reorder、raceを明示許可なしに実行しないこと。 |
| REQ-SECX-004 | Must | role差分は同一resource、同一revision、同一fixture前提を記録し、認証喪失やsession不一致を認可脆弱性として誤認しないこと。 |
| REQ-SECX-005 | Must | ID/parameter mutation、skip、reorder、double execution、rate、raceの各操作を別mutation kindとして記録すること。 |
| REQ-SECX-006 | Must | raceは逐次workerの拡張として実装せず、専用concurrency budget、target許可、cleanup、kill switchを持つschedulerへ分離すること。 |
| REQ-SECX-007 | Should | ZAPの認証、spider、passive/active scan、report機能をadapter経由で利用し、ZAP scan engineを再実装しないこと。 |
| REQ-SECX-008 | Must | ZAP alertをsecurity candidateとして取り込み、再現、product context、人手確認または明示oracleなしにconfirmed vulnerabilityへ昇格しないこと。 |

## 17. 安全制御

| ID | 強度 | 要件 |
|---|---|---|
| REQ-SAFE-001 | Must | allow target、allow host、deny action、mutation policy、fixture reset、Action Budget、artifact budget、duration、maxActionsを全adapterで共通適用すること。 |
| REQ-SAFE-002 | Must | kill switchはGenerator、LLM、adapter、recovery、shrinkerより優先し、新規操作を開始せず安全な証跡確定へ移ること。 |
| REQ-SAFE-003 | Must | delete、deactivate、billing、transfer、purchase、publish、external message、credential変更等を既定denyとすること。 |
| REQ-SAFE-004 | Must | candidate生成、input生成、replay、recovery、shrinking、security mutationのすべてが同じSafety Policyを通ること。 |
| REQ-SAFE-005 | Must | deny、scope外、rate limit、kill switchをfailure隠蔽に使用せず、attempt、拒否理由、state、evidenceを保存すること。 |


## 18. 受入条件

| ID | 対応要件 | 合格条件 |
|---|---|---|
| AC-AE-001 | REQ-OBS-001〜005、REQ-ACT-001〜006 | actionでDOMまたはtarget topologyが変化する固定Web corpusで、全成功action後にObservationとcandidate集合が更新され、stale candidate実行が0件であること。 |
| AC-AE-002 | REQ-FP-001〜005 | 同一canonical Observation 100件×3回でfingerprint一致率100%、material state差分fixtureで期待したfingerprint差分率100%、secret/PII残存0件であること。 |
| AC-AE-003 | REQ-GRAPH-001〜006 | action traceからgraphを再構築し、node、edge、count、non-deterministic outcome、failure edgeが保存graphと一致すること。 |
| AC-AE-004 | REQ-EXP-001〜007 | 同一Observation/candidate fixture、config、seedの100 runでcandidate選択列がbyte-identicalであること。 |
| AC-AE-005 | REQ-STOP-001〜006 | plateau、duration、maxActions、Action Budget、critical failure、obligationの各終了条件が期待reasonで停止し、hard cap超過操作が0件であること。 |
| AC-AE-006 | REQ-COV-001〜007 | coverage reportが分子、分母、graph revision、open-world注記を持ち、新candidate発見後の分母増加とcoverage低下を正しく表現すること。 |
| AC-AE-007 | REQ-REC-001〜007 | loop fixtureで有限停止し、timeout fixtureで証跡を残し、安全復旧可能時だけ別candidateへ進み、元failureが保持されること。 |
| AC-AE-008 | REQ-WEB-001〜007 | DOM modal、JS dialog、same/cross-origin frame、popup、新規tabの固定corpusでtarget関係、allow scope、active target、generic rulesを欠落なく記録すること。 |
| AC-AE-009 | REQ-INP-001〜006 | 同値、境界、直外、empty、format、length異常caseがseedから決定的に生成され、実PII/credentialと未許可mutationが0件であること。 |
| AC-AE-010 | REQ-REP-001〜006 | modal、frame、popup、generated input、backtrackを含む20 sequence×3回で最後までのstrict replay成功率85%以上、意図的pre/post差分のdivergence検出率100%であること。 |
| AC-AE-011 | REQ-SHR-001〜005 | replay可能なfailure corpusで元traceを変更せず、同一failure signatureを維持した短縮traceを生成し、無効guard実行と未許可mutationが0件であること。 |
| AC-AE-012 | REQ-ORC-001〜007 | generic、product、security oracle resultが分離され、requirement未接続異常がdefectへ、scanner/LLM単独結果がconfirmed vulnerabilityへ昇格した件数0であること。 |
| AC-AE-013 | REQ-EVD-001〜008 | real/mock/simulatedを識別し、mockだけのrunがreal必須受入を満たした件数0、全追加artifactがHATE/v1 manifestで検証可能、LakdaによるQEG verdict生成0件であること。 |
| AC-AE-014 | REQ-ADP-001〜004、REQ-PW-001〜003 | Playwright adapterが共通契約だけでCoreへ接続され、adapter objectのschema漏出、暗黙fallback、lossy error変換が0件であること。 |
| AC-AE-015 | REQ-GAME-001〜004 | opt-in実機corpusでAirtest/Poco capability、provenance、未知画面、freeze/crash観測を検証し、Poco不能を成功扱いした件数0であること。 |
| AC-AE-016 | REQ-SECX-001〜008、REQ-SAFE-001〜005 | authorization欠落、scope外、production active、deny action、budget超過、kill switch後のactive操作が0件で、候補/確認済み脆弱性が分離されること。 |

## 19. 実装優先順位

| 順序 | milestone | 主な成果物 |
|---:|---|---|
| 1 | 契約固定 | 共通型、schema、`adaptive-explore`境界、Safety/Oracle interface、Task Seed |
| 2 | Playwright観測 | Observation、fingerprint、動的candidate、modal/frame/page topology |
| 3 | 地図と再現 | transition graph、dynamic trace schema、strict replay |
| 4 | 探索評価 | Generator/Stop分離、plateau、discovered-model coverage、least-visited |
| 5 | 誘導と復旧 | shortest-to-uncovered、risk-weighted、backtrack、timeout recovery |
| 6 | 入力と縮約 | InputGenerator、form探索、failure shrinking |
| 7 | ゲーム | Airtest/Poco adapter、実機capability、game oracle |
| 8 | セキュリティ | 認可差分、手順変異、専用race scheduler、security confirmation flow |
| 9 | 外部連携 | ZAP adapter、追加artifactのHATE/QEG投影、release evidence |

各milestoneは、対応するMust要件、受入fixture、real実行条件、artifact schema、
security negative testを[適応型探索評価仕様](docs/spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md)とTask Seedへ追加してから実装を開始する。

## 20. やらないこと

| 強度 | 項目 |
|---|---|
| Out | Airtest、Poco、Playwright、ZAPの操作・scan engineそのものの再実装 |
| Out | 人間による完全な状態遷移図の事前作成を必須にすること |
| Out | 全path網羅を達成可能または絶対的正解として扱うこと |
| Out | 生成された自然言語テストケースを主要成果物にすること |
| Out | ゲームエンジン内部unit/integration testの代替 |
| Out | 明示許可のない本番環境へのactive scan、race、攻撃的parameter mutation |
| Out | LLM判断だけによるdefect、脆弱性、run outcome、Gate verdictの確定 |
| Out | 顧客影響を生むproduct実装またはデータの変更 |
| Out | LakdaによるQEG record、Gate verdict、approval、waiverの直接生成 |

## 21. トレーサビリティ

| 要件群 | 主な受入 |
|---|---|
| REQ-CORE-001〜007 | AC-AE-013、AC-AE-014 |
| REQ-OBS-001〜006、REQ-FP-001〜006 | AC-AE-001、AC-AE-002 |
| REQ-ACT-001〜011 | AC-AE-001、AC-AE-004、AC-AE-012 |
| REQ-INP-001〜006 | AC-AE-009 |
| REQ-GRAPH-001〜007 | AC-AE-003、AC-AE-006 |
| REQ-EXP-001〜007、REQ-STOP-001〜006 | AC-AE-004、AC-AE-005 |
| REQ-COV-001〜008 | AC-AE-006 |
| REQ-REC-001〜007、REQ-WEB-001〜007 | AC-AE-007、AC-AE-008、AC-AE-010 |
| REQ-REP-001〜006、REQ-SHR-001〜005 | AC-AE-010、AC-AE-011 |
| REQ-ORC-001〜007 | AC-AE-012 |
| REQ-EVD-001〜008 | AC-AE-013 |
| REQ-ADP-001〜004、REQ-PW-001〜003 | AC-AE-014 |
| REQ-GAME-001〜004 | AC-AE-015 |
| REQ-SECX-001〜008、REQ-SAFE-001〜005 | AC-AE-016 |

本書の要件を実装対象へ昇格するときは、[適応型探索仕様書群](docs/spec/adaptive-exploration/)へ
型・状態遷移・CLI・artifact配置・outcome対応を定義し、
[適応型探索評価仕様](docs/spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md)へ
固定corpus、閾値、real実行、negative fixtureを定義する。各仕様書は対応チェックリストと
1対1で管理し、孤立要件または受入未定義のMustがある状態では実装を開始しない。
