---
document_id: LAKDA-SPEC-LX-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
requirements: ../Lakda拡張要件定義書.md
checklist: CHECKLIST-01-COMBINATION-TESTING.md
evaluation: EVALUATION-LAKDA-EXTENSION.md
---

# SPEC-01 組み合わせモデル・生成・CLI

## Objective

pairwiseをdeterministicな基準suiteとして生成・検証し、指定factor groupだけをmixed-strengthへ昇格できる契約を定義する。既存CLIとconfigは破壊的に変更しない。

## Scope

In: CombinationFactorModel、CombinationCase、InputInteractionCoverage、constraint検証、select option観測、caseからactionへの決定的解決、combo CLI、既存mode互換。
Out: LLMによるfactor/value変更、任意mutation、外部test engineの再実装、P7 real Gateの完了判定。

## Primary owner IDs

REQ-LX-COMB-001, REQ-LX-COMB-002, REQ-LX-COMB-003, REQ-LX-COMB-004, REQ-LX-COMB-005, REQ-LX-COMB-006, REQ-LX-COMB-007, REQ-LX-COMB-008, REQ-LX-COMB-009, REQ-LX-COMB-010, REQ-LX-COMB-011
REQ-LX-CLI-001, REQ-LX-CLI-002, REQ-LX-CLI-003, REQ-LX-CLI-004, REQ-LX-CLI-005
## Requirements

| 一次所有要件 | 契約 |
|---|---|
| REQ-LX-COMB-001〜002 | modelはversion、model ID、factor ID/kind、許可値、source、risk、constraintsを持ち、input/state/action/environmentを区別する。 |
| REQ-LX-COMB-003 | Playwrightは有効なselect optionを安定順に観測し、disabled、非表示、secret/PIIを候補値へ入れない。 |
| REQ-LX-COMB-004〜006 | 同じmodel bytes、generator version、seedからbyte-identical suiteを生成し、独立verifierがcoverage、constraint、重複、未知refを再計算する。 |
| REQ-LX-COMB-007〜008 | mixed-strengthはfactor groupとstrengthを明示し、昇格根拠、差分case、理由を保存する。指定外groupを暗黙昇格しない。 |
| REQ-LX-COMB-009〜011 | caseからInputCase/ActionTemplateを決定的に解決し、Safety Policyとbudgetを先に適用する。LLMはmodelを変更せず、case budget超過時は生成開始しない。 |
| REQ-LX-CLI-001〜005 | combo gen/verifyをadditiveに追加し、既存mode/config/traceを維持する。未知version/ref/capabilityは非0 exit、helpに入出力とdenyを表示する。 |

## Contract

### Factor model

factor IDはstable semantic IDとし、値は許可済みのsyntheticまたはfixture参照に限定する。raw credential、実PII、実決済情報はfactor modelへ保存しない。constraintsは検証可能なversioned表現とし、充足不能ならpartial successを返さない。

### Suite generation

生成入力はmodel digest、generator version、strength、seed、制約revisionを持つ。pairwiseの有効tupleを分母とし、生成順とcase IDはstable sortで固定する。mixed-strengthは対象groupごとに別suiteまたは派生suiteとして追跡する。

### Verification

combo verifyはgeneratorとは独立した計算で、unknown factor/value、constraint violation、duplicate case、uncovered tupleを検出する。検証失敗は非0 exitとし、未検証suiteを実行へ渡さない。

### Case execution boundary

case assignmentsからInputCaseとActionTemplateを解決し、実行直前に最新Observation、scope、mutation、fixture reset、Action Budget、kill switchを検査する。可視化された操作でもSafety Policyを通らなければdenyとして証跡化する。

## Public I/O

| command | 必須入力 | 出力 | 失敗 |
|---|---|---|---|
| lakda combo gen | factor model、strength、seed | suite.json、generator metadata | constraint/case budget error、非0 |
| lakda combo verify | factor model、suite | coverage/constraint report | unknown ref、coverage不足、非0 |

新規config blockはoptionalとし、既存configのvalidation結果を変更しない。具体的flagとschemaは実装Task Seed開始前に固定する。

## Scenarios

- 正常: 同一modelとseedで2回生成し、bytesとcase順が一致する。
- 境界: 充足不能constraint、case budget超過、unknown valueを全件fail-closedにする。
- 異常: select optionのdisabled化を検出し、前回suiteを暗黙再利用しない。
- 禁止: LLM応答のfactor変更、実決済値、外部送信値をsuiteへ取り込まない。

## Plan

1. schemaとcanonicalizationを固定する。
2. Playwright option extractionをfactor sourceへ接続する。
3. pairwise generatorと独立verifierをtests-firstで実装する。
4. mixed-strength派生とcombo CLIを追加する。
5. AC-LX-001〜005、013のfixture受入を取得する。

## Patch

- 新規schemaとadaptive/combinations artifactだけを追加する。
- 既存run、replay、adaptive-exploreの出力契約を変更しない。
- generator失敗時に部分suiteを保存・実行しない。
- 実行時のSafety Policyは既存adaptive policyを再利用する。

## Tests

- 同一model/seed/versionのbyte-identical再生成。
- valid pair coverage、constraint、duplicate、unknown refのnegative。
- select optionのdisabled、非表示、順序固定、secret/PII scan。
- mixed-strengthの対象group限定と差分artifact。
- 既存CLI/config/traceの回帰とunknown versionの非0 exit。

## Commands

- npm run check:docs
- npm run typecheck
- npm run lint
- npm run build
- npm test
- npm run acceptance:fixture

## Notes

IPOGの具体実装方式、constraint DSL、case budgetの既定値はDEC-LX-001、002、実装Task Seedで決定する。いずれも本仕様のfail-closedとdeterminismを弱めてはならない。
