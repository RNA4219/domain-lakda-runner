---
document_id: LAKDA-VERIFY-REPORT-LANGUAGE-20260911
status: local-verified
last_updated: 2026-09-11
specification: SPEC-01-REPORTING.md
checklist: CHECKLIST-01-REPORTING.md
---

# 日本語・英語のレポート出力

2026-09-11のユーザー指示に基づき、生成時に日本語・英語を選べるようにした。既定値は日本語。`--report-language ja|en`は通常run、replay、explore run／resume、report generateで共通に使える。設定ファイルの`language`も受け付け、CLI、設定ファイル、日本語の順で決定する。不正値と重複指定は拒否する。

HTMLのlang、タイトル、見出し、操作ボタン、詳細、画像・動画の案内を切り替える。保存済みのメッセージ、履歴の名称、ID、判定コードは原文を保持する。外部の翻訳サービスや画面内の言語切替は追加せず、変更したい場合は別の出力先へ再生成する。言語指定を持たない旧viewは日本語として扱い、旧bundleの照合結果を維持する。

## 検証結果

対象HEADは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、未commitの変更を含む。Windows、Node 24.11.0／npm 11.6.1によるローカル検証であり、宣言された固定runtimeでのリリース受入ではない。

| 確認 | 実結果 | ローカル記録 |
|---|---|---|
| 設定・初期HTML・viewerの先行テスト | 未実装による失敗を確認してから実装 | `.lakda/report-language-config-red.log`、`report-language-bundle-red.log`、`report-language-viewer-red.log` |
| `npm run check` | docs／typecheck／lint／build成功、全564件pass | `.lakda/report-language-check-20260911.log`、同`.meta.json` |
| offline `npm run pack:check` | 592 files／65 schemas、隔離install・import・CLI成功 | `.lakda/report-language-pack-20260911.log`、同`.meta.json` |
| 配布物からの言語指定 | 英語の再生成、日本語の既定値、HTMLと保存viewの言語を確認 | 同上 |
| 旧bundle verify | valid、7 files、96,879 bytes | `.lakda/report-language-legacy-verify-20260911.json` |
| 日本語・英語のサンプル生成とverify | 両方valid、元のfailed結果を保持 | `.lakda/report-language-preview-ja-20260911.verify.json`、同`en`版 |

全体checkはUTC 03:04:04〜03:08:13、package検査は03:09:25〜03:10:04に実行した。全体check後のsource変更はコメント1行のみで、package検査のbuildに含む。その他は確認記録の追記である。

自動テストはCLI・設定の優先順位、無効な指定、通常run／replayと探索の自動生成、保存済みrunからの再生成、元の件数・メッセージの維持、旧HTML互換を確認した。viewerでは英語のfilter・詳細・ページ送り・timezone・focus復帰、日本語原文の保持、両言語の媒体参照・拡大・表示不能時の案内、外部HTTP通信なしを確認した。

Playwrightが保存した英語のdesktop／mobile画像と、195 CSS pxの媒体画像を目視した。長いボタン名は2行へ折り返し、画像の表示幅100px以上を確認した。狭幅の英語拡大ボタンは約66pxの高さになるため、英語の検査値を読みやすい2行に対応した72px以下とした。日本語の64px以下と既存CSSは維持した。画像は`test-results/report-viewer-English-repo-5f480-le-preserving-recorded-text/`と`test-results/report-viewer-offline-medi-dc633-reports-decode-failures-en-/media-narrow.png`に保存した。これは自動テストの表示確認であり、今回の手動ブラウザ起動や指定Chrome／Edge全条件の再受入を意味しない。

途中のCLI比較テストでは片方だけtext-only指定がなく、媒体除外数が異なって失敗した。両方を同じ条件に修正し、最終564件で成功した。途中ログは`.lakda/report-language-output.log`と`report-language-viewer-complete.log`に保持した。

## 表示サンプル

- 日本語: `.lakda/report-language-preview-ja-20260911/index.html`
- 英語: `.lakda/report-language-preview-en-20260911/index.html`

両方とも保存済みの人工入力から生成した画像・動画付きサンプルで、実機の試験結果ではない。入力にcoverageがないため生成状態は`degraded`、理由は`coverage-unavailable`、生成exitは2となる。これは言語選択によるエラーではなく、元の入力状態を保持した結果である。

## 記録のSHA-256

実装、schema、test、package検査の20 fileを`.lakda/report-language-source-hashes-20260911.json`へ記録した。

| 記録 | SHA-256 |
|---|---|
| source hash一覧 | `8ffc9beb364914afbd6f4203bd4c6bd351892c39200359705c251028b61840b4` |
| 全体check log | `58b8d9d6ae5fcdfe21b2aced892e467dfa526b29fdba34383d54a69e34af7a16` |
| package log | `deaada6c54fc8c7d2aff89d2fe8b3c3d187fc8513e7954ee8c79c570d51ffddd` |
| 旧bundle verify | `1e4cd622335a321b7519e2ac24ca0f1fd1f71824acc15332fce25d4a3f86b307` |
| 日本語sample verify | `db54d613ecaa0e267b23884d66e67f22031ea5aafdae7228144a59e2bbb17ebd` |
| 英語sample verify | `c88df78bb062aebaa7744619596b28116d1ece9b18887a9ebfee709456e245e7` |

言語選択の実装とローカル検証を完了した。比較・開発用テスト集約・レポート履歴管理の保留、実機・固定revisionでの全条件受入の状態は維持する。
