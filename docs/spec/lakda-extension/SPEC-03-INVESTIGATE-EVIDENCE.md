---
document_id: LAKDA-SPEC-LX-003
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-16
requirements: ../Lakda拡張要件定義書.md
checklist: CHECKLIST-03-INVESTIGATE-EVIDENCE.md
evaluation: EVALUATION-LAKDA-EXTENSION.md
---

# SPEC-03 investigate・promote・証跡

## Objective

Leadをstrict replayと人手調査へ渡し、reproducedだけを回帰traceまたは強化suiteへpromoteする。元証跡の不変性、Safety Policy、HATE/QEG境界を定義する。

## Scope

In: investigate、replay divergence、investigation status、promote、case/sequence/input shrinking、artifact store、redaction、HATE/v1、real/mock資格、KPI。
Out: QEG verdict、approval、waiver、Lakda単独のdefect/vulnerability確定、未許可active mutation。

## Primary owner IDs

REQ-LX-INV-001, REQ-LX-INV-002, REQ-LX-INV-003, REQ-LX-INV-004, REQ-LX-INV-005, REQ-LX-INV-006, REQ-LX-INV-007
REQ-LX-EVD-001, REQ-LX-EVD-002, REQ-LX-EVD-003, REQ-LX-EVD-004, REQ-LX-EVD-005, REQ-LX-EVD-006, REQ-LX-EVD-007
## Requirements

| 一次所有要件 | 契約 |
|---|---|
| REQ-LX-INV-001〜003 | Lead参照run/trace/Signal/Case/artifactの存在とdigestを検証し、strict replayを人手調査前に1回行う。不一致はreplay-divergence。結果はreproduced/not_reproduced/inconclusiveとreviewer/evidenceを持つ。 |
| REQ-LX-INV-004〜005 | reproducedかつ必須証跡が揃ったLeadだけをpromoteし、元run/Lead/artifactを変更せず派生関係とgenerator versionを保存する。 |
| REQ-LX-INV-006〜007 | shrinkingはcase、sequence、input順でsignatureを維持し、promote/shrinkにもscope、mutation、budget、kill switchを適用する。 |
| REQ-LX-EVD-001〜003 | Artifact Store、redaction、scan、SHA-256、size、portable path、HATE/v1 manifestを既存契約で検証する。 |
| REQ-LX-EVD-004〜007 | real/simulated/mockを区別し、QEGを生成せず、KPIをrevision付きで報告し、raw valueをdigest/fixture refへ分離する。 |

## Contract

### Investigate

investigate開始時に `--lead`、`--trace`、`--config`、`--reviewer`、`--out` を必須とし、Lead、source run、trace、Signal、CombinationCase、artifactの存在、schema version、SHA-256を検証する。configのseed、base URL/allowHosts、target kind、URL scopeも対象接続前に検証し、検証失敗は非0 exitで対象へ接続しない。再構築や別refへの暗黙置換をしない。

参照runは一回だけstrict replayし、生成candidateを元candidateへ再解決したうえで、execution status、pre/post fingerprint、settle status、popup/iframe/new-tabを含むtarget topology、generic/product/security oracleの安定署名を比較する。正常に一致した `reproduced` だけをstep-by-step人手調査へ移行する。candidate unresolved、scope/safety違反、divergence、target lost、artifact欠落はfail-closedで、`replay_diverged` または `inconclusive` の理由付きrecordを確定する。

### Promote

promotion inputはinvestigation status=reproduced、reviewer、target revision、必要artifact refsを必須とする。not_reproduced、inconclusive、証跡欠落、digest mismatchは拒否する。promoted trace/suiteはimmutable parent ref、promotion policy、generator version、差分を持つ。

### Shrinking

case shrink、sequence shrink、input shrinkの各試行を別artifactへ記録する。親traceは変更せず、same failure signatureまたは明示された同値signature、guard、persona、scope、fixture resetを再検証する。destructive action、実決済、外部送信、active securityは明示許可なしに縮約しない。

### Evidence and qualification

追加artifactはexisting Artifact Storeのredaction→scan→hash→manifest順を通る。realは実サーバ/実機の本証跡、simulated/mockは補助証跡と記録する。HATE/v1 manifestまではLakdaが生成してよいが、QEG record/verdict、approval、waiverは生成しない。

保存KPIはLead usefulness、Lead replayability、interaction coverage、case数、Safety拒否を分子・分母・対象revision付きで持つ。raw input/factor valueはdigest、value ID、許可済みfixture refへ置換する。

## Public I/O

| command | 必須入力 | 出力 | 失敗 |
|---|---|---|---|
| lakda investigate | `--lead`、`--trace`、`--config`、`--reviewer`、`--out` | investigation record、replay evidence | preflight/ref/digest/divergence error |
| lakda promote | reproduced investigation | promotion record、derived trace/suite | status/evidence/policy error |
| lakda report leads | run directory | report JSON/HTML | artifact/index error |

## Scenarios

- 正常: reproduced Leadをpromoteし、parent artifactを変更せず派生traceから親へ辿れる。
- 境界: replay divergence、digest mismatch、inconclusiveをpromoteせず理由を保存する。
- 異常: shrinkがsignatureを失った場合は派生artifactを失敗として残し、親を変更しない。
- 禁止: mockだけのrunをreal受入へ昇格、LakdaがQEG verdictを生成、未許可mutationをshrinkしない。

## Plan

1. Lead/source artifact verifierとstrict replay handoffを固定する。
2. investigation statusとreviewer/evidence schemaを固定する。
3. promote policyとimmutable derived artifactを実装する。
4. case/sequence/input shrinkを既存shrinkerへ接続する。
5. HATE projection、qualification、AC-LX-009〜012、014を受入する。

## Patch

- 元trace/artifactを変更せず、派生recordだけを追加する。
- recovery成功を元failureのsuccessへ上書きしない。
- HATE manifestとQEG handoffを分離する。
- real/mock qualificationとSafety Policyを全経路へ適用する。

## Tests

- ref/digest tamper、strict replay divergence、target topology mismatchのnegative。
- reproducedのみpromotion成功、parent immutable、derived trace linkage。
- shrink各段のsignature維持、guard/scope/budget、destructive deny。
- redaction、secret/PII scan、SHA-256、HATE manifest validation。
- real/simulated/mock分類とQEG record/verdict生成0件。

## Commands

- npm run check:docs
- npm run typecheck
- npm run lint
- npm run build
- npm test
- npm run acceptance:fixture
- npm test -- tests/adaptive/p10-cli.spec.ts
- npm run check:hate

## Notes

P11のreal評価、manual-bb、QEGは外部承認環境で行う。local fixture受入をproduction Goへ流用しない。
