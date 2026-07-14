---
document_id: LAKDA-EVAL-AE-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
---

# Lakda 適応型探索 評価仕様

## 1. 目的

本書は、追加要件の`AC-AE-001`〜`AC-AE-016`について、前提、corpus、実行mode、手順、oracle、必要証跡、合格条件を定義する。実装・受入チェックの証跡正本であり、現行v1の[EVALUATION.md](../../../EVALUATION.md)を置換しない。

## 2. 共通評価規約

### 2.1 corpus

各corpusは`corpusId`、version、SHA-256、対象revision、case一覧、expected outcomeを持つ固定datasetとする。評価reportはcorpus SHA-256、config digest、seed、adapter/runtime、executionModeを記録する。

### 2.2 証跡資格

- contract/unit評価はmockを使用できる。
- browser integrationは固定local Web corpusを`real`または明示`simulated`として記録する。
- product behavior、実server、実機、確認済み脆弱性を要求する判定は`real`だけを本証跡にする。
- mock/simulatedだけでreal必須Gateを完了扱いにしない。
- 全artifactはredaction、実bytes security scan、size、SHA-256、HATE/v1 schema検証を通す。

### 2.3 必須report fields

`acceptanceId`、case ID、run ID、attempt、revision、executionMode、environment、seed、config digest、expected、actual、OracleResult refs、artifact refs、verdict、ineligibility reasonを持つ。集約値から個別caseへ追跡できなければならない。

### 2.4 合否

個別caseのinfrastructure error、artifact/security failure、必須証跡欠落はpassに数えない。閾値達成に加え、各ACの0件条件をすべて満たすことを要求する。Lakda run outcomeとQEG Gate verdictを混同しない。

## 3. 受入一覧

| AC | 主仕様 | 主チェックリスト | 実行mode |
|---|---|---|---|
| AC-AE-001 | SPEC-01 | CHECKLIST-01 | fixed Web corpus |
| AC-AE-002 | SPEC-02 | CHECKLIST-02 | contract + fixed corpus |
| AC-AE-003 | SPEC-02 | CHECKLIST-02 | contract/integration |
| AC-AE-004 | SPEC-02 | CHECKLIST-02 | deterministic fixture |
| AC-AE-005 | SPEC-02 | CHECKLIST-02 | deterministic negative fixture |
| AC-AE-006 | SPEC-02 | CHECKLIST-02 | graph fixture |
| AC-AE-007 | SPEC-02 | CHECKLIST-02 | loop/timeout fixture |
| AC-AE-008 | SPEC-04 | CHECKLIST-04 | Chromium fixed corpus |
| AC-AE-009 | SPEC-03 | CHECKLIST-03 | generator + Web fixture |
| AC-AE-010 | SPEC-03/04 | CHECKLIST-03/04 | replay corpus |
| AC-AE-011 | SPEC-03 | CHECKLIST-03 | replayable failure corpus |
| AC-AE-012 | SPEC-03 | CHECKLIST-03 | oracle negative corpus |
| AC-AE-013 | SPEC-03 | CHECKLIST-03 | real/mock/simulated matrix |
| AC-AE-014 | SPEC-01/04 | CHECKLIST-01/04 | adapter contract + Chromium |
| AC-AE-015 | SPEC-05 | CHECKLIST-05 | opt-in real device |
| AC-AE-016 | SPEC-01/06 | CHECKLIST-01/06 | authorization negative + approved real |

## 4. 評価case

### 4.1 AC-AE-001 動的再観測とcandidate更新

**対応要件:** REQ-OBS-001〜005、REQ-ACT-001〜006。

- 前提: DOM、URL、frame、popupのいずれかがactionで変化する固定Web corpus。
- 手順: 初回候補を保存し、各成功action後にsettle、Observation、fingerprint、candidate集合を採取する。旧candidate IDを意図的に再投入するnegative caseを含める。
- oracle: observation sequence、source fingerprint、adapter execute call。
- 合格: 全成功action後にObservationとcandidate集合が更新され、stale candidate実行0件。
- 証跡: action trace、pre/post Observation、candidate snapshot、ExecutionResult、screenshot、network summary。

### 4.2 AC-AE-002 fingerprint再現性と安全性

**対応要件:** REQ-FP-001〜005。

