---
document_id: LAKDA-NATIVE-IDENTITY-ACTIONS-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 観測に束縛したnative操作のローカル検証

対象は[Task 68](../../tasks/TASK.20260910-68.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)、セルフレビューSR-62〜65。[署名済みtarget v2](NATIVE-IDENTITY-TARGET-20260910.md)に続き、operator bridgeの低水準操作経路を追加した。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存dirty差分込み。実機・固定SHA受入ではない。

## 実装した処理

必須3項目がobservedである観測記録に、非公開の操作leaseを対応付ける。記録のcanonical digest、接続ID、challenge、SDK device／runtime／ADB object／selector、Poco・agent参照、capability、宣言、wall clockと単調時計の期限を保持する。有効leaseは最大32件で、登録時に期限切れを除去し、満杯なら有効な既存leaseを追い出さず拒否する。この容量拒否はprovider実行後になる場合がある。

native-actionの要求はexecute／recover、lease、ordinal、payloadを持つ。要求64 KiB上限をHTTP body読取前に確認し、未知の外側fieldを拒否する。bridge単位で同時操作を拒否し、leaseごとの連続ordinalをSDK呼出し前に消費する。同じ要求は再実行しない。失敗したleaseは破棄する。

通常操作と復旧の双方で、SDK呼出し直前・返却後の接続と期限を再確認する。candidate準備中の切替や時間超過も操作前に拒否する。tap／backは観測したdeviceのmethodを直接呼ぶ。Pocoはdevice・ADB・agentの対応を確認し、proxy準備後の差替えも拒否する。既存execute／recoverの応答形式と共有API経路は維持し、新しい経路へだけguardを渡す。

応答のactionAttemptedはSDK操作の呼出し開始を表す。開始後のSDK例外や照合失敗は実行成功にせず、actionAttempted=trueを残す。物理的効果の成功・取消し・操作0をこの値から推測しない。Nodeはoperation・lease・ordinal・checkedAtと既存resultを照合し、最大64 KiBをstream中に確認する。要求は最初のawait前にsnapshotへ固定し、通信失敗を自動retryしない。

## 検証結果

Windows、Python 3.12.14、Node 24.11.0／npm 11.6.1。宣言runtimeはNode 24.6.0／npm 11.5.1であり、packのEBADENGINE警告を保持する。実端末や実operatorの承認鍵は使っていない。

| 検証 | 結果 | 範囲 |
|---|---|---|
| Pythonの未実装stub | 10 tests、1 failure／5 errors | guardの正常系が未成立であることを確認。残りの拒否系も最終版で再実行 |
| Node facade未実装 | 7 tests、7 failed | bridgeの新操作APIが必要であることを先行試験 |
| facade snapshot追加前 | 1 failed | 遅延import中の要求変更でordinalが9になった。await前の複製で修正 |
| facade例外秘匿の追加前 | 1 failed | 複製不可の入力で固定エラーにならなかった。入力を含まないエラーへ変更 |
| Python関連 | 18 passed | guard 13件、実HTTP handler 5件 |
| Python全体 | 101 tests、exit 0、failure／error／skip 0 | JSONとJUnitの101件、追加13＋5件を照合 |
| 全体 `npm run check` | 497 passed、exit 0 | docs・型・Lint・build・全回帰。最後の例外秘匿修正の前 |
| 最後の修正後 | 関連9件、typecheck、Lintがexit 0 | native-action facadeとclientの正常・拒否・snapshot・秘匿の試験 |
| offline `npm run pack:check` | 544 files／60 schemas、exit 0 | 新helper必須化、新schema、隔離install・CLI・import・report確認 |
| 最終buildでのPython HTTP → Node | passed | fixture鍵の署名検証、観測照合、ordinal 1／2の操作・復旧、人工SDK操作2回 |

Python全体はUTC `2026-09-10T12:56:23.4780448Z`〜`2026-09-10T12:56:29.8455151Z`。全体checkは `2026-09-10T12:56:23.1353065Z`〜`2026-09-10T12:59:27.7800543Z`。その後のruntime変更はfacadeの複製失敗を固定エラーにする3行で、1試験を追加した。関連9件・型・Lintを実行し、497件をこの最終修正後に再実行したとは主張しない。

最終packは `2026-09-10T13:02:01.1876892Z`〜`2026-09-10T13:02:25.9806084Z`。最終runtime・schema・testはpack開始以降変更していない。packがbuildした出力でHTTP相互運用も再実行した。Python source・testは101件の全体試験後に変更していない。本記録と索引等の追加後にdocs／diff／digestを別途照合する。

