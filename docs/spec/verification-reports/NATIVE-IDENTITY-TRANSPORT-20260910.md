---
document_id: LAKDA-NATIVE-IDENTITY-TRANSPORT-20260910
status: local-evidence
last_updated: 2026-09-10
---

# Android接続世代のローカル検証

[Task 68](../../tasks/TASK.20260910-68.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md) 0.1.16、セルフレビューSR-72〜75の記録。[承認期限の伝播](NATIVE-IDENTITY-WINDOW-20260910.md)に続き、実装したADB protocol処理を観測・操作・復旧へ接続した。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存dirty差分込み。実ADB server・実機・固定SHA受入ではない。

## 実装した処理

SDK objectが同じでもADBの接続が変わるため、観測の一回用sessionと操作leaseに、継続中の監視socketとtransport IDを保持する。operatorが起動済みのloopback ADBへread-onlyのhost serviceだけを送り、操作・復旧前後にも現在状態を取得する。SDKのdevice・ADB・selectorに加え、host・port・adb_path・cmd_optionsと接続先に影響する環境変数を確認する。

監視切断、選択端末のID変更・offline・欠落・重複、不正応答、取得不能、設定変更を検出した接続は失効する。古いsession／leaseは、同じ番号が後から現れても再使用しない。現在の要求で失敗した通信を再試行せず、次の新しいopenでのみ監視を取得し直す。SDK準備中の変化は操作開始前に拒否し、SDK開始後の変化はactionAttempted=trueの失敗として残す。

同じSDK接続の監視は1本・1 threadで共有する。1 frameは65,535 bytes、一覧は256行、handshake・query・受信開始済みframeは各共通500ms以内とする。監視cacheのlock取得にも500msの上限があり、session登録lockの中でnetworkを待たない。32件のsession上限は取得前と登録直前に確認する。idle期限は照合の前後・keepaliveでも検査する。接続切替・bridge終了時はcloseに加えてthread停止を確認する。

公開schemaへraw selectorや端末一覧は追加しない。監視objectはbridge内の状態として既存connectionIdへ束縛する。取得処理からADB起動・終了・再接続commandを送信しない。SDK内部の任意時点における物理操作の取消し・atomicな中断を保証しない。

## 先行試験とセルフレビュー

- 統合前のguard試験は8件中7 failure・1 errorとなった。観測／操作がまだtransportを参照せず、監視接続数が0だった。接続後に8件が通過した。
- 後始末の試験は、test fixtureのHandler.state設定を修正した後、bridge終了時に監視が閉じられないことを検出した。mainのfinallyへ監視のcloseとHTTP serverのcloseを追加した。
- background監視の実行を置換した期限試験では、check／keepaliveの2経路で期限後の監視が生きたままになることを検出した。同期的な期限検査を追加し、旧監視の延長を拒否した。
- 通信単体の試験は10件、観測・操作・寿命の統合試験は12件となった。3種類の接続先環境変数は空文字でも拒否する。旧SDKの置換では旧threadが終了し、closeを確認できない場合には新しい監視を作らない。

初期のtest import設定やHandler.state設定のerrorは試験準備上の不備であり、runtimeの欠陥検出とは区別する。最終結果には含めず、元ログは保持した。

## 最終検証

Windows、Python 3.12.14、Node 24.11.0／npm 11.6.1。Pythonは `.lakda/dependency-env-py312-verified/Scripts/python.exe` を明示した。宣言runtimeはNode 24.6.0／npm 11.5.1で、packのEBADENGINE警告を保持する。人工ADBのTCP server、人工SDK、fixture鍵を用い、実端末へ接続していない。

| 検証 | 結果 | 範囲 |
|---|---|---|
| transport関連 | 22 passed、exit 0 | protocol 10件、観測・操作・寿命12件 |
| Python全体 | 138 tests、exit 0、failure／error／skip 0 | JSONとJUnitは各138件、transport所属22件 |
| npm run check | 511 passed、exit 0 | docs・型・Lint・build・全回帰 |
| offline npm run pack:check | 551 files／61 schemas、exit 0 | 新helper2件を必須化。隔離install・report CLIもpass |
| 最終buildのHTTP相互運用 | passed、exit 0 | Node署名wrapper → Python HTTP → production transport → 人工ADB／SDK |
| 相互運用の資源と操作 | 監視1本、現在状態query 17回、終了後thread停止 | SDK metadata query 5回、人工操作・復旧2回、共有API操作0回 |

