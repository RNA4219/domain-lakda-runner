---
task_id: TASK.20260910-61
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/README.md
status: done
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-10
---

# Task Seed: 仕様正本化・セルフレビュー

## Objective

対象仕様: [実装仕様](../spec/verification-reports/README.md)。

仕様正本化・セルフレビューを[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-01／02／03。

## Scope

対象path:
- `docs/spec/verification-reports/**`
- `docs/proposals/**`
- `docs/spec/README.md`
- `docs/tasks/**`
- `docs/README.md`
- `HUB.codex.md`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- 2026-09-10のユーザーによる仕様化・セルフレビュー後の実装指示。

## Plan

1. 対象仕様・checklistを読み、変更前の関連testと状態を確認する。
2. 意味変更はtestで期待値を先に固定する。source変更は原則2fileまたは100行の小さいループで進める。
3. 関連test、型・lint、必要な統合／package検証を実行する。
4. 実結果をEvidenceへ記録し、未取得の外部条件はpending_externalとして残す。

## Patch

対象moduleの責務内で実装し、既存5 mode、stdout／exit、HATE／QEG境界を維持する。分割と機能追加は別変更単位にする。

## Tests

[詳細受入](../proposals/20260910-detailed-checklist.md)と対応仕様checklist。実機が必要なcaseはfixtureで代替しない。

## Commands

`npm run check:docs`、`npm run typecheck`、変更領域のtest、必要に応じて`npm run check`／`npm run pack:check`、`git diff --check`。

## Evidence

- 仕様3件、対応checklist3件、セルフレビューSR-01〜08を作成した。runtime受入は後続Taskで行う。

## Notes

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。