13件のPython guard試験は、明示deviceによるtap・復旧、要求再使用・飛び番号、未知fieldと別lease、共有device・selector切替、wall clockと単調時計の期限、candidate準備中の変化、SDK例外・返却後の変化、観測不能、同時要求、candidate拒否、Poco proxy準備中のADB切替、32件上限と失効時の除去を扱う。HTTPの5件は正常操作と復旧・重複、Host・サイズ・JSON等の拒否、観測／接続差、SDK失敗のactionAttempted、legacy応答互換を扱う。

Nodeの最終9件は、操作・復旧の応答束縛、不正／過大要求、lease・連番・時刻の差、candidate／fingerprintとattemptの不整合、開始後の失敗、JSON／UTF-8／content type／redirect／HTTP error／stream上限、HTTP中・遅延import中の要求変更、複製不能入力の秘匿を確認する。初回型検査の試験fixtureに3件の型不整合があり、既存LocatorRecipe・generatedBy・riskの型へ修正した。

## SDKと相互運用の証拠の範囲

導入済みAirtest 1.3.5のAPI sourceで、device()が共有の現在deviceを返し、touch／keyeventもそこへ委譲することを確認した。Android.touchは明示deviceの座標変換とtouch proxyを使う。Poco 1.0.94のdriverはdeviceとadb_clientを保持する。参照した3 sourceのdigestを末尾へ保存した。これはAPI選択の静的根拠であり、実SDKのtouch／backを実端末で実行した証拠ではない。

HTTP相互運用は実Python HandlerとAndroid provider、build済みNode client、fixture生成Ed25519鍵のv2文書検証、観測照合器を接続する。既知の人工device digestとbuild mappingへ照合してから、操作と復旧を送信する。結果はsdkQueries=5、fakeSdkActions=2、sharedApiActions=0、ordinals=[1,2]、deviceConnected=false、approval=fixture-key-onlyである。

操作先は人工device methodであり、candidate再観測はfixture応答へ置換している。実画像からのcandidate生成・照合や実captureの受入をこの相互運用で完了したとは扱わない。明示した相互運用commandだけがNode subprocessを使い、通常Python discoveryへNode／SDK依存を加えない。隔離installのairtestBridgeはhelperの配布存在確認である。

## 残る実装と受入

- 署名済みpolicyとoperator承認期限をSDK操作開始まで適用する実行wrapper、CLI初回／resumeへの接続、観測・操作応答のsession保存とHATE／report照合は未実装。観測leaseの期限だけをoperator承認期限の継続検査と混同しない。
- 同じSDK object／selectorを維持した内部再接続を検出する、実transportの接続世代取得は未実装。確認できたmarker変化だけで再接続要件全体を完了にしない。
- SDK内部の任意時点でのatomicな停止・取消しは保証しない。SDK開始後の失敗・timeoutには効果の不確実性が残る。ログの抑制範囲も観測・操作threadのADB loggerであり、起動や全SDK loggerの秘匿ではない。
- Windows／iOS provider、Androidを含む実機3lane、実operator署名・固定SHA・宣言runtime・manual-bb・外部QEGの受入は残る。
- CLIと既定readerのv2拒否を維持し、Task 68・AC-UP-008／022を完了扱いにしない。媒体IO-01・隔離途中・派生bundle等を含む7領域の残作業も維持する。

## 再検証

`npm run test:bridge:python -- --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out <new-output-directory>`、`npm test -- tests/native-identity-actions.spec.ts`、`npm run check`、offline cacheを指定した`npm run pack:check`を使用する。build後の相互運用は`tests/python/test_native_identity_actions_http.py --interop-node <node.exe>`。過去logを上書きしない出力名を指定する。

## 検証対象・記録のdigest

29件。途中の失敗logと497件の範囲は上記のとおり区別する。本記録とリンク追加先のTask・索引・checklist・セルフレビューは含めない。過去の観測・署名記録は当時のsnapshotとして維持する。

