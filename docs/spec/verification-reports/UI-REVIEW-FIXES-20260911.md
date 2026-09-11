---
document_id: LAKDA-VERIFY-REPORT-UI-FIXES-20260911
status: local-verified
last_updated: 2026-09-11
specification: SPEC-01-REPORTING.md
checklist: CHECKLIST-01-REPORTING.md
---

# 生成レポートのUIレビュー指摘対応

[前回レビュー](UI-REVIEW-20260911.md)のUIR-01〜03を修正した。日本語・英語の表示と通常のボタン操作、保存画面で確認した。runtimeの変更は`src/reporting/viewer-client.ts`と`renderer.ts`。保存データ、集計、媒体の対応付け、言語の選択方法は維持する。

- UIR-01: 320 CSS px以下では動画の再生・一時停止ボタンと再生位置バーを表示する。クリックと矢印キーで位置を変えられる。読込前や時間範囲が不明な場合は位置操作を無効にし、decode失敗時は両操作を無効にする。自動再生は行わず、履歴の切替と詳細close時の停止・位置保持を維持した。
- UIR-02: 資料不足の理由を生成状態の近くに表示し、全件の詳細へ移動できるようにした。件数ラベルは「実行の警告」とし、生成時の不足とは別の集計であることを説明する。元のmessage・code・件数は保持する。
- UIR-03: 詳細に「画像・動画へ」を追加し、媒体の見出しへfocusを移す。画像・動画を履歴とcoverageより前へ配置した。長文と101件の履歴でも直接到達でき、閉じると元の結果行へfocusが戻る。

## 検証と追加修正

日英それぞれの先行テストで、資料不足の案内・移動ボタンの不存在と、動画の位置操作の不存在を検出した。実装後の関連テストは成功した。

Chrome／Edgeの初回媒体確認では、200%で画像を縮小した際のscroll位置が残る問題を検出した。683×384 CSS pxの先行テストで、縮小画像が枠の高さを超えることを再現した。画像の余白を枠側へ移し、縮小時の高さを枠内へ収めるCSSへ修正した。195／683 CSS pxで元のfit幅、枠内への収まり、scroll位置0、focus復帰を確認した。最終の関連21件が成功した。

全体テストと同時実行した媒体確認では、画像修正後もChromeの390px・200%の1件が要素取得timeoutになった。全体テスト完了後、sourceと検査条件を変えずに媒体確認を単独で再実行し、8条件40ケースすべて成功した。timeoutの原因を同時実行と断定せず、失敗記録も保持する。

最終の`npm run check`はUTC 04:38:01〜04:42:16に実行し、docs・型・lint・buildと全571件が成功した。媒体確認はChrome 152.0.7977.83／Edge 152.0.4191.66、1366×768／390×844、100%／200%の8条件。狭幅では実際のボタンクリックとrangeクリック、通常幅では既存のSpace操作と検査用の位置指定を使う。全条件で外部HTTP requestとpage errorは0件だった。

最終の日本語200%動画画面、PC200%画像画面、日英の資料不足案内・媒体への移動後の画面を目視した。Playwrightの自動操作と保存画面による確認であり、手動ブラウザ操作の実証や実機受入ではない。ブラウザ制御で遮断された既存ローカルHTMLの回避経路は使わず、通常のプロジェクトテストで新しい人工入力を生成した。

## 記録と表示サンプル

対象HEADは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、未commitの変更を含む。Windows、Node 24.11.0／npm 11.6.1。release指定runtimeと固定revisionによる受入は別途残る。

| 確認 | 記録 |
|---|---|
| 案内・導線の先行失敗 | `.lakda/report-uir-notice-red-20260911.log` |
| 動画操作の先行失敗 | `.lakda/report-uir-video-red-20260911.log` |
| 縮小画像の先行失敗 | `.lakda/report-uir-image-red-20260911.log` |
| 最終の関連21件・日英画面 | `.lakda/report-uir-final-20260911.log`、`.lakda/report-uir-final-20260911/results/` |
| 最終の全体571件 | `.lakda/report-uir-check-final-20260911.log`、同`.meta.json` |
| 初回・同時実行時の媒体記録 | `.lakda/report-uir-media-20260911/result.json`、`.lakda/report-uir-media-final-20260911/result.json` |
| 最終の媒体40ケース・画面 | `.lakda/report-uir-media-verified-20260911/result.json`と同directoryのbrowser別PNG |
| 最終source／test／検査scriptの5 file | `.lakda/report-uir-source-hashes-final-20260911.json` |

表示サンプルは`.lakda/report-uir-preview-ja-final-20260911/index.html`と同`en`版。双方のbundle verifyはvalid（7 files、日本語112,666 bytes／英語112,627 bytes）。人工入力にcoverageがないため、生成はexit 2／degraded、理由は`coverage-unavailable`となる。入力の失敗結果や実行の警告0件を変更せず、案内を加えた。

| 最終記録 | SHA-256 |
|---|---|
| 全体check log | `4dc4e7a9065614faeb6e4289d3e1950559016aa1aabd2b133990c591191e2e50` |
| 関連21件log | `d2c16a67c95df2efdb195723b53b476a80cfc360a7f1a88981b09455e9ed7e5a` |
| 媒体40ケース結果 | `a9ffbdd032d14e6c166a6e182937b89d8bacc2779f1c6bc9c5b37183b59638e5` |
| source hash一覧 | `f94a7defd888d675e8b9e4bfdd5bdd1015e912605ebee7c48a8e58839c0c6907` |
| 日本語sample verify | `326f648cc66b130718d74cd40e76482be1e2a82839888100e5f1114f9c60476f` |
| 英語sample verify | `a9e5cb98ef400475b790da88b8a9e1c0abd489259a4a8ce882fe42eaf0909d47` |

比較・開発用テスト集約・履歴管理の保留、実機・固定revisionによるAC全体の受入状態は維持する。Pythonと配布packageの検査は今回の表示調整では再実行していない。
