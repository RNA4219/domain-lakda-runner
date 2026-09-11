---
task_id: TASK.20260910-66
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/SPEC-03-GOVERNANCE.md
status: in_progress
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-10
---

# Task Seed: Legacy P6履歴化・M1受入記録

## Objective

対象仕様: [実装仕様](../spec/verification-reports/SPEC-03-GOVERNANCE.md)。

Legacy P6履歴化・M1受入記録を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-03。

## Scope

対象path:
- `.github/workflows/release-p6-rc.yml`
- `.gitattributes`（履歴workflowの改行を含む元bytes保持）
- `docs/release-gate/history/**`
- `docs/release-gate/README.md`
- `docs/proposals/20260910-improvement-requirements.md`（archive後の参照先更新）
- `docs/spec/verification-reports/SPEC-03-GOVERNANCE.md`
- `scripts/docs-checks/release-profile.mjs`（旧workflow再導入・履歴改変の検出）
- `tests/docs-checks.spec.ts`（上記checkerの独立fixture）
- `README.md`
- `RUNBOOK.md`
- `docs/acceptance/**`
- `docs/tasks/TASK.20260802-59.md`
- `docs/tasks/TASK.20260802-60.md`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- [Task 62](TASK.20260910-62.md)
- [Task 65](TASK.20260910-65.md)

旧workflowの履歴化と再導入検査は独立して先行する。M1受入記録・Task 59／60の完了照合は上記Taskの残作業と固定SHA検証を待ち、履歴化だけでこのTask全体をdoneにしない。

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

- `.github/workflows/release-p6-rc.yml`を[履歴](../release-gate/history/README.md)へ退避した。元fileの2,631 bytesとSHA-256 `afdd0092f07960f002eaf474a1029e88486112a02457729f5d7f4b9653178cba`がコピー前後で一致したことを確認してから元pathを除去した。元revision・最終変更commit・Git blobと改行情報を記録し、archiveは`-text`で改行変換を止めた。
- `npx playwright test tests/docs-checks.spec.ts tests/release-profile.spec.ts --workers=1`: 11件pass。旧workflow再導入、archive欠落、1byte以上の内容変更、live workflow内のP6納品契約を独立fixtureで検出した。checker修正前のREDを確認してから実装した。
- `npm run check:docs`、`npm run typecheck`、`npm run lint`、`npm run release:validate-profile`: exit 0。current profileは`lakda-0-5-0-rc-1`でvalid。live workflow内のP6納品契約は0件で、既存Acceptance、QEG、現行release-evidence.ymlへの差分は0件。
- 履歴化後の全体`npm run check`も335 testsまでpass（exit 0）。[Task 69](TASK.20260910-69.md)へ統合検証を記録した。
- 対象はbase revision `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`＋dirty差分。履歴化のローカル検証であり、M1の固定SHA受入やTask 59／60の完了照合は未完了のため、Taskはin_progressを維持する。

## Notes

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。
