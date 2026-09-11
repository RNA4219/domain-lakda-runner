---
document_id: LAKDA-VERIFY-REPORT-UI-20260911
status: local-verified
last_updated: 2026-09-11
specification: SPEC-01-REPORTING.md
checklist: CHECKLIST-01-REPORTING.md
---

# 基本レポートのUI調整

2026-09-11のユーザー指示に基づき、白基調の配色、余白、文字の優先順位、一覧と詳細の読みやすさを調整した。変更は`src/reporting/renderer.ts`と`viewer-client.ts`に限定し、保存データ、集計、出力言語の選択、HTML文書の互換契約を維持した。

- 概要の合否と主要件数を先に表示し、操作件数・実行時間などは開閉できる領域へまとめた。結果未確定runと未完了workerがある場合は、折りたたまず表示する。timezone変更後も開閉状態を保つ。
- 絞り込み欄の幅を揃え、PCでは4列、狭い画面では2列または1列へ折り返す。既存のAND条件、全解除、表示順、キーボード順序を維持する。
- 結果一覧に保存メッセージを最大2行で表示する。詳細はメッセージを全幅で先に表示し、全文を保持する。入力中のHTML表記を文字として表示する既存境界を維持する。
- 詳細の閉じる操作を白い固定バーにまとめた。下までスクロールしても閉じることができ、元の結果行へfocusが戻る。

## 表示確認と修正経緯

日英それぞれに、主要結果へ到達できること、補足情報のキーボード開閉、timezone変更時の状態維持、一覧と詳細の原文保持、長文・狭幅、閉じる操作とfocus復帰を確認するテストを先に追加した。1366×900pxの初期表示では最初の結果行の下端が1,093.3pxにあり、2件とも失敗した。調整後は900px以内に収まり、補足情報を必要時に開く構成になった。

初回の調整後は下端904.5pxで基準を満たさず、ヘッダーと注意書き周辺の余白を再調整した。表示関連7件、全体566件、Chrome／Edgeの媒体40ケースが通った。その後200%の画面画像で閉じるボタンの背後に本文が見える重なりを確認し、白い固定バーへ修正した。最終の表示関連7件は再度成功した。

目視した画面は`.lakda/report-ui-layout-20260911/results/`配下の日本語PC概要・英語mobile概要と、`.lakda/report-ui-final-20260911/results/`配下の最終の英語mobile詳細・195 CSS pxの媒体表示。自動テストが保存した画面画像の確認であり、手動ブラウザ起動や実targetの受入ではない。

最終の`npm run check`はUTC 04:02:32〜04:06:51に実行し、docs／型／lint／buildと全566件が成功した。続く04:06:51〜04:07:40の媒体確認はChrome 152.0.7977.83／Edge 152.0.4191.66、1366／390px、100%／200%の8条件40ケースが成功した。全条件で外部HTTP requestとpage errorは0件。画像の拡大・縮小、履歴の選択とfocus、動画位置の保持・停止、表示不能時の案内を確認した。

## ローカル記録

対象HEADは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、未commitの変更を含む。Windows、Node 24.11.0／npm 11.6.1で実行した。

| 確認 | 記録 |
|---|---|
| 先行失敗 | `.lakda/report-ui-red-20260911.log` |
| 初回調整の失敗 | `.lakda/report-ui-green-20260911.log` |
| 固定バー修正後の表示7件 | `.lakda/report-ui-final-20260911.log` |
| 最終の全体check | `.lakda/report-ui-check-final-20260911.log`、同`.meta.json` |
| 最終のChrome／Edge媒体確認 | `.lakda/report-ui-media-final-20260911/result.json` |
| 以前の日本語レポートのverify | `.lakda/report-ui-legacy-verify-20260911.json`（valid、7 files） |

日本語・英語の新しい表示サンプルは`.lakda/report-ui-preview-ja-final-20260911/index.html`と同`en`版。双方のbundle verifyは成功した。画像・動画を含む人工入力で、実機の試験結果ではない。元入力にcoverageがないため生成状態は`degraded`、理由は`coverage-unavailable`である。

最終sourceとtestの3 fileのhashは`.lakda/report-ui-source-hashes-final-20260911.json`に保存した。hash一覧のSHA-256は`de255581b08228a1fb368c6f47395e2f6aa0900fd31f275819de477f211c6a87`、表示7件のlogは`700674c8af39952f20c3493220587fc355e7f0a4164f2bfea38b8a635e8164f6`。

| 最終記録 | SHA-256 |
|---|---|
| 全体check log | `18200e5f3209ef41e48d7a264d5666585a00c601d07f0a995841af9c5450ab37` |
| Chrome／Edge媒体結果 | `c3b22a5b65ee5bd4e7a015a56f574e6b5c8634a420913f620f3c08740c2fec3a` |
| 日本語sample verify | `6b7177c64009b914ddaf9171b8d4f7df0d3d51063af2c5be9098799ba003ea9e` |
| 英語sample verify | `2543ea4f094ffdb68037e045675dadb9ef317d273091d53497518d3fd3c0341e` |

比較・開発用テスト集約・履歴管理の保留、実機・固定revisionでの全条件受入の状態は維持する。Pythonと配布パッケージの検査は今回の表示調整では再実行していない。
