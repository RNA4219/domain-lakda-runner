# レポート実操作の指摘2点への対応

2026-09-11、保存済みの参照アプリ実行レポートをChromeで操作して見つかった2点を対象とする。対応仕様は[SPEC-01](SPEC-01-REPORTING.md)、確認項目は[Checklist 01](CHECKLIST-01-REPORTING.md)、作業範囲は[Task 65](../../tasks/TASK.20260910-65.md)。

| 指摘 | 修正内容 |
|---|---|
| 失敗手順へ移動しても左の一覧が追従せず、選択行が画面外に残る | 選択時に該当行を一覧内へスクロールし、選択内容へfocusを移す。前／次と100件のページ境界でも同じ処理を使う。 |
| 日本語画面の`failed`と`failure`が分かりにくい | 「実行失敗」と「失敗項目」に分け、英語は`Execution failed`と`Failure item`にする。概要・一覧・詳細・filterで表示名を揃え、同じbadgeの重複を除く。表示名と元codeのどちらでも検索できる。 |

保存JSON、状態filterの値、テスト結果の判定は変更しない。生成済みbundleも上書きしない。

## 検証

- 修正前に追加した日英4ケースは失敗した。履歴の100件目はviewport内の表示率0、状態の選択肢は元codeのままだった。ログ: `.lakda/touch-fixes-red-20260911.log`。
- 初回の修正後は、端数pxによる表示率0.994と、表示名の追加で曖昧になった旧テストのlocatorを調整した。選択行は99%以上の表示を要求し、概要の件数ラベルは`term`へ限定する。先行結果は`.lakda/touch-fixes-green-20260911.log`へ保持した。
- `tests/report-viewer.spec.ts`の15件がpass（20.6秒）。日英の表示名選択・表示名／元code検索、#101から#100へのページ移動と#99／#100の前後移動、画像、狭幅、動画、focusを確認した。ログ: `.lakda/touch-fixes-green2-20260911.log`（SHA-256: `5a0770d10716d365f7fd2e3f95efad3f95cff05aa4f23020e21fa7083796c6bc`）。
- `npm run typecheck`と`npm run check`がpass。全体は581件（4.2分）、docs・型・lint・buildも成功。ログ: `.lakda/touch-fixes-typecheck-20260911.log`、`.lakda/touch-fixes-check-20260911.log`。
- 保存済みの参照アプリrun（`.lakda/report-user-flow-verified-20260911/failed/input-run`）から日英を再生成し、どちらも8 filesでbundle verifyがvalid。ChromeのComputer Use実操作で、日本語の「失敗項目」への絞り込み、失敗した#4の一覧内表示、#3／#4の移動、画像の表示、英語の`Execution failed`／`Failure item`検索を確認した。実操作の画面とAX結果は本作業スレッドに保持し、確認用のloopbackプレビューは終了した。

| 再生成レポート | Manifest SHA-256 |
|---|---|
| `.lakda/touch-fixes-ja-20260911` | `636eaa3f08346e62a110301b874197953a7ea3393fa2a2083046ef9df49bd7dc` |
| `.lakda/touch-fixes-en-20260911` | `0a1c2b794de2e40c11ca438e4088ecbecd8457c025ebd1192ca5b90d53a5f722` |

検査対象の`src/reporting/viewer-client.ts`はSHA-256 `e3e4ccb17826b1929ed4ea28d96cfa462d5fd7eae1994679b6cff4f833e1187d`、`tests/report-viewer.spec.ts`は`beb4f1896dfc4cde7a17fd25c9d7fc6e06c273e8e47d6bd9e9cf9d83868d3ffc`。

本記録はローカルのレポート操作確認であり、普段の実target・実機・リリース受入を表さない。
