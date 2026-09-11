---
task_id: TASK.20260910-63
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/SPEC-03-GOVERNANCE.md
status: done
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-10
---

# Task Seed: catalog・文書checker責務分割

## Objective

対象仕様: [実装仕様](../spec/verification-reports/SPEC-03-GOVERNANCE.md)。

catalog・文書checker責務分割を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-03。

## Scope

対象path:
- `src/runs/**`
- `src/core/artifact-store.ts`
- `scripts/check-docs.mjs`
- `scripts/docs-checks/**`
- `tests/runs.spec.ts`
- `tests/docs-checks.spec.ts`
- `tests/report-reader.spec.ts`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- [Task 61](TASK.20260910-61.md)

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

- catalogの値／参照validation、graph／coverage、reader、comparisonを別moduleへ移動し、公開catalog.tsを49行のfacadeへ縮小した。関数本体は移動時に保持した。
- 変更前と分割後に`tests/runs.spec.ts`を実行し、順序／上限、比較、metadata検査、tamper、traversal、version拒否の7件がpassした。
- 共通artifact／manifest readerを追加した。媒体を保持せず64 KiB単位でhash照合し、明示選択textだけ保持する。総量／text予算・AbortSignal・読取中更新を検査し、catalogのredaction／scan拒否条件はcaller policyとして維持する。
- 文書checkerを共通Markdown、v1、schema registry、adaptive、extension、maintainability、release profile、Birdseye、UP追跡へ分割した。各moduleはroot／read interfaceを受けdiagnosticを返す。UPは定義一意性、Must→AC、仕様／checklist対、Task→仕様を検査する。
- `tests/runs.spec.ts tests/report-reader.spec.ts tests/docs-checks.spec.ts`: 22/22 pass。既存catalog 7件、reader 6件、独立文書fixture 9件。`npm run check:docs`、`npm run typecheck`、変更領域ESLintはexit 0。
- 対象は基準`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`＋dirty差分。Task 63の局所実装は完了し、固定SHAの統合GateはTask 69で別途取得する。

## Notes

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。
