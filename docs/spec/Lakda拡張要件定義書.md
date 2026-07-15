---
document_id: LAKDA-REQ-003
status: draft
version: 0.1.0-draft
last_updated: 2026-07-15
parent: ../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
target: post-P7
---

# Lakda 拡張要件定義書

## 1. 文書の位置づけ

本書は、Lakdaの適応型探索へ次の2機能を追加するための規範ドラフトである。

1. 決定的なpairwise生成を起点とするprogressive combinatorial testing
2. 観測済みの異常兆候を再現可能なLeadへ束ねるLLM-assisted scouting

現行の公開契約、安全境界、証跡資格は[現行要件](../../REQUIREMENTS.md)を、適応型探索の共通契約は[適応型探索要件](../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)を正本とする。本書はそれらを置き換えず、P7後に追加する差分だけを所有する。

P7の実環境受入は引き続きpending_externalである。本書の策定、ローカル実装、fixture検証を理由に、P7または本拡張の実環境受入を完了扱いにしてはならない。実環境条件は[P7 Real Adaptive Acceptance Runbook](../acceptance/P7-REAL-ACCEPTANCE-RUNBOOK.md)に従う。

解釈が競合する場合は、次の順で扱う。

1. 現行の実行、安全、artifact、HATE/QEG境界はREQUIREMENTS.mdを優先する。
2. 適応型探索の共通契約はREQUIREMENTS-ADAPTIVE-EXPLORATION.mdを優先する。
3. 組み合わせ生成、Signal、Lead、investigate、promoteの追加契約は本書を優先する。
4. 実装前に本書の要件をschema、仕様書、評価case、Task Seedへ具体化する。

要件強度は次のとおりとする。

- Must: 対応phaseの受入に必須
- Should: 設計へ含めるが、後続phaseでの実装を許容
- Could: 評価後に採否を決める候補
- Out: Lakdaの責務外または禁止

## 2. 採用方針

| 項目 | 決定 |
|---|---|
| 組み合わせ生成 | deterministic、constraint-awareなpairwiseを最初の圧縮段とする |
| 高次相互作用 | 全因子を一括昇格せず、指定factor groupだけをmixed-strengthへ昇格する |
| Signal生成 | rule-firstとし、観測・oracle・replay・coverageから機械生成する |
| LLMの役割 | 既存Signalと参照IDを束ねてLead候補を提案する補助器に限定する |
| 確認フロー | Signal → Lead → investigate → reproduced → promoteの順を固定する |
| 実行権限 | LLMへselector、URL、command、任意入力値、Safety Policy変更権限を与えない |
| 判定権限 | LLM単独でdefect、脆弱性、run outcome、Gate verdictを確定しない |
| 保存方式 | first implementationは既存filesystem artifact storeを正本とする |
| 互換性 | 既存CLI、config、mode、trace、artifactへadditiveに拡張する |

本拡張の中心価値は、広く浅い探索と、Signalに応じた高次組み合わせの深掘りを、同じreplay・oracle・evidence flowへ接続することにある。

## 3. 対象範囲

### 3.1 対象

- Web/SaaSの入力、画面状態、操作順、環境条件をfactorとして正規化する。
- pairwise suiteを決定的に生成・検証する。
- 指定factor groupだけを3-way以上へ段階的に昇格する。
- oracle failure、timeout、replay divergence等をSignalへ変換する。
- LLMまたはrule-only処理でSignalをLead候補へ束ねる。
- Leadをstrict replayと人手調査へ引き渡す。
- 再現済みLeadだけを回帰traceまたは強化suiteへpromoteする。
- 追加artifactを既存Artifact PolicyとHATE/v1 manifestへ接続する。

### 3.2 非対象

| 強度 | 項目 |
|---|---|
| Out | LLMによる自由な画面操作、任意selector生成、任意入力値生成 |
| Out | LLM単独によるdefect、脆弱性、run outcome、Gate verdictの確定 |
| Out | Playwright、Airtest、Poco、ZAPの操作engineまたはscan engineの再実装 |
| Out | 明示許可のない本番active scan、race、外部送信、破壊的mutation |
| Out | 既存mode、既存trace、既存configの破壊的変更 |
| Out | LakdaによるQEG record、approval、waiver、Gate verdictの直接生成 |
| Out | provider固有UI、外部SaaS LLM、DB永続化をfirst implementationの必須条件にすること |

