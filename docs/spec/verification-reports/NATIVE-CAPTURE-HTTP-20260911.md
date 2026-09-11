---
document_id: LAKDA-VERIFY-NATIVE-CAPTURE-HTTP-20260911
status: local-verified
last_updated: 2026-09-11
specification: SPEC-02-NATIVE-EVIDENCE.md
checklist: CHECKLIST-02-NATIVE-EVIDENCE.md
---

# native撮影HTTP・Node受渡しのローカル検証

## 対象と結論

[仕様](SPEC-02-NATIVE-EVIDENCE.md)のnative capture HTTP v1を実装し、[Task 68](../../tasks/TASK.20260910-68.md)の通信経路を進めた。全体回帰549件、Python173件、Node／Pythonの実HTTP相互運用、オフラインpackage検査がpassした。新規試験はTypeScript3件とPython13件である。

対象HEADは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存変更を含むdirty worktree、package `0.5.0-rc.1`。Node 24.11.0、npm 11.6.1、Python 3.12.14／Windowsによるローカル補助証跡であり、宣言runtime（Node 24.6.0／npm 11.5.1）での固定revision受入ではない。実SDK・実ADB・実機・外部scannerへ接続していない。

[前段の内部guard記録](NATIVE-CAPTURE-GUARD-20260911.md)のbytesは変更していない。SHA-256 `84e41ccdfd544bf0cb64ad12e5bb27ec8bf0cdf3225505e9d84e8e732fa3812c`を再照合した。過去記録のsource hashを現在のsourceへ置き換えていない。

## 確認した変更

| 領域 | 動作と根拠 |
|---|---|
| HTTP契約 | screenshot／start／stop／discardの要求・応答、64 KiB要求、4 MiB応答、未知field・不正入力の拒否を追加した。旧capture endpointの応答上限は維持する |
| 連番と再送 | 撮影専用ordinalと開始時captureOrdinalを使い、直前の同一要求は保存応答を返す。別内容・古い番号・飛び番号ではSDK呼出しを追加しない |
| 元撮影の停止 | lease、window、endpoint、run、staging、modeと元guardを保持する。途中の単発画像は開始識別子を置き換えず、古い撮影への停止が新しい録画へ作用しない |
| 期限後cleanup | lease取消後も元guardで停止を確認できる。停止timeoutの再送は元応答を返し、次の連番で進行中workerを再確認する。SDK停止を重複実行しない |
| 応答不明・失敗 | 開始不明を再試行せず、所有不明の停止をしない。停止後の一覧copy失敗ではacceptedを取り消し、確認済みstoppedだけを保持する |
| Node送信 | 最初の非同期処理より前に入力をcopyし、要求digest、連番、開始識別子、mode、結果・媒体参照を照合する。自動再送をしない |
| sampled frames | 本体guardで取得・停止・検証した2 frameを新しいHTTP応答へ結び付けた。共有snapshotの呼出しは0件 |
| close待機 | 開始中SDKが保持するlockの取得にも共通500ms枠を適用する。取得不能時はtransportを保持し、開始が戻った後に停止・closeを再確認する |
| package | 新しいNode module、schema、Python contract／exchangeを必須配布物とし、隔離installからNode moduleをimportする |

セルフレビュー[SR-101〜105](SELF-REVIEW-20260910.md)で入力変更、停止後の成功状態流用、HTTP容量上限の差、closeの無期限lock待ちを確認した。各修正は先行する失敗試験で確認した。closeの先行試験では3.016秒待っていたが、最終試験は後始末込み531msでpassした。これは人工SDKとthread schedulingの測定であり、実SDK／OSの強制終了保証ではない。

## 実行結果

| 検証 | 実行command | 結果 |
|---|---|---|
| 文書・型・lint・build・回帰 | `npm run check` | exit 0、549 passed（3.0m） |
| Python全suite | `node scripts/run-python-tests.mjs --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out .lakda/native-capture-http-python-final-20260911` | exit 0、173 tests。failure／error／skip／expected failure／unexpected successは全て0 |
| Node／Python相互運用 | `.lakda/dependency-env-py312-verified/Scripts/python.exe -B tests/python/test_native_identity_capture_http.py --interop-node node` | exit 0、fixture。録画開始1、停止1、画像2。Nodeの結果とPython側counterが一致 |
| 配布検査 | `npm run pack:check`（repo内cache、offline=true） | exit 0、581 files／63 schemas。隔離install・import・report CLIがpass |

最終checkのUTC期間は`2026-09-10T19:47:23.8124132Z`〜`2026-09-10T19:50:40.1189631Z`、packageは`2026-09-10T19:51:10.8091838Z`〜`2026-09-10T19:51:37.3501206Z`。Pythonの開始・終了はsummary／JUnitから照合できる。開始中closeのcaseは`test_native_identity_capture_exchange.NativeCaptureExchangeTests.test_close_does_not_wait_unboundedly_for_an_inflight_sdk_start`。

## 残る実装・受入

- 今回のNode clientは低水準のoperator通信である。署名済みfacadeのcaptureEvidence／captureControlへの接続、撮影要求・停止結果のsession journal保存、独立reader・HATE／reportとの照合を実装する。
- 上記が完成するまでnative target v2のCLIは連続撮影offの制限を維持する。保存応答の再送を、現在の接続や撮影継続の確認として扱わない。
- Windows／iOS providerと実機3lane、媒体検査の残る受入、固定revision・対応runtimeのCI／実環境／manual-bb／外部QEGは本記録では完了しない。
- 元の7改修・57要件・22受入条件を維持する。詳細checklistの全体ACをこのfixture結果だけで閉じない。

## 検証対象とログのSHA-256

