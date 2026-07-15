---
document_id: LAKDA-SPEC-LX-INDEX
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
requirements: ../Lakda拡張要件定義書.md
evaluation: EVALUATION-LAKDA-EXTENSION.md
---

# Lakda 拡張仕様書群

P7後の追加要件を、Workflow-cookbookの一次所有・Task Seed・Acceptance・Evidenceへ投影する仕様書群である。P7 real受入のpending_external状態は変更しない。

## 読み順

| 順序 | 仕様書 | チェックリスト | 一次所有要件 | 受入 |
|---:|---|---|---|---|
| 1 | [Spec-01 組み合わせ](SPEC-01-COMBINATION-TESTING.md) | [Checklist-01](CHECKLIST-01-COMBINATION-TESTING.md) | REQ-LX-COMB-*, REQ-LX-CLI-* | AC-LX-001〜005, 013 |
| 2 | [Spec-02 Signal/LLM](SPEC-02-SIGNAL-LLM-SCOUTING.md) | [Checklist-02](CHECKLIST-02-SIGNAL-LLM-SCOUTING.md) | REQ-LX-SIG-*, REQ-LX-LLM-* | AC-LX-006〜008 |
| 3 | [Spec-03 調査・証跡](SPEC-03-INVESTIGATE-EVIDENCE.md) | [Checklist-03](CHECKLIST-03-INVESTIGATE-EVIDENCE.md) | REQ-LX-INV-*, REQ-LX-EVD-* | AC-LX-009〜012, 014 |

受入の分母、fixture、real/mock資格、artifact条件は[拡張評価仕様](EVALUATION-LAKDA-EXTENSION.md)を正本とする。実装のPlan/Patch/Tests/Commands/Notesは[拡張実装計画](../../IMPLEMENTATION-PLAN-LAKDA-EXTENSION.md)に集約する。

## 共通規約

- Mustは対応phaseの受入に必須、Shouldは後続phaseで実装可能とする。
- 未知schema version、未知ref、未対応capabilityの暗黙変換・暗黙fallbackは禁止する。
- fixture/mockは補助証跡であり、real必須受入を完了扱いにしない。
- Lakdaの証跡境界はHATE/v1 manifestまで。QEGのrecord、verdict、approval、waiverは生成しない。
- 各仕様書はObjective、Scope、Requirements、Plan、Patch、Tests、Commands、Notesを持つ。

## ライフサイクル

draft -> review-ready -> approved。対応ChecklistのAが完了したときreview-readyとし、ownerレビューとTask Seed生成後にapprovedとする。ChecklistのB/Cは実装・受入証跡取得後だけ更新する。
