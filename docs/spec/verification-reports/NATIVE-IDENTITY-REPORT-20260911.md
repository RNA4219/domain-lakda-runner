---
document_id: LAKDA-NATIVE-REPORT-20260911
status: local_verified
last_updated: 2026-09-11
specification: SPEC-02-NATIVE-EVIDENCE.md
---

# native保存証跡の署名・HATE・HTMLレポート接続

[仕様01](SPEC-01-REPORTING.md)、[仕様02](SPEC-02-NATIVE-EVIDENCE.md)、[Checklist 01](CHECKLIST-01-REPORTING.md)、[Checklist 02](CHECKLIST-02-NATIVE-EVIDENCE.md)、[Task 68](../../tasks/TASK.20260910-68.md)。初期の7改修・57要件・22受入条件を維持し、今回の変更は保存済みnative証跡の検証とレポートへの接続を扱う。

## 変更とセルフレビュー

保存済みtargetの署名を最初の観測取得完了時刻で検証し、現在の期限切れだけで過去の記録を拒否しない。鍵は明示された一覧またはoperator fileから取得する。fileは128 KiB、鍵は1〜64件・一意ID・Ed25519に制限し、使用前後のbytesを検査する。Charter内のpathはreportのtrust選択に使わない。

内部readerはsession／events／target／Charterの実bytesのdigestと、検証したnative参照を返す。HATE exporterは署名・journal・全参照のpath／size／SHA-256を検証してから公開する。改変された記録を単に新しいHATEへ登録し直す処理を拒否する。

HTML生成はlocal／share・媒体なし・textOnlyでもnative入力を検証する。整合した応答不明・予定未完了は「native操作の結果未確定」とwarningを表示し、生成状態をdegradedにする。署名・観測・一覧の欠落や不一致は入力error。元sessionの技術結果は保存値として保持する。公開直前の再検査で、HATEに載らない孤立fileの追加も拒否する。媒体targetの読取も指定trustでnative証跡を再検証する。

セルフレビューSR-84〜86に、保存時点、信頼元、HATEの改変受理、textOnlyの無検証ready、公開直前のinventory確認を記録した。旧共通loaderとCLI初回／resumeのv2拒否は維持する。

## 検証

基準HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、dirty差分込み。Windows、Node 24.11.0／npm 11.6.1、package 0.5.0-rc.1。宣言runtimeのNode 24.6.0／npm 11.5.1による固定SHAの正式受入ではない。

| 検証 | 結果 | ログ |
|---|---|---|
| 署名・trust・観測の読取 | 4 passed。過去承認、鍵違い／重複／未指定／容量、観測なし、unknown、親signal | `.lakda/native-hate-signed-reader-trust-20260911.log` |
| HATEの先行試験 | 改変記録のexportが成功する旧挙動を検出、1 failed | `.lakda/native-hate-export-red-20260911.log` |
| textOnlyの先行試験 | report trust未指定でもreadyになる旧挙動を検出、1 failed | `.lakda/native-report-trust-red-20260911.log` |
| textOnly修正後 | 1 passed。trust必須、unknownはdegraded、HATEからの記録除去を拒否 | `.lakda/native-report-trust-green-20260911.log` |
| 媒体target・最終再検査 | 1 passed。保存観測時の承認、指定trustの再検証、後から追加した孤立fileを拒否 | `.lakda/native-report-media-final-20260911.log` |
| npm run check | docs・型・Lint・build・全534件 passed、exit 0 | `.lakda/native-hate-report-check-20260911.log` |
| offline npm run pack:check | 567 files／62 schemas、隔離install、signedNativeReportImportと既存report CLIがpass、exit 0 | `.lakda/native-hate-report-pack-20260911.log` |
| package checkerのLint | exit 0 | `.lakda/native-hate-report-package-lint-20260911.log` |

全体検証後の実行code変更はない。配布checkerへ新moduleの必須化・隔離import検査を追加し、Lintとpackで検証した。pack後の変更はREADMEと検証文書。失敗ログを保持し、以前のimmutableな検証記録のhashを書き換えていない。

## 範囲と未完了

一時生成したfixture鍵と人工bridge応答を使い、保存fileからHATE／HTMLまでを検証した。実端末・実SDK・実ADB・scanner・実targetへ接続していない。HTMLと媒体targetの検証は人工保存入力による補助証跡であり、実機受入や新しい媒体scanner署名の実証ではない。

今回Python sourceは変更しておらず、Python試験とHTTP相互運用は再実行していない。前回の138件等は[前回の記録](NATIVE-IDENTITY-EVIDENCE-20260911.md)の証跡として保持する。今回の534件へ合算しない。

CLI初回／resume、Windows／iOS provider、実機3lane、媒体I/Oの残項目、固定SHAでの受入・manual-bb・外部QEGは残る。`complete`は保存記録の整合を示し、操作成功・現在の実行許可・呼出し元への成功通知・実機受入を意味しない。filesystem全体のatomic snapshotや電源断耐久性、強制中断できないI/Oの期限保証も主張しない。

## 対象ファイルのSHA-256

記録作成時の実bytes。source・test・仕様・logの30件を固定する。以後の変更は新しい検証記録へ保存する。

