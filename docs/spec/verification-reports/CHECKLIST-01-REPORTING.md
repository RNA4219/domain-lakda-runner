---
document_id: LAKDA-CHK-UP-01
status: active
last_updated: 2026-09-11
specification: SPEC-01-REPORTING.md
---

# Checklist 01

対応[仕様](SPEC-01-REPORTING.md)。期待結果と必要証跡は[全体AC](../../proposals/20260910-detailed-checklist.md)を参照する。

- [x] [実操作の指摘2点](TOUCH-FIXES-20260911.md): 失敗手順・前後移動・100件の境界で履歴一覧が追従すること、日英の状態表示名・filter・検索と元codeの保持を確認した。関連15件・全581件がpassし、Chromeの実操作でも確認した。

2026-09-11のユーザー指示により、比較・開発用suite集約・レポート履歴管理は保留。今回の確認は、終了後のHTMLで概要・失敗理由・保存済み画像や動画を確認する基本操作と安定性を中心に行う。下記の固定revision・全条件の受入とは区別して実結果を記録する。

- [x] [基本レポートの仕上げ](BASIC-REPORT-20260911.md): 保留方針と利用手順を整理し、狭い画面で媒体が細くなる問題を修正した。先行失敗、修正後559件、Chrome／Edgeの媒体40ケース、移動後のbundle verifyを記録した。以下の全条件受入チェックは維持する。

以下のAC完了チェックは、対象revisionを固定した全条件の受入を表す。個別のローカル実装・fixture試験の進捗は[Task 64](../../tasks/TASK.20260910-64.md)／[Task 65](../../tasks/TASK.20260910-65.md)、最終ログは[Task 69](../../tasks/TASK.20260910-69.md)へ記録する。

最大件数の媒体なしcorpusと指定Chrome／Edge・100%／200%の16条件は[local測定](PERFORMANCE-20260910.md)でpass。容量の全境界・媒体の全操作条件・固定SHAの証跡が揃うまではAC-UP-019／020全体を完了扱いにしない。

後続の[媒体40ケース](MEDIA-ACCEPTANCE-20260910.md)で画像の実寸拡大・キー移動、参照対応、share除外、動画位置保持／停止、decode fallbackを確認した。自動検査と手動受入の範囲を記録し、AC全体の完了状態は維持する。

[検査済み画像への対応付け](ATTESTATION-MEDIA-LINKS-20260910.md)は関連30件、全体439件、配布物521 files／55 schemasでlocal検証した。署名済みの元媒体参照、履歴・finding・event、曖昧さと機密区分、bundleの双方向参照を確認した。固定SHAの全条件受入は未完了であり、以下のACチェックは維持する。

- [x] 対象要件、module、I/O、既存互換境界を仕様へ固定した。
- [x] セルフレビューの設計指摘を反映した。
- [x] [UI調整](UI-ADJUSTMENT-20260911.md)後の概要・補足情報の開閉・メッセージの一覧表示と詳細全文・閉じる操作を日英で確認した。狭幅の折返し・媒体操作・focus復帰と結果未確定表示を維持した。
- [x] [UIR-01](UI-REVIEW-FIXES-20260911.md): 200%の狭幅でも動画の再生・一時停止・シークへ通常のボタン操作で到達できることを自動検査と保存画面で確認した。
- [x] [UIR-02](UI-REVIEW-FIXES-20260911.md): 資料不足の理由を生成状態の近くに示し、実行の警告件数との違いを説明した。
- [x] [UIR-03](UI-REVIEW-FIXES-20260911.md): 詳細の画像・動画へ直接移動でき、履歴の対応付け・focus復帰を確認した。配置は後続AR-03で更新した。
- [x] [AR-01](AIRTEST-ADJUSTMENT-20260911.md): 保存された操作・対象・元status・時間・判定messageを投影し、実行済みと合格、未取得を区別した。旧viewとの互換性と曖昧な候補の拒否を確認した。
- [x] [AR-02](AIRTEST-ADJUSTMENT-20260911.md): 失敗手順への移動・前／次・解除を追加し、100件の境界、媒体なし手順、動画の位置保持／停止とfocus復帰を確認した。
- [x] [AR-03](AIRTEST-ADJUSTMENT-20260911.md): PCで手順と画像を並べ、狭幅で縦に表示した。補足は折り畳み、未完了状態・未検査・欠落理由は初期表示に残した。日英の保存画面とChrome／Edgeの100%／200%で確認した。
- [x] [利用フロー](USER-FLOW-20260911.md): 既存参照アプリへの別process CLI実行から正常／失敗・自動生成・日英再生成・verify・画像の原寸表示・録画再生まで確認した。過去の保存runも再生成・閲覧した。
- [x] [UF-01](USER-FLOW-20260911.md): 対応媒体のない手順から、選択を維持して全体証跡を開ける。未確認の対応を明示し、前／次で手順別表示へ戻ることと動画停止・位置保持を確認した。
- [x] [UF-02](USER-FLOW-20260911.md): Windowsの長い保存先で画像が読めない制約を記録し、実画像decodeの検査と短い保存先の案内を追加した。長いパスでのブラウザ表示自体は未対応のままとする。
- [x] [表示言語`ja|en`](REPORT-LANGUAGE-20260911.md)の既定値・設定・CLI優先順位・自動生成・再生成・不正指定の拒否を確認した。HTMLのlangと初期文面、一覧・詳細・媒体・欠落表示を確認し、元メッセージと旧bundleの互換性を維持した。
- [ ] AC-UP-011を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-012を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-013を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-014を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-015を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-015のMEDIA-01〜06と参照解決を確認した。adapter／HATE IDの違い、完全参照の照合、無関係run・曖昧参照・欠落・非媒体・restricted・profile除外を含む。
- [ ] 署名済みsource→sanitized outputの対応を履歴・finding・eventへ解決し、誤ったsize／digest、曖昧さ、未検証署名、別source、機密区分の引下げを拒否した。
- [ ] 項目と媒体の双方向参照・所属をbundle verifyで検査し、run全体の一覧と履歴選択で同じ媒体を確認できた。
- [ ] 画像拡大の実寸・原寸以上の幅、画像枠内の矢印キー移動、縮小時のfit／focus復帰を195 CSS pxでも確認した。
- [ ] AC-UP-016を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-017を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-018を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-019を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-020を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-021を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] 媒体なし／textOnlyのnative v2もoperator trustと保存観測を検証し、未完了予定・応答不明はdegraded、不正・記録欠落・途中更新は入力errorになる。
- [ ] 対応Taskの実装完了を検証し、未実施外部項目を明示した。