## 4. 用語と処理フロー

| 用語 | 定義 |
|---|---|
| CombinationFactor | 入力、画面状態、操作、環境のいずれかに属する離散因子 |
| CombinationCase | factorへの値割当とcovered tupleを持つ1実行case |
| InputInteractionCoverage | 有効tupleを分母とする組み合わせcoverage |
| ExplorationSignal | 観測済み事実からrule-firstで生成する異常兆候 |
| ExplorationLead | 1件以上のSignalと既存参照を束ねた調査候補 |
| investigate | strict replay後に人手調査へ引き渡す処理 |
| promote | 再現済みLeadを回帰traceまたは強化suiteへ昇格する処理 |

処理順は次のとおりとする。

1. factor modelからpairwise suiteを生成する。
2. CombinationCaseを実行してObservation、OracleResult、coverageを更新する。
3. 観測済み事実からrule-firstでSignalを生成する。
4. rule-only処理またはLLMが既存SignalをLead候補へ束ねる。
5. strict replay後に人がinvestigateする。
6. reproducedとなったLeadだけを回帰traceまたはmixed-strength suiteへpromoteする。

## 5. 機能要件

### 5.1 組み合わせモデルと生成

| ID | 強度 | 要件 |
|---|---|---|
| REQ-LX-COMB-001 | Must | factor modelはschema version、model ID、factor ID、factor kind、許可値、source、risk weight、constraintsを持つこと。 |
| REQ-LX-COMB-002 | Must | factor kindはinput、state、action、environmentを最低限扱うこと。 |
| REQ-LX-COMB-003 | Must | Playwright adapterはselectの有効なoptionを安定順で観測し、raw secretまたは非表示・disabled optionをfactor値へ含めないこと。 |
| REQ-LX-COMB-004 | Must | pairwise generatorは同一model bytes、generator version、seedでbyte-identicalなsuiteを生成すること。 |
| REQ-LX-COMB-005 | Must | generatorはconstraintsを適用し、無効tupleを生成しないこと。constraintsが充足不能な場合は部分suiteを成功扱いせずfail-closedにすること。 |
| REQ-LX-COMB-006 | Must | combo verifyはsuite生成処理から独立してvalid tuple coverage、constraint違反、重複case、未知factor/valueを再計算すること。 |
| REQ-LX-COMB-007 | Must | mixed-strengthは対象factor groupとstrengthを明示し、指定外のgroupを暗黙昇格しないこと。 |
| REQ-LX-COMB-008 | Must | mixed-strengthへの昇格はユーザー指定、versioned rule、または既存Lead refのいずれかを根拠とし、理由と差分caseを証跡化すること。 |
| REQ-LX-COMB-009 | Must | CombinationCaseからInputCaseとActionTemplateへの解決は決定的で、実行前にSafety Policy、scope、mutation budgetを通過すること。 |
| REQ-LX-COMB-010 | Must | LLMがfactor、factor value、constraint、case assignmentを新規生成または変更できないこと。 |
| REQ-LX-COMB-011 | Should | suite生成前に推定case数を報告し、設定されたcase budget超過時は生成を開始しないこと。 |

### 5.2 SignalとLead

| ID | 強度 | 要件 |
|---|---|---|
| REQ-LX-SIG-001 | Must | Signalはgeneric/product/security oracle、replay divergence、settle timeout、target topology変化、coverage hole、constraint違反、network anomaly、Safety Policy拒否の観測済み事実からrule-firstで生成すること。 |
| REQ-LX-SIG-002 | Must | Signalはsource run、trace、oracle、fingerprint、artifact、combination caseの参照を持ち、参照不能なSignalを受理しないこと。 |
| REQ-LX-SIG-003 | Must | 同一sourceとfailure signatureから生成されるSignal IDは決定的で、重複を検出できること。 |
| REQ-LX-SIG-004 | Must | LLMはSignalを無から生成できず、提示されたSignal refだけをLeadへ関連付けられること。 |
| REQ-LX-SIG-005 | Must | Leadはexploratory findingであり、investigate前にdefectまたはconfirmed vulnerabilityへ昇格しないこと。 |
| REQ-LX-SIG-006 | Should | LLMが利用不能でもrule-onlyのSignal一覧とLead候補を生成できること。 |