| path | bytes | SHA-256 |
|---|---:|---|
| `src/exploration/native-identity-evidence-store.ts` | 10971 | `ec8ac7a93df750132f3012692d764848bcc69c8dd08db9ff8e7881205aca6f31` |
| `src/exploration/native-identity-evidence-target.ts` | 6725 | `02cd60a86757b6847b362f1d5865bff761f407a916501b9432f8f2cfa7af8b7a` |
| `src/exploration/session.ts` | 46741 | `4f64eafc4bbca2e73da37035bf2df667197b6fb5341628f23f082dafdb934f7c` |
| `src/reporting/native-evidence.ts` | 2871 | `a5df87a8d3d257d4615bf5f0ce9fe76536d3f061c2c61c938d855e7982c3ebd3` |
| `src/reporting/session-snapshot.ts` | 6004 | `d6247927f33e65c0cc30f42cb3a5b5935d6a9d2e3df398a9b4a1a0fd060b9ba7` |
| `src/reporting/session-source.ts` | 6980 | `6a60a059b334adcb53f5a8d845941ec9a5c95749d420cf166acc1d39a914435e` |
| `src/reporting/source-collection.ts` | 7577 | `b95017536bc240f40fec06acb2c2eaab424e894f168754aba366adcd7e9cdba5` |
| `src/reporting/source-verifier.ts` | 3268 | `14edd4585abd8d48f0b4974d8828efb55f23e5ea1824d0f388530955ac5619c7` |
| `src/reporting/generation.ts` | 7158 | `f588158a1e6287cbfd57fc15bb1f4214f01de5bda4d61bb2523cfc475642ba34` |
| `src/reporting/media-target.ts` | 3004 | `46d73fe8e4d8e8514b525e80ad1a08fa1e2606746402c5893c14455d0ac59552` |
| `tests/native-identity-target.spec.ts` | 56586 | `34bcdbe3252c4f4e1fc783de34702cdd2f2fd986fa80c498d838c56a639c288f` |
| `scripts/check-package-contents.mjs` | 5402 | `af06eb8e251bf094cc19eec286dab03e2166865d9004729d195b73e6535f6e28` |
| `scripts/check-package-install.mjs` | 17502 | `69bb7ad298330bae2316e64bd8b228395a1c2f6f6b97351d8da1712fbb44bf68` |
| `docs/spec/verification-reports/SPEC-01-REPORTING.md` | 32537 | `b1fbc1b9f296c881a3eee548c5fe281b5ce14c318fa5c140c865836fd1dbd80b` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 55610 | `a21d5b6df6a0b9efda3b8a024522cbcde8289412e680765f3d894680316eb494` |
| `docs/spec/verification-reports/CHECKLIST-01-REPORTING.md` | 3689 | `6f8ccb44fad071a3dfc544cfaec2e306b4e3460587dbdcc8d655ddcd0100b521` |
| `docs/spec/verification-reports/CHECKLIST-02-NATIVE-EVIDENCE.md` | 11746 | `2870b5be445736cf20bf9d72c00fdc550625a639be04aa06af503ec3b3c30a87` |
| `docs/spec/verification-reports/SELF-REVIEW-20260910.md` | 48656 | `54b4fd220bad07a8d5164b1e23986d566b01cad42a99109b3239c472eb9af520` |
| `docs/spec/verification-reports/README.md` | 6422 | `3eadd2fc9e3013f2485bf7ccfd708e52afe7ac246329e5efffe08fea78e6a198` |
| `docs/tasks/TASK.20260910-68.md` | 14874 | `9d59c8986dd3987ab669769023fd808a377761e8520b530fe54424da98bc58c7` |
| `docs/tasks/TASK.20260910-65.md` | 14678 | `a4f0286b7a453cbeae50d944caadb3f3575ade9d33fca65fe178cbd5732e154b` |
| `README.md` | 26734 | `77caa25d7d6c4d8a489c6f66340e7ebf5e686ced467ce5327a37667586218d52` |
| `.lakda/native-hate-signed-reader-trust-20260911.log` | 796 | `fb4c3b3ccb49da4804c56a2f8981f693630db19bee6344239e1d789ac6a5ca8e` |
| `.lakda/native-hate-export-red-20260911.log` | 6344 | `d2e7ad110d66d67acd0137741268fee75d4ac4c40894bdc298413f14ba68647c` |
| `.lakda/native-report-trust-red-20260911.log` | 1739 | `246b9b1bc1762b4218092343f11a15c7fbf7148252d991e55ab09827601f3c77` |
| `.lakda/native-report-trust-green-20260911.log` | 369 | `aac80955751f9dd3bd6d996c54191ecde27b822ebe4d7b8735504ee1a94b0c0b` |
| `.lakda/native-report-media-final-20260911.log` | 381 | `6a4feada5157fddb4f0ac93868573f680550a0fc9a0ff2cf18d39d1109d04a4b` |
| `.lakda/native-hate-report-check-20260911.log` | 87432 | `9ef1eac5298472eb10df3690455717508d2fe0d0ca9e7c7723275c52b7230bef` |
| `.lakda/native-hate-report-pack-20260911.log` | 5633 | `5d8141dcf075855fe745580efd3e27f3e963259f5db41cdc157ecf73ed1f05ef` |
| `.lakda/native-hate-report-package-lint-20260911.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
