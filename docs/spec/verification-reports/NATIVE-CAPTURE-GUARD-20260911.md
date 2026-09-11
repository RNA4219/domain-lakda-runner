---
document_id: LAKDA-VERIFY-NATIVE-CAPTURE-20260911
status: local-verified
last_updated: 2026-09-11
---

# native撮影の継続確認・背景停止・closeのローカル検証

[仕様](SPEC-02-NATIVE-EVIDENCE.md)、[checklist](CHECKLIST-02-NATIVE-EVIDENCE.md)、[Task 68](../../tasks/TASK.20260910-68.md)に対応する補助証跡。7改修・57要件（Must 55／Should 2）・22 ACを維持する。

基準HEADはb027b6ba9797a2a30b5e98008a1cb848c2c81e05、packageは0.5.0-rc.1。既存差分を含むdirty worktreeを検証した。前段の[録画backend・MP4検証](NATIVE-VIDEO-BACKEND-20260911.md)のdigestや結果を更新しない。以下はこの記録時点のsourceとlogであり、cleanな固定SHAによるrelease受入ではない。

## 実装と実証した範囲

- 登録済み観測leaseとv2承認windowから、操作連番を消費しないcapture guardを作る。既存windowの変更を拒否し、guard確認前後でlease取消も検出する。
- 画像は保持したADBのsnapshot APIで取得する。取得前後とhash計算後に接続・期限を確認し、無効な取得を保存・frame集計へ採用しない。共有screen proxyへ切り替えない。
- 録画は固定SDKのYosemite recorder、ADB、停止method、recording processを保持し、残り時間を切り下げた秒数をSDKのmax_timeへ渡す。1秒未満の開始を拒否する。
- 監視workerはlease取消・承認切れ等を確認し、元の接続を確認できる場合だけ背景停止する。失効後のcaptureを成功扱いにせず、artifactRefsを返さない。接続変更で停止先が不明ならSDK停止0件で未確認を保持する。
- stop timeoutはworkerの終了ではない。同じ進行中workerを後続要求から待ち、停止済みのSDK呼出しを重複しない。監視threadの作成失敗後も、後続stopで終了処理専用workerを作成できれば元backendを停止する。
- closeでは新しいnative処理を拒否し、撮影を停止してからtransportを閉じる。共通500msのcapture待機枠で確認できなければcloseを失敗にし、元の終了処理のための接続を保持する。
- SDK開始の応答不明を状態として保持する。追加開始を拒否し、所有を推測した停止を行わない。旧capture-controlからguard付きcaptureを停止させない。

撮影に関する追加17件を含むPython全160件がpassした。人工SDK、fixture transport、thread Event、制御した時計での動作確認であり、実Airtest撮影・実ADB server・実機の証拠ではない。署名検証済みNodeとのHTTP受渡しや撮影証跡の保存まで実証したものでもない。

## 実行結果

| 検証 | 結果 | 記録 |
|---|---|---|
| guardの先行試験 | 5 error。未実装factoryを確認 | .lakda/native-capture-guard-red-20260911.log |
| 最初のguard確認 | 遅延importがfixtureの検索path復帰後に失敗。通常importへ修正 | .lakda/native-capture-guard-green-20260911.log |
| bridge接続の先行試験 | 5 error。captureにguard引数が未接続 | .lakda/native-capture-lifecycle-red-20260911.log |
| closeの先行試験 | 2 failed。録画停止前のtransport closeと停止未確認の見逃しを確認 | .lakda/native-capture-close-red-20260911.log |
| 開始応答不明の先行試験 | 1 failed。SDK例外時にactiveが消えることを確認 | .lakda/native-capture-start-red-20260911.log |
| 監視開始失敗の先行試験 | 1 failed。保持した録画の終了処理を再試行できないことを確認 | .lakda/native-capture-monitor-red-20260911.log |
| 最終Python wrapper | 160 passed、failure／error／skip／expected failure／unexpected success 0 | .lakda/native-capture-python-final-20260911/ |
| npm run check | docs、型、Lint、build、全546件pass | .lakda/native-capture-check-20260911.log |
| offline npm run pack:check | 575 files／62 schemas、隔離install、native runtime import、既存report CLI等がpass | .lakda/native-capture-pack-20260911.log |

Python command: node scripts/run-python-tests.mjs --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out .lakda/native-capture-python-final-20260911。Windows／Python3.12.14、summaryの実行区間は2026-09-10T19:02:36.886517+00:00〜19:02:45.121067+00:00。

全体checkのlog作成〜最終更新はUTC 2026-09-10T19:02:36.6415398Z〜2026-09-10T19:05:54.3245636Z、packはUTC 2026-09-10T19:06:39.5135038Z〜2026-09-10T19:07:06.8850761Z。これはshell全体の区間で、各caseの計測時間とは別である。

Node24.11.0／npm11.6.1を使用した。宣言のNode24.6.0／npm11.5.1との差はpackのEBADENGINE警告に残している。既存offline cacheを使用した補助検証であり、指定runtimeでのrelease受入ではない。追加Python helper 2件をpackage contentsと隔離installの必須fileへ追加した。

## 未完了の範囲

