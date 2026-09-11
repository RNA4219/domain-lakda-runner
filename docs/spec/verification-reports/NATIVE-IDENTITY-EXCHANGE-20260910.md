---
document_id: LAKDA-NATIVE-IDENTITY-EXCHANGE-20260910
status: local-evidence
last_updated: 2026-09-10
---

# Native identity HTTP受渡しのローカル検証

対象は[Task 68](../../tasks/TASK.20260910-68.md)と[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存dirty差分込み。[Android provider](NATIVE-ANDROID-PROVIDER-20260910.md)に続き、観測記録をPython HTTP handlerからNode clientへ渡す経路を追加した。

## 追加した処理

native-identity-openでHTTP接続先とcapability digestを照合し、server発行の一回用connectionIdをSDK device／runtime／ADB object／selectorへ束縛する。30秒・未消費32件を上限とし、observeではprovider呼出し前にlock内で消費する。期限外・再使用・別challenge・接続切替・capability不一致では観測providerを呼ばない。capability読取中の接続切替も直後に再確認する。期限切れentryの除去は次回open時であり、timerで参照を直ちに破棄する実装ではない。

serverは観測記録v1を組み立て、宣言値を別objectへ保存する。未知provider field、不正値、SDK例外本文を公開しない。取得不能fieldに宣言がある場合も、observedへ補完せずdeclared-only／value=nullとする。HTTP Hostと実listener port／base pathを照合し、native要求の4 KiB上限をbody読取・JSON parseの前に検査する。

Node clientはopenとobserveへ共通15秒の期限を適用する。redirect、JSON以外、不正UTF-8、schema不一致を拒否し、sessionは4 KiB、observationは16 KiBの上限をstream読取中に検査する。challenge・connectionId・両digest・platform・時刻を照合して観測を返す。既存bridge capabilityの意味は変更せず、追加clientは呼出し時に読み込む。

## 検証結果

環境はWindows、Python 3.12.14、Node 24.11.0／npm 11.6.1。package宣言のNode 24.6.0／npm 11.5.1とは異なり、EBADENGINE警告を保持する。実target・実機・scannerの操作は実施していない。

| 検証 | 実結果 | 範囲 |
|---|---|---|
| Python exchange実装前 | 13 tests、exit 1、19 errors（subtestを含む） | 未実装stubに対する先行試験 |
| Node client実装前 | 8 tests、7 failed／1 passed | 観測応答まで到達する拒否caseは後で到達route数も検査する形へ補強 |
| HTTP容量検査の途中結果 | 5 tests、1 failed | 4097 bytesの空白bodyをparseして400にしていた。上限検査を前に移し413を確認 |
| Node関連試験 | 21 passed | exchange 8件、既存native verifier 12件、schema catalog 1件 |
| 最終Python全体 | 83 tests、exit 0、failure／error／skip 0 | 新exchange 15件・HTTP 5件。summaryとJUnitの件数・結果を照合 |
| 最終 `npm run check` | 476 passed、exit 0 | docs、型、Lint、build、全回帰 |
| offline `npm run pack:check` | 535 files／58 schemas、exit 0 | 必須helper、隔離install、CLI／import／report検証 |
| Python HTTP → Node → verifier | passed、5 query／1 provider call | 人工SDK応答。既知の合成target条件との照合。deviceConnected=false |

Python全体はUTC `2026-09-10T11:44:40.1935832Z`〜`2026-09-10T11:44:46.1945849Z`、全体checkは `2026-09-10T11:44:39.8842201Z`〜`2026-09-10T11:48:01.7191410Z`、packは `2026-09-10T11:49:08.1338705Z`〜`2026-09-10T11:49:33.3700966Z`。runtime・schema・testは最終check開始後からpack完了まで変更していない。SPEC-02の後続工程説明と本記録・索引等はその後に更新し、docs検査を別途行う。

初回型検査では試験用HTTP headerのunion推論に1件のエラーがあり、Reply配列へ型を明示して修正した。最終checkでは解消済み。途中のPython関連34件pass logは同時再使用case追加前の結果であり、最終83件と混同しない。Nodeの共有期限試験は実loopback通信で2段階各8秒を遅延させ、合計15秒で停止することを確認する。

HTTP相互運用は実HandlerとAndroid provider、build済みLoopbackJsonBridge、既存照合器を接続する。SDK応答はfake ADB methodから返すため、導入済みSDKのcmd実装を通す前回probeとも区別する。明示的な相互運用試験だけがローカルNode subprocessを使用し、通常Python unittest discoveryへNode依存を追加していない。isolated installのairtestBridgeは配布fileの存在検査であり、Pythonや実機の動作確認ではない。

## 残る実装と受入

署名済みtarget manifest v2、初回action前／resume／再接続時の実行制御、観測証跡のsession保存とHATE／report読取は未実装。通信成功は署名承認や操作許可ではない。Windows／iOS provider、Androidを含む実機3lane、固定SHA・宣言runtime・manual-bb・外部QEGの受入は残る。Task 68とAC-UP-008／022を完了扱いにしない。

open時のcapability読取は実環境ではSDK表示情報へアクセスし得る。試験で示すのはidentity providerの呼出しがないことであり、openがSDKを一切使わないという保証ではない。接続markerは確認可能な読取境界で比較しており、OS全体のatomic lockやSDK内部の全再接続を証明しない。private loggingも観測threadのADB queryが対象で、起動・他SDK操作の全ログの秘匿を示さない。媒体のIO-01・隔離途中・派生bundleを含む7領域全体の完了条件を維持する。

## 再検証

`npm run test:bridge:python -- --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out <new-output-directory>`、`npm run check`、offline cacheを指定した`npm run pack:check`を使用する。相互運用はbuild後、`tests/python/test_native_identity_http.py --interop-node <node.exe>`を同Pythonで実行する。出力先は本記録のlogを上書きしない名前にする。

## 検証対象・記録のdigest

24件。過去記録のdigestは当時のsnapshotとして保持する。本記録と後からリンクを追加するTask・索引・checklist・セルフレビューは含めない。

| file | bytes | SHA-256 |
|---|---:|---|
| `tools/airtest-poco-bridge/native_identity_exchange.py` | 8754 | `f22a1aec1472949e505769ad1d6aae3049324bba3f5dd8b58d661e62a69ed7fd` |
| `tools/airtest-poco-bridge/native_identity.py` | 5652 | `aea6e3f20895829088b07d11101dd35db7456eb6751fd36d78f59df8b2145c96` |
| `tools/airtest-poco-bridge/server.py` | 55957 | `2f183a34caa0c60d2b9d64e462ee0eba48b446fb2247ed26a9c87ef6fda64115` |
| `tools/airtest-poco-bridge/README.md` | 9204 | `364d55b67df674e88b2769dcba24bbd119bdfcf057ad80750e9128563bd1b4a7` |
| `src/exploration/native-identity-exchange.ts` | 5932 | `2071b759395661e3061d66874941a917fac37d447d266e0a3a61c0850ce0ae5d` |
| `src/adapters/external-bridges.ts` | 9408 | `e44d799ade68c642809f0e8b53069eb75f00c40a3f73acd7d52d915430faec23` |
| `src/adapters/loopback-json.ts` | 6078 | `bba3ae87a2b014a9e75d364c751c550522a328edf1581bb97b07174cd90e91f3` |
| `schemas/lakda-native-identity-exchange-v1.schema.json` | 3422 | `b18cb53578e01d1cee18af5096dcf720fc10d3a1540572493dc19b5b8af16f6c` |
| `tests/native-identity-exchange.spec.ts` | 10710 | `8068cc497948aa989cadd7a3e9e5fa88f342f5ab58c9b8be33ebdf3bfb7753ae` |
| `tests/python/test_native_identity_exchange.py` | 11226 | `b2b55ed36204adbcf8f64de25f144fdf5de474ec539229d5de89fc1dc78dfe4e` |
| `tests/python/test_native_identity_http.py` | 7705 | `557691dde0504b0d238910b0af86347a9d210eb6e64462b78bb86042d84b6d6c` |
| `scripts/check-package-contents.mjs` | 4597 | `a52f09f05061ec0bf955f4675a67153c850d6dcafe29fe41df8535e61cbeb1ab` |
| `scripts/check-package-install.mjs` | 15341 | `145990c3a7c353e3c0609e75ec786b3c3ed952b56024d74562baef529cd6c8f2` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 35458 | `a6e406292f2d0e22c702fe00907b09b262390726ee8414a7e13460d4371d3f8a` |
| `.lakda/native-identity-exchange-python.log` | 14178 | `e411a2701403c3b9712213a8509fadd0bd02e646e04bbd3ccc2f2ff1a403c74d` |
| `.lakda/native-identity-exchange-python-tests/summary.json` | 17287 | `9469b3761412d26da346717cc8955686a9bcc90fc5720f9ba285ccee05446fe5` |
| `.lakda/native-identity-exchange-python-tests/junit.xml` | 10666 | `950208027547b945341b412d46e587f4b5fb666f0ab8d9780c8915ad270afd2e` |
| `.lakda/native-identity-exchange-check.log` | 79178 | `c3dc9aaed383e8cda59b304ce58955068324a903443d89631724283b1bba9565` |
| `.lakda/native-identity-exchange-pack.log` | 4881 | `81c7eb5dbcd2e2f3fb774a61fe36e04fc01a3efbb85723b19faa06a4534e6dd7` |
| `.lakda/native-identity-exchange-http-interop.json` | 264 | `8403bf8990c7840053ad4de8d692a9469e40402f0890716760ed3e76355eadc5` |
| `.lakda/native-identity-exchange-python-red.log` | 20512 | `2d454ee724261f924c1660462c20ef9d5b7abdd11c47d1864fa90d844924dda2` |
| `.lakda/native-identity-exchange-client-red.log` | 13596 | `e5691d5cef17f9a94dc4f96e22dcd8d6e3fa0aafe7191d3cb56c443d83db5fcc` |
| `.lakda/native-identity-exchange-http-size-failure.log` | 741 | `99900a023e9991a23e2c14092e3659c4397845f05f88bc0fe639cb98e4987610` |
| `.lakda/native-identity-exchange-client-related.log` | 3333 | `b6085f0f33cbaf944b37ebecdd46432d97202b36eea3cac5bc5aaa9a4a8f7224` |