### 5.3 LLM-assisted scouting

| ID | 強度 | 要件 |
|---|---|---|
| REQ-LX-LLM-001 | Must | first implementationは既存のloopback限定LLM transport、model attestation、timeout、token budgetを継承すること。 |
| REQ-LX-LLM-002 | Must | prompt contextはversioned schemaに適合し、redaction済みsummaryと既存refだけを含むこと。raw prompt source、cookie、credential、form値、実PIIを含めないこと。 |
| REQ-LX-LLM-003 | Must | responseはstrict JSON、additionalProperties falseのschemaで検証し、duplicate key、non-JSON、未知version、extra keyを拒否すること。 |
| REQ-LX-LLM-004 | Must | response内のsignalRefs、candidateRefs、factorRefs、combinationCaseRefsはpromptで提示済みの集合に限定すること。 |
| REQ-LX-LLM-005 | Must | selector、URL、path、code、command、raw input、Safety Policy変更、confirmed verdictを含むresponseを全体rejectすること。 |
| REQ-LX-LLM-006 | Must | LLM failure時にproviderを暗黙切替せず、Signalとrun evidenceを保持してpartialまたは設定済みrule-only fallbackへ遷移すること。 |
| REQ-LX-LLM-007 | Must | 受理・拒否したscout判断はschema hash、model attestation ref、input digest、output digest、reject reasonとともにredaction済みJSONLへ記録すること。 |
| REQ-LX-LLM-008 | Should | 1回の応答で生成できるLead数にhard capを設け、既定値を3以下とすること。 |

### 5.4 investigate、promote、shrinking

| ID | 強度 | 要件 |
|---|---|---|
| REQ-LX-INV-001 | Must | investigateはLeadが参照するrun、trace、Signal、CombinationCase、artifactの存在とdigestを検証してから実行すること。 |
| REQ-LX-INV-002 | Must | 人手調査へ移る前にstrict replayを1回実施し、pre/post fingerprint、settle、target topology、oracleの不一致をreplay-divergenceとしてfail-closedにすること。 |
| REQ-LX-INV-003 | Must | 調査結果はreproduced、not_reproduced、inconclusiveを区別し、判断者、時刻、revision、evidence refを持つこと。 |
| REQ-LX-INV-004 | Must | promoteはreproducedかつ必須証跡が揃ったLeadだけを受理し、それ以外を理由付きで拒否すること。 |
| REQ-LX-INV-005 | Must | promoted traceと強化suiteは元run、元Lead、元artifactを変更せず、派生関係とgenerator versionを保持すること。 |
| REQ-LX-INV-006 | Should | shrinkingはcase、sequence、inputの順で試行し、各段で同一failure signatureまたは明示された同値signatureを維持すること。 |
| REQ-LX-INV-007 | Must | shrinkingとpromoteにも通常実行と同じSafety Policy、scope、mutation、budget、kill switchを適用すること。 |

### 5.5 CLIと後方互換

| ID | 強度 | 要件 |
|---|---|---|
| REQ-LX-CLI-001 | Must | 新機能は既存commandを変更せず、combo gen、combo verify、scout、investigate、promote、report leadsとしてadditiveに追加すること。 |
| REQ-LX-CLI-002 | Must | 新規config blockはoptionalとし、拡張を使用しない既存configの意味とvalidation結果を変更しないこと。 |
| REQ-LX-CLI-003 | Must | 既存smoke、seeded-random、regression-replay、llm-explore、adaptive-exploreの選択規則と出力契約を変更しないこと。 |
| REQ-LX-CLI-004 | Must | 未知schema version、未知factor、未知Lead ref、未対応capabilityを暗黙変換または暗黙fallbackせず、非0 exitで終了すること。 |
| REQ-LX-CLI-005 | Must | 新規commandはhelpで入力、出力、既定deny、終了code、artifact保存先を説明すること。 |

