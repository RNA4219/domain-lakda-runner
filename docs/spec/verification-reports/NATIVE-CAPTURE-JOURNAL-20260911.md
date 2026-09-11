---
document_id: LAKDA-VERIFY-NATIVE-CAPTURE-JOURNAL-20260911
status: local-verified
last_updated: 2026-09-11
specification: SPEC-02-NATIVE-EVIDENCE.md
checklist: CHECKLIST-02-NATIVE-EVIDENCE.md
---

# 撮影実行・保存journal・レポート接続のローカル検証

## 対象と結論

[仕様](SPEC-02-NATIVE-EVIDENCE.md)の撮影を署名済みexecutor／runner facadeへ接続し、要求・終了・停止確認をv2 journalへ保存する。全体559件、Python175件、オフラインpackage検査592 files／65 schemasがpassした。[Task 68](../../tasks/TASK.20260910-68.md)の実装を進めた記録であり、7改修・57要件・22受入条件の全体完了ではない。

対象HEADは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存差分を含むdirty worktree、package `0.5.0-rc.1`。Windows、Node 24.11.0、npm 11.6.1、Python 3.12.14でのローカル補助証跡とする。宣言runtimeのNode 24.6.0／npm 11.5.1による固定revision受入ではない。実SDK・実ADB・実機・外部scannerには接続していない。

[前段HTTP記録](NATIVE-CAPTURE-HTTP-20260911.md)のSHA-256は`05c6572f59054a58209420cf123f609cbc11548324ff1ef7a70b51b354684448`、[guard記録](NATIVE-CAPTURE-GUARD-20260911.md)は`84e41ccdfd544bf0cb64ad12e5bb27ec8bf0cdf3225505e9d84e8e732fa3812c`で、bytesを変更していない。過去のsource hashを現在のsourceに置き換えていない。

## 確認した動作

| 領域 | 結果・確認範囲 |
|---|---|
| 署名済み撮影 | nativeCapture methodを非同期処理前に保持し、要求保存の前後・応答後に署名、観測期限、bridge bindingを照合する。旧capture endpointへfallbackしない |
| 保存順序 | 観測、操作、撮影要求と終了を同じcheckpoint列へ保存する。撮影のordinalは入力操作から独立し、停止は元のcaptureOrdinalを使う |
| 保存先の取扱い | 要求全体のdigestとstagingDirのdigestを保存し、絶対staging pathをjournalへ入れない |
| 失敗と停止 | 開始応答不明・期限後応答・要求／終了保存失敗で次の入力と撮影を止める。元の録画のcleanupは保存不能・承認切れ後も一度試みる。保存不能を完了にしない |
| 結果不明 | 開始不明は同じ開始識別子への停止確認で終了を記録できる。配送不明の単発画像は、録画が止まっても未確認を維持する |
| 撮影設定 | 署名対象digestと一致するCharterのvideo設定、sampled有効状態・source・間隔・枚数・容量・停止待機上限を送信側とreaderで照合する |
| 互換性と容量 | v1 file／refを独立読取でき、journal内のversion混在を拒否する。2,000媒体参照のv2応答を保存・再読取し、旧v1の128 KiB超過記録を拒否する |
| CLIとHTML | pause／resumeで2 journal、3操作、2画像取得を保存する。実fileとして人工PNGとテスト署名を作り、HATE／保存検証を通したHTMLがreadyになる |
| Python cleanup | 未送信番号があっても、同じ元撮影のstop／discardだけは大きい連番を受理する。既知の開始拒否では自身のactiveがない場合にstopped=trueを返す |
| 配布物 | 撮影controller、evidence、verifier、新schemaを必須同梱とし、隔離installでimportする。既存report CLIの生成とverifyもpass |

[セルフレビューSR-106〜109](SELF-REVIEW-20260910.md)に、readerの撮影設定照合漏れ、期限後応答の失敗記録、保存不能時のcleanup、runner fixtureと旧記録の互換を記載した。実装前の撮影method未接続、旧endpoint呼出し、readerによるvideo=off違反の受理、開始成功と停止済みの矛盾を先行テストで確認して修正した。