最終HTTP試験の実行資格はfixture、署名はfixture-key-only、deviceConnected=false。native-action-result/v2のwindow binding、ordinal 1／2、actionAttempted=true／trueを確認した。transport専用試験でSDK前後の切替・監視切断・ID再使用・不正frame・timeout・資源停止を確認し、このHTTP試験では正常系の各層の接続を確認した。

実行時間（UTC）:

| command | 開始 | 終了 | exit |
|---|---|---|---|
| npm run check | 2026-09-10T14:45:27.2283220Z | 2026-09-10T14:48:53.6711770Z | 0 |
| Python全体 | 2026-09-10T14:45:27.2284987Z | 2026-09-10T14:45:36.6950840Z | 0 |
| pack:check | 2026-09-10T14:49:06.8159502Z | 2026-09-10T14:49:37.4994354Z | 0 |

再実行コマンド:

```powershell
& '.lakda/dependency-env-py312-verified/Scripts/python.exe' -B -m unittest discover -s tests/python -p 'test_native_identity_transport*.py'
npm run test:bridge:python -- --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out <new-output-directory>
npm run check
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
& '.lakda/dependency-env-py312-verified/Scripts/python.exe' -B tests/python/test_native_identity_actions_http.py --interop-node <node.exe>
```

## 残る範囲

本記録はAndroid transportのローカル実装とfixture検証に限る。実ADB serverの対応確認、実機での再接続・app情報・対象bindingの受入、Windows／iOS provider、CLIの初回／resumeへの接続、sessionへの観測・操作記録保存とHATE／report readerの照合が残る。CLI／既定readerのtarget v2拒否、Task 68のin_progress、AC-UP-008／022の未完了を維持する。

7改修全体では、媒体受渡しのIO-01・途中隔離・派生bundle、レポート容量境界・手動受入、Python対応環境／CIの実結果、変更後の固定SHAでの統合受入と外部Gateも残る。本記録だけでM1〜M3やリリース完了としない。

## 記録時点のSHA-256

以下30件は本記録のsource・仕様・検証ログのsnapshotである。後続変更時にこの表を更新せず、新しい記録を作る。旧記録のdigestは変更していない。

