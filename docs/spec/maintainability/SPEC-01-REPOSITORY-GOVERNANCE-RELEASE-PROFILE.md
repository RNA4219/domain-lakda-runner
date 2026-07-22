---
document_id: LAKDA-SPEC-MNT-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
requirements: ../../../REQUIREMENTS-MAINTAINABILITY.md
checklist: CHECKLIST-01-REPOSITORY-GOVERNANCE-RELEASE-PROFILE.md
---

# SPEC-01 Repository Governance / Release Profile

対応チェックリスト: [CHECKLIST-01](CHECKLIST-01-REPOSITORY-GOVERNANCE-RELEASE-PROFILE.md)

## Objective

現行文書とrelease入力を機械可読な正本へ集約し、過去RCの文字列や証跡を次のreleaseへ誤引用しない。

## Primary owner IDs

REQ-MNT-GOV-001, REQ-MNT-GOV-002, REQ-MNT-GOV-003, REQ-MNT-GOV-004, REQ-MNT-GOV-005, REQ-MNT-GOV-006, REQ-MNT-GOV-007

## Contract

- 仕様fileのfront matterは一意な`document_id`、`requirements`、`checklist`を持つ。checklistは逆向きの`specification`と要件ID・受入ID・証跡列を持つ。
- P8〜P11の正本は`CHECKLIST-01-COMBINATION-TESTING.md`、`CHECKLIST-02-SIGNAL-LLM-SCOUTING.md`、`CHECKLIST-03-INVESTIGATE-EVIDENCE.md`である。短縮名は非規範aliasで、checkboxや独自判定を持たない。
- current profileは`lakda/release-profile/v1`に適合し、package version、release scope、feature spec、risk register、manual case set、RanD preset/evidence、required checks、external input names、artifact prefix、acceptance IDsを固定する。
- live workflowはprofileをcheckout済みsourceから読み、package versionと参照pathをtarget接続前に検査する。未知check、絶対path、path traversal、存在しない入力を拒否する。
- artifact名、five-tool manifest ID/run ID/scope、real LLM acceptance IDはprofile値から生成する。特定の過去RCをlive workflowへ直書きしない。
- 歴史的release設計、QEG、Acceptance artifactは変更せず、RUNBOOKではHistoricalまたはLegacyとして現行profileから分離する。

## Failure modes

profile schema不正、version不一致、参照欠落、unknown check、index/正本分岐は実行前errorとする。外部入力不足はreleaseをholdし、Lakdaの成功へ変換しない。

## Plan

1. 正本文書、索引、alias規則を固定する。
2. release profile schemaとcurrent profileを追加する。
3. checkerとlive workflowをprofile駆動へ移行する。
4. RUNBOOK、GUARDRAILS、HUB、Birdseyeを現行/歴史に分離する。

## Patch

- 歴史的`docs/release-gate`、Acceptance、QEG artifactのbytesを変更しない。
- P6 workflowはLegacy表示だけを追加し、歴史的package契約を変更しない。
- profile更新はpackage version変更と同じcommitで行う。

## Tests

- 5仕様/5checklistの1対1、alias checkbox 0件、孤立要件/受入0件。
- 全schema compile、current profile schema、package version、参照path。
- live workflow内の過去RC固定値0件、unknown required check拒否。
- 歴史的artifactのgit diff 0件。

## Commands

- `npm run check:docs`
- `npm run release:validate-profile`
- `git diff --check`

## Notes

AC-MNT-001、AC-MNT-002を満たしても外部manual-bb/QEGのGoを意味しない。
