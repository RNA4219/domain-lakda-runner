---
task_id: TASK.20260910-62
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md
status: in_progress
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-11
---

# Task Seed: Python bridge実行テスト・CI・依存検証

## Objective

対象仕様: [実装仕様](../spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)。

Python bridge実行テスト・CI・依存検証を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-02。

## Scope

対象path:
- `tools/airtest-poco-bridge/**`
- `tests/python/**`
- `tests/airtest-poco-bridge-contract.spec.ts`
- `scripts/run-python-tests.mjs`
- `scripts/check-package-contents.mjs`
- `schemas/lakda-bridge-dependency-verification-v2.schema.json`
- `package.json`
- `package-lock.json`
- `.github/workflows/ci.yml`
- `.gitattributes`
- `release-profiles/current.json`

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

要件案0.1.4のAC-UP-002を追加対象とする。module／class fixture error、expected failure、unexpected success、subtest後続skipの結果記録を先行テストで固定し、JSON／JUnit・終了codeの整合を検証する。依存検証は必要packageのlock一致・欠落・version差・曖昧さとvendored distributionを人工入力で照合し、既存clean venvで実際のversion／import結果を新規記録する。

2026-09-11の全体試験で、Content-Length=0の拒否応答を読む途中に接続切断を検出した。ヘッダーだけで拒否されるcaseでもfixtureが余分な本文を送っていたため、Content-Type／Origin／Content-Lengthの拒否caseは本文なしで送信する。JSON・UTF-8・非objectの本文検査は実本文を送る既存caseで維持し、HTTP statusとdispatch 0件の期待値を緩めない。失敗ログを保持し、修正後のPython suiteを別出力先へ記録する。

直接Pythonを実行してcacheが存在する環境でも、bridge配下の`.npmignore`で`__pycache__`／`.pyc`／`.pyo`を配布から除外する。package checkerにも拒否条件を置き、cacheを削除したclean作業環境だけで合格させない。

## Commands

`npm run check:docs`、`npm run typecheck`、変更領域のtest、必要に応じて`npm run check`／`npm run pack:check`、`git diff --check`。

## Evidence

- 2026-09-11の[追加検証記録](../spec/verification-reports/NATIVE-IDENTITY-EVIDENCE-20260911.md): ヘッダー拒否fixtureの不要な本文送信を除去し、Python138件（failure／error／skip 0）とHTTP5件の5回実行がpass。packageへのPython cache混入を先行検査で拒否し、`.npmignore`適用後はcacheを残した作業環境でも561 files／62 schemas、隔離installがpass。固定SHA・CI・他host matrix・実機受入は引き続き未完了。

- 基準b027b6b＋本Taskのdirty差分。bundled Python 3.12.14／win32で`npm run test:bridge:python -- --python <明示runtime>`: 23 tests、failure 0、error 0、skip 0。`.lakda/qa/python/summary.json`と`junit.xml`を生成した。
- 先行testで撮影途中例外・保存frame欠落・stop backend欠落を再現し、修正した。同sizeのframe差替えも拒否する。
- 同時stopの二重backend呼出しと非object／不正JSONの受付を追加testで再現し、busy拒否とHTTP 400の検証へ修正した。
- `tests/airtest-poco-bridge-contract.spec.ts`: 8/8 pass。新実行wrapperのESLint pass。
- 後続の保全testで保存済み媒体上書き・別run競合・staging差替え・discardで別種媒体削除を再現し、修正した。subtest失敗のcase集計も確認し、最新のPython suiteは30 tests、failure 0、error 0、skip 0。bridge TS契約8/8もpass。
- Windows／AMD64／Python 3.12.14向けhash付きlockをuv 0.10.10で解決した。最初のclean importのdistutils欠落を修正し、空venvで再install（exit 0）、7 imports pass（exit 0）。[matrixと実測](../../tools/airtest-poco-bridge/RUNTIME-MATRIX.md)、[import証跡](../../tools/airtest-poco-bridge/compatibility/windows-amd64-py312-20260910.json)。
- CIへPython 3.13 fixtureとPython 3.12.14 dependency検証jobを追加した。GitHub上の実行結果、他host matrix、実機受入は未取得。requiredChecksへの統合はTask 69で実施するため、このTask全体はin_progressを維持する。
- 要件案0.1.4とセルフレビューSR-30／31に従い、Python結果記録と依存version照合を実装した。[実行・source・digestの記録](../spec/verification-reports/PYTHON-VALIDATION-20260910.md)に、先行失敗と修正後の検証範囲を整理した。最新Python suiteは48 tests、failure 0、error 0、skip 0、exit 0。
- dependency v2は43 packageのlock一致と7 imports passを記録し、import-onlyの旧v1を保持した。対応schema、package必須file検査、既存証跡の上書き拒否を追加した。npm全体checkは359 tests pass、packageは469 files／51 schemas、隔離install検証pass。tgzから抽出したPython verifierでも43 package／7 importsの検証が通った。通常skipの独立件数追加後にPython48件を再実行した。

## Notes

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。