| file | bytes | SHA-256 |
|---|---:|---|
| `tools/airtest-poco-bridge/native_identity_actions.py` | 7885 | `92ca1197cea6da12445682232530bb5c3434a9959cea9de694344ef695e65281` |
| `tools/airtest-poco-bridge/native_identity_exchange.py` | 9416 | `38e2527ea5d5e721f5b6b0724888a30dd1c1786f419775637786c3b3095cf3e6` |
| `tools/airtest-poco-bridge/server.py` | 57107 | `0394f7cf7905d9f4051550682bd9c064e7b16a3a0b7ec5a879beb8b6e003fd8c` |
| `src/exploration/native-identity-actions.ts` | 5147 | `ec22801d3fa8df9eda7087dab6e70164bec4fe258611a1d2de94f73c5fa6d991` |
| `src/exploration/native-identity-exchange.ts` | 6092 | `4149fb951acae57eabe7af02a0f482c4c564dfbaeca121ebb644e6bef8d67db1` |
| `src/adapters/external-bridges.ts` | 9590 | `1392b90c3e492c78e10c0fd2efd5f2b210b3f8f845bc759f278d1174c7978c05` |
| `src/adapters/loopback-json.ts` | 6786 | `0e058355b9424c89c1e3a879a9c9f5edf4f12cae2ab4bd5ca9358a9e8ca9bf93` |
| `schemas/lakda-native-action-v1.schema.json` | 5246 | `01708961cd961e860cb78c49f21118f340083afd6504f1fe08df48950a8e1293` |
| `tests/native-identity-actions.spec.ts` | 9471 | `5f17f03beb038207ceaae785b5dda94892418e441e5e50a626e658d453039931` |
| `tests/python/test_native_identity_actions.py` | 11668 | `b600f35750e55c696db36587fa116af075f2d227a9f7044400d0405cb4e0a345` |
| `tests/python/test_native_identity_actions_http.py` | 10524 | `6157309adc902fb639ac72740180ad35a2609a911e92503b503c785bc711db5c` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 41915 | `82b7a62c442f9418bb0edb0b8d9efb4616592cd1ef11c3b2b3c55fbe007d3b73` |
| `tools/airtest-poco-bridge/README.md` | 10947 | `cecd9b03f56554213bfd716143f51cbf3efd1707d95b0a20efd4aa02704314e3` |
| `scripts/check-package-contents.mjs` | 4655 | `69639da884dea0541410a99f63b460d54b66ea15ec0f00dacd81f7ff00c44441` |
| `scripts/check-package-install.mjs` | 15401 | `d564e95abb08dc53c1f6c942388c1ab4dfbb8dc6b68325c247cc436ccb9684d6` |
| `.lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/api.py` | 25621 | `0cd4c9eea851c9c341f01b23b353921a83246578cab86457687a5ac3e5c64dff` |
| `.lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/android/android.py` | 37460 | `443ed9f4a6f92fd18c5af0f114f08ec0eaa11160dadb97dde5217219ce413f3d` |
| `.lakda/dependency-env-py312-verified/Lib/site-packages/poco/drivers/android/uiautomation.py` | 14338 | `531e7d6371c2a69c00ada334eefaa2c68f630f5ba32080c087b48534fae3797e` |
| `.lakda/native-identity-actions-red.log` | 6515 | `f89fe3f5f601e3f7e25b26ef30330b356a63e2bd2a3313795b57c41a1481f4d2` |
| `.lakda/native-identity-actions-client-red.log` | 9271 | `29768a202bb3d8fede34cc7c3b7fd9dccde9caa72a17b9960b9141c362b1edb9` |
| `.lakda/native-identity-actions-facade-red.log` | 1471 | `5d235b978d13eaf72172c1c21727821897f7bd38e6b6aa11af4cf960d47c85b1` |
| `.lakda/native-identity-actions-facade-private-red.log` | 3274 | `1579ae810eb292c76ebd73c849fac93afe6f8c3fde0b8c71ea80cdf1ef49466a` |
| `.lakda/native-identity-actions-client-final.log` | 1563 | `f4cd6a9525bb3362b60ec8bb11092d3d1ee0daae03be80413929fe360f002fe6` |
| `.lakda/native-identity-actions-python.log` | 17661 | `bc4f238592d2a6beb647babc9b00372502aacf32cec5eb3888a6cd08346fdcd8` |
| `.lakda/native-identity-actions-python-tests/summary.json` | 21300 | `c747a3f3b3c084773546ae34b75aca75064417d198f938ff11c39b47a212a4a3` |
| `.lakda/native-identity-actions-python-tests/junit.xml` | 13314 | `248566ac2f27b4f7c6d1f2be7e0526363f06dcb5b47f10bbead8e3cf01518993` |
| `.lakda/native-identity-actions-check.log` | 82223 | `d0245f57cbaf071549dda2e97b8d5773b415dadd9680beee294dc46a8fffcf68` |
| `.lakda/native-identity-actions-pack.log` | 5040 | `d1ba93031d06adf04daf8ee65012ed9cc3e1efbe80a5d1d3404483b55fa3f5d2` |
| `.lakda/native-identity-actions-http-interop-final.json` | 255 | `55e5fe9b3761696e6e02117a8f3521ee424c15935ff8175725d4f5a9c379954a` |