### 5.6 証跡、安全、責務境界

| ID | 強度 | 要件 |
|---|---|---|
| REQ-LX-EVD-001 | Must | 追加artifactは既存Artifact Store、redaction、secret/PII scan、SHA-256、size、portable pathの契約を継承すること。 |
| REQ-LX-EVD-002 | Must | artifactまたはsecurity検査の失敗をrun成功で上書きせず、Outcome Policyへ独立入力として渡すこと。 |
| REQ-LX-EVD-003 | Must | 新規JSON、JSONL、HTML reportをHATE/v1 manifestへ検査済みartifactとして登録できること。 |
| REQ-LX-EVD-004 | Must | real、simulated、mockを区別し、mockまたはfixtureだけで実環境必須受入を合格扱いにしないこと。 |
| REQ-LX-EVD-005 | Must | Lakdaの出力境界をHATE/v1 manifestまでとし、QEG record、approval、waiver、Gate verdictを生成しないこと。 |
| REQ-LX-EVD-006 | Must | Lead usefulness、Lead replayability、interaction coverage、追加case数、Safety Policy拒否件数を分子・分母・対象revision付きで報告すること。 |
| REQ-LX-EVD-007 | Must | raw factor valueがsecretまたはPIIになり得る場合、保存artifactではvalue IDまたはdigestへ置換し、replay用の安全なfixture参照と分離すること。 |

## 6. 公開CLI案

| コマンド | 目的 | 必須入力 | 主な出力 |
|---|---|---|---|
| lakda combo gen | pairwiseまたはmixed-strength suite生成 | factor model、strength、seed | suite.json |
| lakda combo verify | suiteの独立検証 | factor model、suite | coverage/constraint verification report |
| lakda scout | suite実行、Signal/Lead生成 | config、suite | signals、leads、scout log |
| lakda investigate | Leadのstrict replayと人手調査 | lead、source run | investigation record |
| lakda promote | 再現済みLeadの回帰資産化 | reproduced lead | promoted traceまたは強化suite |
| lakda report leads | Lead一覧のJSON/HTML化 | run directory | lead report |

CLI名とflagは本書がapprovedになるまで予約案である。実装開始時にCLI schema、終了code、help snapshotを仕様書とcontract testへ固定する。

## 7. データ契約

全新規モデルはschemaVersionを必須とし、原則としてadditionalProperties falseとする。外部参照はRefまたはRefs接尾辞へ統一し、参照先の存在とdigestを検証する。