- 前提: 同一canonical Observation 100件、material state差分pair、secret/PII fixture。
- 手順: 各100件を3回canonical化・hash化し、差分pairとvolatile-only pairを比較する。保存artifactをsecret/PII scanする。
- 合格: 同一入力の一致率100%、期待material差分率100%、volatile-only誤差分0件、secret/PII残存0件。
- 証跡: canonical input digest、algorithm/version、component summary、scan report。

### 4.3 AC-AE-003 graph再構築

**対応要件:** REQ-GRAPH-001〜006。

- 前提: 通常、timeout、denied、backtrack、non-deterministic outcomeを含むaction trace。
- 手順: run中graphを保存し、同じtraceを独立reducerへ入力して再構築する。
- 合格: node、edge、attempt/outcome count、failure signature、non-deterministic outcome、graph revisionが一致する。
- 証跡: source trace hash、保存graph、再構築graph、構造diff。

### 4.4 AC-AE-004 Generator決定性

**対応要件:** REQ-EXP-001〜007。

- 前提: random、weighted-random、least-visited-transition用の固定Observation/candidate/graph列。
- 手順: strategyごとに同一config、seed、入力列で100 run実行する。列挙順だけを変えるnegative fixtureを含める。
- 合格: 各strategyのcandidate選択列が100 runでbyte-identical。未知candidateまたはLLM追加candidate実行0件。
- 証跡: config digest、seed、sorted candidate IDs、RNG position、選択列hash。

### 4.5 AC-AE-005 Stop Conditionとhard cap

**対応要件:** REQ-STOP-001〜006。

- 前提: plateau、duration、maxActions、Action Budget、kill switch、critical failure、認証喪失、obligation未達fixture。
- 手順: `any`/`all`の各conditionと同時成立caseを実行する。
- 合格: 期待termination reasonで停止し、duration/maxActions/Action Budget/kill switch超過後の新規操作0件。安全停止理由がcoverage理由に上書きされない。
- 証跡: condition evaluation log、hard cap counters、last action、termination metadata。

### 4.6 AC-AE-006 discovered-model coverage

**対応要件:** REQ-COV-001〜007。

- 前提: state、candidate、edge、transition pair、obligationが段階的に増えるgraph fixture。
- 手順: 各revisionでcoverage snapshotを生成し、新candidate追加前後を比較する。
- 合格: 全ratioに分子、分母、graph revision、open-world注記があり、分母増加とcoverage低下を正しく表現する。
- 証跡: graph revisions、coverage time series、計算再現report。

### 4.7 AC-AE-007 loop・timeout・復旧

**対応要件:** REQ-REC-001〜007。

- 前提: 自己loop、複数node loop、回復可能timeout、persona喪失timeout、target lost fixture。
- 手順: visit/revisit budgetを適用し、timeout後に各継続条件を変えて実行する。
- 合格: loopが有限停止し、安全復旧可能時だけ別candidateへ進む。同一state timeoutの即時再試行0件、元failure保持率100%。
- 証跡: graph、budget counters、timeout evidence、post-timeout Observation、recovery/divergence record。

### 4.8 AC-AE-008 Web target topology

**対応要件:** REQ-WEB-001〜007。

- 前提: DOM modal、JS dialog、same-origin frame、allow cross-origin frame、scope外frame、popup、新規tabを含むChromium corpus。
- 手順: target生成、切替、close、復帰とactive外pageのmachine errorを発生させる。
- 合格: target親子関係、allow scope、active target、lifecycleが欠落なく記録され、active外pageのgeneric event欠落0件。未知dialog accept、scope外frame操作0件。
- 証跡: topology timeline、event log、trace、screenshot、OracleResult。

### 4.9 AC-AE-009 InputGenerator

**対応要件:** REQ-INP-001〜006。

- 前提: string、number/date、enum、compound fieldとHTML/OpenAPI constraint fixture。
- 手順: 同値、境界、直外、empty/null、format、length異常を同一seedで反復生成し、mutation deny formへ適用する。
- 合格: case列が決定的で全必須classを含み、実PII/credential/決済情報0件、未許可mutation実行0件。
- 証跡: InputCase一覧、domain ref、generator version、seed、redaction/scan report、deny result。

### 4.10 AC-AE-010 strict replay

**対応要件:** REQ-REP-001〜006、REQ-WEB-006。