次の32件はこの実行のsnapshotである。表のsourceは実行後にも照合し、ログは上記commandの出力・metadataを保持する。今後の変更を反映するために本表の値を書き換えない。

| repo相対path | SHA-256 |
|---|---|
| `src/exploration/native-identity-capture.ts` | `d7131df0d32e75bfe18cd4c9ef25f35691f3e7d66e57ef708d09a43a0d602bfd` |
| `src/exploration/native-identity-exchange.ts` | `4bd58a7164cc80fcfc5738a0fc235a1b53c321e2524b1eb501bddb24e2d45a0f` |
| `src/adapters/external-bridges.ts` | `1e20869e1833e8f19a8e525420524f1671e727826b49c28279b61c760a1f757a` |
| `src/adapters/loopback-json.ts` | `3cdaf21f8a81ef3de5878803326d9ef5fc7088acf5ef98c38b03a14557b53132` |
| `tools/airtest-poco-bridge/native_identity_capture_contract.py` | `bfbf93d967cbe4e7cc1c45f19ff95c0b745800b85948ad28db80f97e678b8fc6` |
| `tools/airtest-poco-bridge/native_identity_capture_exchange.py` | `500829f1a6a5ee9db8d3bc14237eefe0827c8c96a6e66c1d59378fdabd46e9f2` |
| `tools/airtest-poco-bridge/native_identity_exchange.py` | `7611a67ea33e5642acf8ffb7ea75f55130b60836cd624f0dbb7df56e9a71f364` |
| `tools/airtest-poco-bridge/native_identity_actions.py` | `3b20089123efc9f85782ca7f10fec300f47c39735c5af30977acc177f068ec4a` |
| `tools/airtest-poco-bridge/native_identity_capture.py` | `62b88deafae0831187dd41f8ed9aa2c5f8f0a89b8dfff1d32105527410efa035` |
| `tools/airtest-poco-bridge/native_identity_capture_video.py` | `6d06f3d2285e10c1439e1bf386e2e6a9bc0bb71d02a119ab5623a1eef3b7464c` |
| `tools/airtest-poco-bridge/server.py` | `051c21bb7c134b2490487bb6590d48ea48c99a95256176e3e3198017f3e991be` |
| `schemas/lakda-native-capture-v1.schema.json` | `345bac074b0067c4c331d230a1a1dc711201d6c1a4f926ab8fdfb336928ecb64` |
| `tests/native-identity-capture.spec.ts` | `e2b73448231ca6597cb30609db9c4010137c95f467ba477ced75eca30966bc56` |
| `tests/python/test_native_identity_capture_exchange.py` | `77d7a2e68f065da4267e5dd7a37f34ac4d7b4e3babbd1898a05affc71c440ea2` |
| `tests/python/test_native_identity_capture_http.py` | `1d85f25dbdfb952839023e3e424243eadb5de69f14c5e21bae8eb4f5bc7d1c43` |
| `scripts/check-package-contents.mjs` | `3030fb289f2ed5bd349246e0a92d0183e7dcf148529f4b07a960e94802b8ac58` |
| `scripts/check-package-install.mjs` | `52901d182e8ba5752815ed5ac1ef00815ff2c7394c40498140d6b2e506c9dc41` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | `57ec7646ddbc156a557ff193066ccecbe5044beae66802c82eb280a9efd801de` |
| `docs/spec/verification-reports/SELF-REVIEW-20260910.md` | `0e9cf30f23b84d4435139c1f941ad971b7409956b7de98b9f25d10cdd40f72b3` |
| `tools/airtest-poco-bridge/README.md` | `181e1716694a18c5ee6c25caac07caad2c0a23825a9e6e39accd7b4f6ea626ef` |
| `docs/proposals/20260910-detailed-requirements.md` | `843268a8d7292bca422eea494bd5fc489bf0c52c25a4d3e28149892f6f578a13` |
| `docs/proposals/20260910-report-detail.md` | `b10963257c11a146cf1703cb24efb8438049994bc955a700e108163be1c7c81c` |
| `docs/proposals/20260910-detailed-checklist.md` | `834850e27551a0dfc255cc2de2d099e7feaed0289f2f89255e7994cc07fb2930` |
| `.lakda/native-capture-http-check-final-20260911.log` | `fc7d55b3c5e1dff999470c01b6327e99a6aabf0124d38d12bb52f3e5e2eb2782` |
| `.lakda/native-capture-http-check-final-20260911.meta.json` | `c7a552527a24bf1e8f86c49872de2c24c16c6c4f5e09c97af565c6a21f4962f9` |
| `.lakda/native-capture-http-python-final-20260911.log` | `8003de42a3a2f1724066926d6c47c918e29ae50f90909e140ec49ade6c5aff96` |
| `.lakda/native-capture-http-python-final-20260911/summary.json` | `bf8308eedd89ef7017ccd43cdb598b3adcc36f5fccc35ceb1075412f19198f48` |
| `.lakda/native-capture-http-python-final-20260911/junit.xml` | `efd839cc31f67914a091ffd29cda57816efce6c7d52b4d85d221df174d51416b` |
| `.lakda/native-capture-http-interop-20260911.json` | `b96e7d942b2176b893ec409595cc944cf5afa40f134163d9cc914158c122f72f` |
| `.lakda/native-capture-http-pack-20260911.log` | `400f596b6de9a7ea0fc5c18cc71b80e7782865a0b02119c4aaa8ed247aa4b261` |
| `.lakda/native-capture-http-pack-20260911.meta.json` | `abb9841a9f55e9ab6a5b9f28b124db79c4c62a3df573003fdedb8d33a1a58fc1` |
| `.lakda/native-capture-http-source-hashes-20260911.json` | `0ff435879275748c7ab10c7b5564755b0fa639edc9ecdf36135c714c07d7b52d` |