| モデル | 必須フィールド | 推奨保存先 |
|---|---|---|
| CombinationFactorModel | schemaVersion、modelId、generatorPolicy、factors、constraints | adaptive/combinations/factor-model.json |
| CombinationCase | schemaVersion、suiteId、caseId、strength、assignments、coveringTuples、seed、generatorVersion | adaptive/combinations/suite.json |
| InputInteractionCoverage | schemaVersion、suiteId、strength、covered、uncovered、ratio、factorGroup、openWorld | adaptive/combinations/coverage.json |
| ExplorationSignal | schemaVersion、signalId、signalType、severity、sourceRunId、source refs、message | adaptive/signals/*.json |
| ExplorationLead | schemaVersion、leadId、title、summary、risk、source refs、status | adaptive/leads/*.json |
| InvestigationRecord | schemaVersion、leadRef、replayResult、status、reviewer、evidence refs | adaptive/investigations/*.json |
| PromotionRecord | schemaVersion、leadRef、investigationRef、derived artifact refs | adaptive/promotions/*.json |
| LeadReportIndex | schemaVersion、runId、counts、artifact refs、report paths | reports/lead-report.json |

raw値は保存せず、value ID、digest、許可済みfixture refを用いる。具体的なJSON Schemaと例は分冊仕様で固定する。

## 8. 受入条件

| ID | 対応要件 | 合格条件 |
|---|---|---|
| AC-LX-001 | REQ-LX-COMB-001〜005 | 同一model、version、seedの30回生成でsuiteがbyte-identical、valid pair coverage 100%、constraint違反0件であること。 |
| AC-LX-002 | REQ-LX-COMB-005〜006 | 充足不能constraint、未知factor/value、重複case、coverage欠落を独立verifierが全件検出し、非0 exitになること。 |
| AC-LX-003 | REQ-LX-COMB-003 | select fixtureで有効optionを安定順に抽出し、disabled、非表示、secret/PII残存が0件であること。 |
| AC-LX-004 | REQ-LX-COMB-007〜008 | 指定factor groupだけが3-wayへ昇格し、指定外groupのstrength変化0件、昇格理由と差分caseが保存されること。 |
| AC-LX-005 | REQ-LX-COMB-009〜011 | caseから同一action sequenceを生成し、未許可mutation、scope外操作、case budget超過実行が0件であること。 |
| AC-LX-006 | REQ-LX-SIG-001〜006 | 固定trace corpusから期待Signalを100%生成し、根拠のないSignal、重複Signal、LLM由来の新規Signalが0件であること。 |
| AC-LX-007 | REQ-LX-LLM-001〜005、008 | valid responseだけを受理し、extra/duplicate key、unknown ref、selector、URL、command、raw input、confirmed verdictを100%拒否すること。 |
| AC-LX-008 | REQ-LX-LLM-006〜007 | timeout、schema mismatch、model attestation不一致で暗黙provider切替0件、Signal欠落0件、判断JSONL欠落0件であること。 |
| AC-LX-009 | REQ-LX-INV-001〜003 | 改ざんref/digestを100%拒否し、正常Leadはstrict replay後にのみ人手調査へ遷移すること。意図的divergenceの検出率100%であること。 |
| AC-LX-010 | REQ-LX-INV-004〜005 | reproduced以外のLeadのpromote成功0件、promoted artifactから元Lead、元run、元artifactへ追跡できること。 |
| AC-LX-011 | REQ-LX-INV-006〜007 | case/sequence/input shrinkで元artifactを変更せず、failure signatureとSafety Policyを維持すること。未許可mutation 0件であること。 |
| AC-LX-012 | REQ-LX-EVD-001〜007 | 全追加artifactがredaction、scan、digest、HATE/v1検証を通り、raw secret/PII残存0件、Lakda生成QEG verdict 0件であること。 |
| AC-LX-013 | REQ-LX-CLI-001〜005 | 既存CLI/config/trace contract testが無変更で通り、未知versionと未知refが非0 exit、新commandのhelp snapshotが固定されること。 |
| AC-LX-014 | 全Must | 実環境受入ではtarget revision、config digest、executionMode、oracle refs、HATE refsを記録し、fixture/mockだけの完了宣言が0件であること。 |

## 9. 導入順序

既存P0〜P7との混同を避け、本拡張はP8から採番する。P7のpending_external状態は別Gateとして維持する。

| phase | 主成果物 | 開始条件 | 終了条件 |
|---|---|---|---|
| P8 | factor/schema、Playwright option抽出、combo gen/verify、pairwise | 本書review-ready、schemaとTask Seed作成済み | AC-LX-001〜005のfixture受入 |
| P9 | Signal/Lead、rule-only flow、LLM scout、report、investigate | P8受入、LLM境界schema固定 | AC-LX-006〜009、013のfixture受入 |
| P10 | mixed-strength、promote、case/input shrink、HATE拡張 | P9受入、promotion policy承認済み | AC-LX-004、010〜012のfixture受入 |
| P11 | 認可済み実環境評価と外部Gate handoff | 対象、承認、corpus、revision固定 | AC-LX-014と外部manual-bb/QEG完了 |

ローカル実装はP7 real Gateの完了を待たず進められる。ただしP7またはP11の実環境適格性、production Goへ流用してはならない。

## 10. トレーサビリティ

| 要件群 | 主な受入 | 一次仕様化先 |
|---|---|---|
| REQ-LX-COMB-001〜011 | AC-LX-001〜005 | 組み合わせモデル・生成仕様 |
| REQ-LX-SIG-001〜006 | AC-LX-006 | Signal・Lead仕様 |
| REQ-LX-LLM-001〜008 | AC-LX-007〜008 | LLM scouting契約仕様 |
| REQ-LX-INV-001〜007 | AC-LX-009〜011 | investigate・promote・shrinking仕様 |
| REQ-LX-CLI-001〜005 | AC-LX-013 | CLI・互換性仕様 |
| REQ-LX-EVD-001〜007 | AC-LX-012、014 | 証跡・評価仕様 |

## 11. 未決事項

次の項目は、本書の安全境界を変更しない範囲で仕様化phaseに決定する。

| ID | 未決事項 | 決定期限 |
|---|---|---|
| DEC-LX-001 | IPOG実装を内製module、既存library、外部tool adapterのどれで提供するか | P8 Task Seed承認前 |
| DEC-LX-002 | factor constraint表現をJSON Logic、専用DSL、列挙式のどれに固定するか | schema freeze前 |
| DEC-LX-003 | rule-only Lead groupingの既定ruleと重複判定window | P9 Task Seed承認前 |
| DEC-LX-004 | LLM providerの追加可否とprovider別attestation契約 | P9 schema freeze前 |
| DEC-LX-005 | Lead usefulness/replayabilityのproduction閾値 | P11 corpus baseline取得後 |
| DEC-LX-006 | filesystem以外の永続storeを追加するか | first implementation評価後 |

## 12. 要件・実装チェックリスト

### A. 要件完成チェック

- [x] CHK-LX-S-001 — 既存要件、適応型探索要件、本書の責務順が定義されている。
- [x] CHK-LX-S-002 — 対象、非対象、LLM権限、安全境界が定義されている。
- [x] CHK-LX-S-003 — 全機能要件にID、強度、検証可能な記述がある。
- [x] CHK-LX-S-004 — 要件群と受入条件の対応が定義されている。
- [x] CHK-LX-S-005 — P7とのphase衝突を解消し、P8以降として導入順が定義されている。
- [x] CHK-LX-S-006 — mock/fixture、HATE、manual-bb、QEGの責務境界が定義されている。
- [ ] CHK-LX-S-007 — DEC-LX-001〜006のownerと決定記録が確定している。
- [ ] CHK-LX-S-008 — 対応する分冊仕様書、schema、評価仕様、Task Seedが作成されている。
- [ ] CHK-LX-S-009 — ownerレビューを受け、本書のstatusがapprovedになっている。

### B. 実装・受入チェック

- [ ] CHK-LX-I-001 — P8のfactor/schemaとpairwise generator/verifierがAC-LX-001〜005を満たす。
- [ ] CHK-LX-I-002 — P9のSignal/Leadとrule-only flowがAC-LX-006を満たす。
- [ ] CHK-LX-I-003 — LLM scoutingがAC-LX-007〜008のfail-closed検査を満たす。
- [ ] CHK-LX-I-004 — investigateがAC-LX-009を満たす。
- [ ] CHK-LX-I-005 — promoteとshrinkingがAC-LX-010〜011を満たす。
- [ ] CHK-LX-I-006 — artifact/HATE接続がAC-LX-012を満たす。
- [ ] CHK-LX-I-007 — CLI後方互換がAC-LX-013を満たす。
- [ ] CHK-LX-A-001 — 認可済み実環境でAC-LX-014を満たす証跡を取得している。
- [ ] CHK-LX-A-002 — external manual-bbとQEG Gateが完了している。

## 13. 次工程

本書に対応する[拡張仕様書群](lakda-extension/README.md)、各仕様書のチェックリスト、[評価仕様](lakda-extension/EVALUATION-LAKDA-EXTENSION.md)、[Workflow-cookbook形式の実装計画](../IMPLEMENTATION-PLAN-LAKDA-EXTENSION.md)を正本とする。Task Seedは実装開始時に計画から個別化する。