この変更はPython bridge内部のguard・lifecycle接続である。次にversioned HTTP／Node受渡し、撮影要求・停止結果・媒体参照とsession証跡の照合を接続する。それが完了するまでnative target v2のCLIは連続撮影を接続前に拒否する。旧HTTP capture-controlへ承認済みguardを暗黙注入しない。

SDK／OSが応答しない場合の強制終了は保証しない。100msは確認間の待機値、max_timeは補助上限、stopTimeoutMsは呼出し側の待機上限であり、実機での厳密な停止時刻の保証とは異なる。

Windows／iOS provider、実機3lane、固定SHA・指定runtimeによる統合受入、manual-bb・外部QEGは残る。Task 68やAC-UP-008／022の完了を示さず、今回の内部試験から全7改修の完了を推定しない。

## 記録時点のSHA-256

pathはrepo root基準。SDK fileは読取りで実装を照合した資料であり、SDK撮影の実行証跡ではない。後続変更でこの表を更新しない。

| path | SHA-256 |
|---|---|
| tools/airtest-poco-bridge/server.py | f70062d62ebc549e426c1fb6d3d0ae44005033f23c0bf7cef1127e1a561cf512 |
| tools/airtest-poco-bridge/native_identity_actions.py | 3b20089123efc9f85782ca7f10fec300f47c39735c5af30977acc177f068ec4a |
| tools/airtest-poco-bridge/native_identity_exchange.py | 137af844568e2527ee9b7cbafe83ef698967d516347c27cc1e18224e3f8363ea |
| tools/airtest-poco-bridge/native_identity_capture.py | 62b88deafae0831187dd41f8ed9aa2c5f8f0a89b8dfff1d32105527410efa035 |
| tools/airtest-poco-bridge/native_identity_capture_video.py | 6d06f3d2285e10c1439e1bf386e2e6a9bc0bb71d02a119ab5623a1eef3b7464c |
| scripts/check-package-contents.mjs | 49a625ac347368aaf5d3a6cd60fe9007e8206c0e18d85d2bcd0782f155fff33e |
| scripts/check-package-install.mjs | 65062ce7c8cab95024d18828acdb51f46ffa41bd9136fbe8fcb64b7a4fdbceea |
| tests/python/test_native_identity_capture_guard.py | bbaf0bd199a80a3ab16628c3eb4ffa0ac313bdc8c5a1ff7371f4ed27bcff9660 |
| tests/python/test_native_identity_capture_lifecycle.py | 40f3f4d5c109bb637c263d269721f5d0ac8d10cf66193fa95c5160ff6c0f8869 |
| tools/airtest-poco-bridge/README.md | 40bb90840dc4b652be6acb821ce0566178726327d2ca3d21026654c1d730f89f |
| docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md | a96b463ede157066062c0fee971429a362bc79b1cb57fb362087e1c174cdd824 |
| docs/spec/verification-reports/SELF-REVIEW-20260910.md | b276181aecbd05569b8674450947195635fe598c553453b8abc8a0f2d766fb16 |
| .lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/android/adb.py | 4e606e67cfa1b92dac67b01215d131bc0f87b13bda9cc01f380e96b64ba2a68c |
| .lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/android/android.py | 443ed9f4a6f92fd18c5af0f114f08ec0eaa11160dadb97dde5217219ce413f3d |
| .lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/android/recorder.py | 304c6ffe78624058ecc023efc06ac846df65d79359f5593632a23bb06b108cab |
| .lakda/native-capture-guard-red-20260911.log | ac4a5b6d11f746f29688843dd21718512be94dbc74ee041064179a3d5b48b4f8 |
| .lakda/native-capture-guard-green-20260911.log | 86e594dc52c2c074a0033157081b642fab5ca562a2c02b2b16bc5c08cfb9da1a |
| .lakda/native-capture-lifecycle-red-20260911.log | f5d0ffa4fee01f70ecda6b24a015cafbd52fb755949d3ec0528f1bec86231ff3 |
| .lakda/native-capture-close-red-20260911.log | 044d95de44cf7432e694290d8479ec74fb2d4921798334e3491e9f12f9f2de1c |
| .lakda/native-capture-start-red-20260911.log | 0127824b9f1d543d16b6d965fa073b9f51eb5d6a871735100d238eb63f0c7f21 |
| .lakda/native-capture-monitor-red-20260911.log | fff96df6fa7748f406a6363c3fd1a8618e30354947171603f902e820e20107f1 |
| .lakda/native-capture-python-final-20260911.log | 9e274db66272cea3263f5eb0ac57554479d9f3f62e35a44e23cbeff1b6c7be41 |
| .lakda/native-capture-python-final-20260911/summary.json | 716830cbaaa2beaa8408f0571954c99039eb72ab4b595e7d997d4999486ae957 |
| .lakda/native-capture-python-final-20260911/junit.xml | 4f802dce81fc029972348fffefd8362a375a01b5ac75af5813020720bc96c220 |
| .lakda/native-capture-check-20260911.log | 6b43a1f9f198bed562bff8ba9f4a03dd19d961f889868f10fb834695e5ad6e0d |
| .lakda/native-capture-pack-20260911.log | d4c7c50056ea686753c0053a84743f8a8c0507b638ecac346b84a0d5eb13cbf0 |