最初の全体checkはテスト補助の未使用引数でLintが失敗した。元logを残し、修正後のcheckを別logへ保存した。最後のcheck開始後、変更対象20ファイルのdigestに差分がないことを確認した。

## 検証結果

| command・対象 | 実結果 |
|---|---|
| `npm run check` | exit 0、文書・型・Lint・build成功、559 passed（4.7m） |
| Python wrapper全suite | exit 0、175 tests／175 executed、failure・error・skip・expected failure・unexpected successはすべて0 |
| `npm run pack:check`（offline cache） | exit 0、592 files／65 schemas、隔離install・import・既存report生成／verify成功 |
| 移動後のsample `report verify` | exit 0、valid=true、7 files／81,175 bytes |

checkはUTC 2026-09-10 23:40:24.6444352〜23:45:34.0255395、Python wrapperは23:38:59.1554807〜23:39:10.0310241、packは23:45:56.018947〜23:46:33.2664525に実行した。

Python commandは`node scripts/run-python-tests.mjs --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out .lakda/native-capture-journal-python-20260911`。JSON／JUnitとwrapper logを保存した。後続のsource変更後には、この記録の結果をそのまま流用しない。

## 閲覧用サンプル

人工fixtureから生成したHTMLを`.lakda/native-capture-journal-preview-20260911/index.html`へコピーした。これは動作確認用データであり、実機結果や人間による受入記録ではない。

report IDは`report-5053731d-a069-4429-8046-efb71ff8ed5d`、移動後verifyのmanifest SHA-256は`c6b500726cbff9cd6662decaeb9ff103c619b0b47d8045aa96b12c9eb599cf10`。verifyの範囲はreport bundleのfile整合であり、元テストの再実行や実機確認を意味しない。

## 残る作業

CLIの連続撮影制限は維持する。連続撮影の通常run・停止・再開・媒体採用までの統合受入、Windows／iOS provider、実機3lane、固定revision・指定runtime・外部Gateの受入を継続する。元媒体保全、期限後応答の派生bundleなど他Taskの未完了要件も維持する。fixtureの成功を実機受入やQEG goへ昇格しない。

## 記録時のSHA-256

以下はこの記録時点の20変更対象と12検証資料である。将来のsource変更に合わせて更新しない。