| path（repo基準） | bytes | SHA-256 |
|---|---:|---|
| `tools/airtest-poco-bridge/native_identity_transport.py` | 4578 | `sha256:627ea9cd07025b9ee3a0be6b51cd276f7c7c93a24fc79444defd8ef646e3a05c` |
| `tools/airtest-poco-bridge/native_identity_transport_protocol.py` | 4172 | `sha256:3e6f7c0a961be5930abf6cd0a2b643da93171f645f056c1e451b0b0c4295e20c` |
| `tools/airtest-poco-bridge/native_identity_exchange.py` | 12159 | `sha256:03225074940a7b7d2286ff1a84e08c4c6096e7b04579cfcdc594c0afef47a6d6` |
| `tools/airtest-poco-bridge/native_identity_actions.py` | 10591 | `sha256:5c1a44470482aaf4f99e17863a0ce855dd48bb2703061877cd00230d5d45b6ab` |
| `tools/airtest-poco-bridge/server.py` | 57326 | `sha256:b049cd7685bb2d9b8fd4342f2ef334b1678b3565b09184c3e9dfa0694e09c051` |
| `tools/airtest-poco-bridge/README.md` | 12873 | `sha256:658332108bd92ef38d293d9ca2adb27cd7c65672254052839caed7625714370a` |
| `tests/python/native_transport_fixture.py` | 4585 | `sha256:c382873b9c08ecf13797f46dc7a97cf4ec36bf3f4a11ef5e739ecb6369ca175a` |
| `tests/python/test_native_identity_transport.py` | 6793 | `sha256:43d662fddee33c5746d5f185821deb0be2d1643110f4e59a243ff5f7a6d97a00` |
| `tests/python/test_native_identity_transport_guard.py` | 8548 | `sha256:fa982ff212b40c1b770fc9aae9691e4b14c1a5411d3f0505e90af290511650a4` |
| `tests/python/test_native_identity_exchange.py` | 11870 | `sha256:00f5a71735c2e90ab74215e4d7a94ef7309688c958c4fce90310dcc79af48127` |
| `tests/python/bridge_fixture.py` | 3086 | `sha256:66f8e30956b59f1a64ed76e630017dca0ab3abb7b9be228dcdd70cc1405529ca` |
| `tests/python/test_native_identity_actions_http.py` | 13046 | `sha256:6ff56659956c8c9b69f6d1a501101cbaccbd8797aaeb5f7ce9f40190d325085c` |
| `scripts/check-package-contents.mjs` | 4937 | `sha256:effb6f52f4891d8d8d239c8f2c15e93f4207be0f577eee029f1470a93b505fb0` |
| `scripts/check-package-install.mjs` | 15828 | `sha256:6e6140833443fe19163bedf161b3bfaa9ab83fb0ffc81196c72b59a34ec463cd` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 47969 | `sha256:a35d211dae2f6a1e5e583ac3e13aca12d18a11d1e42c57abd6080eff08d102a3` |
| `docs/spec/verification-reports/SELF-REVIEW-20260910.md` | 43457 | `sha256:ba94cc3daff207c414889ad4144f52a145c5c9d28e66adc968434d8e6138aac9` |
| `.lakda/native-identity-transport-all.log` | 126 | `sha256:e280524c50781e0d1afef0f32cbc5f1395a12b0ec62e81ad1ea3fb763112c0a4` |
| `.lakda/native-identity-transport-final-python.log` | 24219 | `sha256:aa80c821d343580024fb83cd5ddafa1126fad5c19fb0997dacde4e3b1406364d` |
| `.lakda/native-identity-transport-final-python-tests/summary.json` | 29405 | `sha256:fe6bf5b734f16e88bc38fc6ff62f1f0a5d034b96bfd97d74abae45f13d552702` |
| `.lakda/native-identity-transport-final-python-tests/junit.xml` | 18622 | `sha256:b44f94bf23220f80b60bff7e57cd16858c5844d7bf3d6c718680900ac572e4fd` |
| `.lakda/native-identity-transport-final-check.log` | 84063 | `sha256:7d87e65d9800f8eaa9815ef55dab94052346d779c9be627ebfd323656f9db79a` |
| `.lakda/native-identity-transport-pack.log` | 5219 | `sha256:e69077461eedfb76d9f94d38b04f18e33bf9602b7c2a01536f8ae01b958d3825` |
| `.lakda/native-identity-transport-final-interop.json` | 439 | `sha256:bb24d9b1661349dea9d265a7033ed1dad92709b390fb7cc3ee4b544bfc0c4c14` |
| `.lakda/native-identity-transport-final-interop.stderr.log` | 0 | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `.lakda/native-identity-transport-check-timing.json` | 92 | `sha256:ded015118915b9fa9d8a02507d9ade7253d81f31d3bb27c14c4ff39df6bd07f3` |
| `.lakda/native-identity-transport-python-timing.json` | 92 | `sha256:59c71a3ac40bb9d614d866455b57e3eaf713f4bf69910718cc021d3bff847632` |
| `.lakda/native-identity-transport-pack-timing.json` | 92 | `sha256:395124cf9ab79f66be457c1febebedc484dee05421db260e2677c10ba0b31955` |
| `.lakda/native-identity-transport-guard-red.log` | 5804 | `sha256:40e5020932c7c17aa71d8641b7bde895e7f0d11e76bc8d679306e75cd6d78faa` |
| `.lakda/native-identity-transport-lifecycle-red-fixed.log` | 727 | `sha256:f94fcad9c0ae303239ca11f27332ae387931b21dbcf37ff3ac8e8a4c4337227f` |
| `.lakda/native-identity-transport-idle-red.log` | 1730 | `sha256:60ad3d9a6895923cdc6eb06b8e8cc8b4908b0f1bea3fff5c353892d763b3cc48` |