- 前提: modal、frame、popup、generated input、backtrackを含む固定20 sequence。
- 手順: 各sequenceを3回strict replayする。pre/post fingerprintとtarget topologyを意図的に変えたnegative traceを別途実行する。
- 合格: 最後までのreplay成功率85%以上、意図的差分のdivergence検出率100%、代替candidateへの暗黙置換0件。
- 証跡: parent trace hash、各step expected/actual、divergence、target topology、oracle refs。

### 4.11 AC-AE-011 failure shrinking

**対応要件:** REQ-SHR-001〜005。

- 前提: strict replay可能で、cycleまたは除去可能segmentを含むfailure corpus。
- 手順: cycle removal、segment eliminationを行い、各候補をstrict replayする。destructive/active security traceを許可なしで投入するnegative caseを含める。
- 合格: 元trace hash不変、同一/同値signatureを維持した短縮traceを1件以上生成、無効guard実行と未許可mutation0件。
- 証跡: parent/derived trace、attempt一覧、採否理由、signature比較、Safety拒否。

### 4.12 AC-AE-012 oracleと分類

**対応要件:** REQ-ORC-001〜007。

- 前提: generic error、product契約違反、security alert、未接続異常、LLM提案fixture。
- 手順: 各registryを独立実行し、誤った昇格要求を投入する。
- 合格: class別resultが分離され、未接続異常のdefect昇格0件、scanner/LLM単独結果のconfirmed昇格0件。
- 証跡: registry/version、OracleResult、classification transition、requirement/evidence refs。

### 4.13 AC-AE-013 証跡資格とHATE/QEG境界

**対応要件:** REQ-EVD-001〜008。

- 前提: 同じcaseのreal、simulated、mock runと追加artifact一式。
- 手順: executionMode別に受入資格を評価し、HATE/v1 manifestを検証する。Lakda出力をQEG recordとして検査するnegative testを含める。
- 合格: mockだけでreal必須受入を満たした件数0、全追加artifactがHATE/v1で検証可能、LakdaによるQEG verdict/record生成0件。
- 証跡: run metadata、artifact scan/hash、HATE validation、ineligibility reason。

### 4.14 AC-AE-014 adapter共通契約

**対応要件:** REQ-ADP-001〜004、REQ-PW-001〜003。

- 前提: Playwright Chromium adapterとunsupported/timeout/target lost/固有error fixture。
- 手順: Coreとの境界をschema captureし、capability不足と固有errorを注入する。
- 合格: adapter objectの公開schema漏出0件、暗黙fallback0件、lossy error変換0件。Coreがadapter failureを別Outcome入力として保持する。
- 証跡: capability snapshot、boundary schema、error mapping table、ExecutionResult。

### 4.15 AC-AE-015 Airtest/Poco opt-in実機

**対応要件:** REQ-GAME-001〜004。

- 前提: 承認済みopt-in実機、固定app revision、Airtest-onlyとAirtest+Pocoのcase、未知画面、freeze/crash fixture。
- 手順: capabilityを固定し、画像とUI hierarchyを別provenanceで観測する。Poco切断caseを含める。
- 合格: capability/provenance、未知画面、freeze/crashが別resultで記録され、Poco不能を成功扱いした件数0。
- 証跡: device alias、app hash、capability、Observation、screenshot/hierarchy、OracleResult。実機real以外は本Gate不適格。

### 4.16 AC-AE-016 Security authorizationと安全停止

**対応要件:** REQ-SECX-001〜008、REQ-SAFE-001〜005。

- 前提: 欠落、期限切れ、scope不一致、production passive-only、deny action、budget超過、kill switch、承認済みstaging profile。
- 手順: 各negative profileでactive candidate生成・request数を測定し、承認済みprofileではcandidate/confirmed flowを実行する。
- 合格: 未許可active操作0件、budget/kill switch後の新規active操作0件、scanner/LLM単独confirmed昇格0件、candidateとconfirmedを分離。
- 証跡: authorization ref、policy evaluation、request counter、mutation trace、cleanup、OracleResult、人手/明示oracle確認record。

## 5. 完了記録

各ACの完了時は、対応CHECKLISTの受入Gateへreport相対pathとSHA-256を記載する。全Mustの実装・受入完了後も、最終Go/No-GoはHATE/QEG側で決定し、本書またはLakda run outcomeで代替しない。
