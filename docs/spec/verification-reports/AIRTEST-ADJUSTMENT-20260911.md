---
document_id: LAKDA-VERIFY-REPORT-AIRTEST-ADJUSTMENT-20260911
status: active
last_updated: 2026-09-11
---

# 手順と画像を追うためのUI調整

[Airtest基準レビュー](AIRTEST-REVIEW-20260911.md)のAR-01〜03に対応した。操作・判定の情報を補い、失敗した手順と前後へ移動できるようにし、PCの詳細画面で手順一覧と選択した内容・画像を並べた。グラフやレポート管理の追加は行っていない。

## 変更と確認範囲

| 指摘 | 変更 | 確認内容 |
|---|---|---|
| AR-01 | 任意の`timeline.step`へ操作・対象・元status・所要時間・messageを投影。既存labelは保持 | 保存済みexecution／oracleを使用し、`executed`と`pass`を区別。候補IDが欠落・競合・未来の場合は説明を推定しない。同じ候補の重複は受け付ける。通常actionの入力値・locator全体は転記しない |
| AR-02 | 最初の失敗手順へ移動、前／次、履歴選択の解除を追加 | 100件のページ境界をまたいで#101→#102→#101→#100を確認。媒体のない手順も選択可能。旧labelに`fail`を含むだけでは失敗と扱わない。動画の停止・位置保持とfocus復帰を維持 |
| AR-03 | PCは左右配置、狭幅は縦配置。判定messageを優先し、技術情報・媒体の補足は開閉式 | 日英の1366×900／1366×768、390×844／195×422を保存。PCの失敗選択直後に画像の90%以上がviewport内に入り、幅350pxを超えることを検査。狭幅の横overflow、画像拡大・縮小、未検査・欠落の表示を確認 |

未取得statusは「未取得」と表示し、`candidate`／`confirmed`を失敗に変換しない。媒体の関連付けを推測せず、保存された参照で絞り込む。媒体の検査状態は画像の近くに残し、利用できない媒体の理由は初期表示する。利用可能な媒体の所属・検査の根拠は「媒体の詳細」で開く。

## 画面を見て調整した点

- 初回のPC画面では画像の約39%しか見えなかった。技術情報を折り畳み、選択手順の見出しと画像を同じ領域へ置いた。
- 1366×900で通った後、1366×768を追加すると画像が下にはみ出したため、画像の初期高さを画面高へ合わせた。拡大時は元の画素を確認できる。
- 195 CSS pxではdialogの既定幅制限と余白が重なり、画像が約87pxへ縮んだ。dialog幅と内側の余白を調整し、既存の最小幅検査も通した。
- 新しい開閉配置に合わせ、coverage・媒体の検査根拠を開く既存テストを更新した。履歴から媒体の欠落理由が消えた回帰も修正した。
- 全体検査でworkerの「実行未完了」「確定済みrunなし」が折り畳まれる問題を検出した。これらとrunの「未確定」は初期表示に戻し、[保存画面](../../../.lakda/report-steps-final-ui2-20260911/results/report-runtime-all-workers-b21e7-e-a-diagnostic-batch-report/worker-status.png)を確認した。

日本語の[PC画面](../../../.lakda/report-steps-final-ui2-20260911/results/report-viewer-step-workspa-fa09c-ts-screenshot-prominent-ja-/step-desktop-768.png)・[狭幅画面](../../../.lakda/report-steps-final-ui2-20260911/results/report-viewer-step-workspa-fa09c-ts-screenshot-prominent-ja-/step-390.png)、英語の[PC画面](../../../.lakda/report-steps-final-ui2-20260911/results/report-viewer-step-workspa-24bb0-ts-screenshot-prominent-en-/step-desktop-768.png)・[195px画面](../../../.lakda/report-steps-final-ui2-20260911/results/report-viewer-step-workspa-24bb0-ts-screenshot-prominent-en-/step-195.png)を保存した。最初の配置調整後に日英PC・狭幅を目視し、worker状態の復帰後に日本語PC・英語195pxを再確認した。英語出力でも保存された日本語messageや対象名は原文のまま表示する。

生成した人工サンプルは[日本語](../../../.lakda/report-steps-final-ui2-20260911/results/report-viewer-step-workspa-fa09c-ts-screenshot-prominent-ja-/report/index.html)・[英語](../../../.lakda/report-steps-final-ui2-20260911/results/report-viewer-step-workspa-24bb0-ts-screenshot-prominent-en-/report/index.html)。結果の「入力境界」を開き、「失敗した手順へ」から表示を確認できる。