| path | SHA-256 |
|---|---|
| `src/exploration/native-identity-capture.ts` | `5c62ee405fb664e3bfa5f8cd7f48b3b6fb35ac996849c255fedcf3f0acb99c80` |
| `src/exploration/native-identity-capture-executor.ts` | `5f04ac84b97963ec90276c211c5e1f5ff5129726ec0b860080198ca0e468e46c` |
| `src/exploration/native-identity-capture-evidence.ts` | `7f3aaf536f77ccd42c90aa0b2fcf364c507f3eb6d45959ec7290cbf30df317a7` |
| `src/exploration/native-identity-capture-verifier.ts` | `b089cdcc0589f431c12ac560b3dfa6b563539dd64a6765ca79f4fe18c53540fd` |
| `src/exploration/native-identity-executor.ts` | `d04eb8b7ce3ec4c27aaf84be0f4f0be7b3d30e9e5599ce5f6d7e25cdf24f7258` |
| `src/exploration/native-identity-bridge.ts` | `c0112ccb0e345693c75b6bcf65f7af9e63fe0cb396f1b6c42272bd4cf5c8dde4` |
| `src/exploration/native-identity-evidence.ts` | `137c01647957431e6c6e104e8634f10de7c4a0c634a565e9ef8158653ad784c1` |
| `src/exploration/native-identity-evidence-store.ts` | `74e7e89a442d6bfcaf4fd45115009f46d2efefee0598e2011c807239867a9fc9` |
| `schemas/lakda-native-capture-v1.schema.json` | `345bac074b0067c4c331d230a1a1dc711201d6c1a4f926ab8fdfb336928ecb64` |
| `schemas/lakda-native-capture-evidence-v1.schema.json` | `8cc6b7c2d07d377d89091483f9b6f7f990a2bf5c41dd61f3074c9fa6cb3e20df` |
| `schemas/lakda-native-execution-evidence-v1.schema.json` | `20dd5043e9e62d55c5de3ffcd04f0171a554ecffc416a706ecbf80d08e376073` |
| `schemas/lakda-native-execution-evidence-v2.schema.json` | `9e082402f8fddb161b9a7e5bb5d7c7dc3e62f02f65f887b03aacf4bd93de99fa` |
| `tools/airtest-poco-bridge/native_identity_capture_exchange.py` | `2bb3f6aae9896848d07a924220bf6b0d307a63d692bc14cd293505671f1dd4e0` |
| `tests/python/test_native_identity_capture_exchange.py` | `4c9ca818961bd790ab4da5105eae0b93158403f0f08e4f2cb23670a127afac2e` |
| `tests/native-identity-target.spec.ts` | `18f1966c6302fca0dea05c92ab383e740592c990c3f520f6fb0ad8a174238f18` |
| `tests/native-identity-capture.spec.ts` | `72a391da916a1b5ad23c75c6f4cf33e82958451a4c4676dacee0f920600f70b0` |
| `scripts/check-package-contents.mjs` | `3f9b5f39b0333edb187c0ba61e841faac4da84ee5074935e1a27b157e0e80b2a` |
| `scripts/check-package-install.mjs` | `d0c5bfc31249cbbab96cd266257c11e5a1a38e25ad642a18750b86785f34123f` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | `91f2518db0f6d03326ed466972da18428085b2ba9b146c45b673af845549e0e0` |
| `docs/spec/verification-reports/SELF-REVIEW-20260910.md` | `a94aaf2153ec9e0994603db75062311fee88e3e481b6049b1b44d3156a9234f7` |
| `.lakda/native-capture-journal-check-20260911.log` | `7b4f0ea8d09e9bf23693e7e42f91922e7ec9ddb90763278e7f922503d736a4e6` |
| `.lakda/native-capture-journal-check-20260911.meta.json` | `4e411e03df93e56f5b984a034b76bb092edf33ee07e64c3c31f3470436a32268` |
| `.lakda/native-capture-journal-check-final-20260911.log` | `b2fd44be0a8f93ff37aefc5aa355a8aab4aa79a7c91409589a4aaa31b5d52973` |
| `.lakda/native-capture-journal-check-final-20260911.meta.json` | `ae9625c1cc407e5ecbf407b8edf9fd74c15cb32df438e3e92c2cb1b90098912c` |
| `.lakda/native-capture-journal-python-20260911.log` | `be5edf36095c5b1f05bf78e95e522c677dd1b42fbe01f62f2d86c693fcac0bef` |
| `.lakda/native-capture-journal-python-20260911.meta.json` | `b94708a1485272db300b5475bba6e80326af0826aeb7da55613be32095572067` |
| `.lakda/native-capture-journal-python-20260911/summary.json` | `4857fb6c91dc63d8d3b5b9fef2ece14369d22bb82c41fbe5d4355dfb7b921428` |
| `.lakda/native-capture-journal-python-20260911/junit.xml` | `0832882afa235a140e4ba27c95b3366c6104ffb3b0dde9ef1ffb27ac1b7bb83b` |
| `.lakda/native-capture-journal-pack-20260911.log` | `deaada6c54fc8c7d2aff89d2fe8b3c3d187fc8513e7954ee8c79c570d51ffddd` |
| `.lakda/native-capture-journal-pack-20260911.meta.json` | `49f735d6d73e260d9c8f21c4f34b4ca05c0e163bbc74ae3cf08eca8a0a3884f8` |
| `.lakda/native-capture-journal-source-hashes-20260911.json` | `191684dc83b092e88f118ab9ad16e9ac5607b763393198e4b4c9c76b7383eb20` |
| `.lakda/native-capture-journal-preview-verify-20260911.json` | `c887ecea3ff782ca6409da424e9289ac059625d6cddd9d6688b9fa86855d3ecc` |