## 検証記録

- 投影・通常履歴・媒体関連の先行検査: 22件pass（`.lakda/report-steps-data-green-20260911.log`）。
- viewer・媒体関連・署名媒体の回帰: 26件pass、16.1秒（`.lakda/report-steps-regression2-20260911.log`）。
- 最終の任意step schema・投影・日英画面・worker未完了・v2検査根拠: 8件pass、5.9秒（`.lakda/report-steps-final-ui2-20260911.log`）。旧stepなしviewの受入、不正な追加field・型・負の時間を拒否することを含む。
- `npm run check`: docs・型・lint・buildがpassし、全577件pass、3.7分（`.lakda/report-steps-check-verified-20260911.log`）。初回は575件pass／2件failであり、worker状態の初期表示とv2媒体の補足を開くテスト操作を直してから全体を再実行した。初回ログは`.lakda/report-steps-check-final-20260911.log`に保持した。
- 指定ブラウザ媒体確認: 8条件40ケースpass（`.lakda/report-steps-media-20260911/result.json`）。Chrome 152.0.7977.83／Edge 152.0.4191.66、1366×768／390×844、100%／200%。通常の媒体5項目に加え、失敗手順への移動、前／次による動画の停止・位置保持・解除focusを各条件で確認した。外部HTTP要求・page errorは0件。全体テストとは同時実行していない。
- 最終日英サンプルとstepなし旧bundleの整合性検査はvalid（`.lakda/report-steps-bundles-verified-20260911.json`）。日英各6 files／124,569・124,506 bytes、旧7 files／112,666 bytes。サンプルの入力は人工データで、画像は未検査として表示する。
- offline `npm run pack:check`: 595 files／65 schemasの構成検査と、隔離install・CLI・report生成の検査がpass（`.lakda/report-steps-pack-20260911.log`）。固定runtimeとの差による`EBADENGINE`警告は残る。最終source記録17ファイルは検証終了後もhash一致を確認した。

| 保存物 | SHA-256 |
|---|---|
| 全体checkログ | `2b0cfc9976b7e6d0cb152443a3f31aac0ffcaffe9e17ded3d7534efa61452ae2` |
| 配布物checkログ | `9362d8e97a2dc0730bc1725ac163ab2d5130e73ed6f1583245a547396d1045da` |
| 媒体40ケースのresult.json | `359e1a74b052860283ab4cfbdb2ebac10ea51258ec54488f2fa5827c7a24c83c` |
| 新旧bundle検査記録 | `a78698f4378bf711dc637929a6a1ae3c067d8fb3acc8e2b9aa3cad1a37b81e20` |
| 最終source記録 | `f69ff26b26384ca281641d0ebe50e6e9db09d7ee88e2a99498cd17b6d879bbd0` |
| 日本語サンプルmanifest | `c8d2b0e6c6cbdc7ddbe2972986ac487925811dada55f74c6d6eaa84e15b74538` |
| 英語サンプルmanifest | `47e48eb49decaa09c160b2a4cdae8b420ab23a6403be0375e48f6d4396cf3730` |

指定ブラウザの保存画面も、ChromeのPC失敗手順（`chrome-1366-1/step-failure.png`）とEdgeの狭幅200%画像（`msedge-390-2/step-next.png`）を目視した。

先行する失敗は`.lakda/report-steps-ui-red-ready-20260911.log`、`report-steps-ui-layout-20260911.log`、`report-steps-ui-height-red-20260911.log`、`report-steps-regression-20260911.log`に残している。成功ログで置き換えていない。

## 証跡の適用範囲

対象はHEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`からの未commit作業tree。今回のsource・schema・tests・受入script計17ファイルのSHA-256は`.lakda/report-steps-source-hashes-verified-20260911.json`に記録した。Node 24.11.0／npm 11.6.1でのローカル検証であり、release profileの固定runtime・固定revision受入とは区別する。

画面操作は通常のプロジェクトテストが生成した新しい人工fixtureを使い、保存画像を目視した。既存レポートへのCUA直接操作は以前のポリシー制限により行っていない。Airtest実機との操作速度や全機能の同等性、native実機受入、manual-bb／QEG Gateを示す記録ではない。
