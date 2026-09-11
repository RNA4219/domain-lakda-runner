# Lakda Airtest/Poco loopback bridge

これは operator が手動起動するリファレンス bridge です。Lakda はこのプロセスを起動せず、`127.0.0.1` の JSON endpoint にだけ接続します。

## Android録画と媒体形式

固定Airtest 1.3.5では、接続済みdeviceの`start_recording`／`stop_recording`を使い、`artifacts/video/0001.mp4`へ保存します。開始結果のpathと停止結果の`True`を確認してから媒体を返します。停止失敗では状態を保持し、開始時に保持した停止methodで再度確認します。共有APIやdeviceの参照が変更されても、停止先を新しいdeviceへ切り替えません。

deviceが録画methodを両方とも持たない場合の共有API注入は従来WebM互換用です。片方だけあるdeviceでは録画不可とします。MP4も外部署名が必要な経路では、検査とbytes照合が完了するまで検査済み証跡にしません。

このmethod固定は、SDK内部の再接続・native lease・承認期限に沿った背景撮影の停止を保証するものではありません。native target v2のCLIでは連続撮影offの制限を維持しています。詳細と受入条件は[SPEC-02](../../docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)を参照してください。

native撮影の内部guardでは、観測leaseと承認window、ADB・recorder・processの対応を確認します。画像は保持したADBから取得し、録画は背景監視で失効を検出します。終了要求のtimeoutは停止完了とせず、同じ進行中workerを後続要求から確認します。closeでは先に所有する撮影を止め、確認できなければ新しいnative処理を拒否したまま終了処理用の接続を保持します。録画開始の応答不明も状態を残し、所有を推測した停止を行いません。

このguardは`native-capture` HTTP v1とNodeの`nativeCapture`へ接続します。撮影専用連番、開始時の識別番号、要求digestを照合し、同じ直前要求はSDKを再実行せず保存応答を返します。古い番号・内容が異なる同番号・別run／保存先の停止は拒否します。期限後のstop／discardは元guardによるcleanupだけを許します。保存応答の再送を現在の撮影状態の確認には使いません。

`npm run build`後、`<python.exe> -B tests/python/test_native_identity_capture_http.py --interop-node <node.exe>`で、人工SDKに対するNode／Pythonの撮影HTTP相互運用を確認できます。署名済みfacadeとsession証跡への撮影記録は継続中であり、CLIの連続撮影・実機受入が完了したとは扱いません。

## bridge本体のローカル動作検証

repository checkoutでは、Airtest／実機を使わずPython本体のcapture・停止・HTTP境界を検証できます。Python実行fileを明示するか、`LAKDA_PYTHON`へ設定してください。自動installやruntime不在のskipは行いません。

```powershell
npm run test:bridge:python -- --python C:\path\to\python.exe
```

JSON summaryとJUnitは`.lakda/qa/python/`へ出力します。Windows CIのfixture jobはPython 3.13を指定し、ローカルではPython 3.12.14で実行確認しています。これらはstdlib／偽deviceでの動作検証で、下記Airtest／Poco依存や実機接続の対応確認とは別です。

summaryの`executedTests`は実行開始したcase数、`tests`はJUnitのtestcaseに対応する結果record数です。module／classの初期化・後始末errorには独立したfixture recordを作り、未計測時間はnullとします。expected failureは専用状態で記録しJUnitではskipped、unexpected successはfailureへ対応させます。JSONの`ordinarySkipped`と`expectedFailures`は別件数で、`skipped`はJUnitとの照合用に両者の合計を持ちます。0件・全skip・全expected failureは不合格となり、`reason`と非0終了codeで示します。subtestの後続skipで既存の失敗・errorを消しません。

capture要求の競合はbusyとして拒否します。停止不能・撮影途中失敗・frame欠落／差替えは成功にせず、未停止backendの状態を保持します。不正UTF-8／JSONや非object requestはHTTP 400で対象操作前に拒否します。

Androidの実観測providerをbridge内部の`native_identity_fields()`へ追加しています。接続済みAirtest 1.3.5から対象packageのinstalled build、端末property、OS releaseを読み、取得前後の不一致や取得失敗を拒否します。既定5秒の共通予算を各commandへ渡し、raw serialをdigestへ変換します。SDKのADBログ抑制はこの観測を呼ぶthread内に限ります。現在のcapabilityにあるCLI宣言値は従来の宣言であり、新観測へ自動的に置き換わりません。署名済みtarget照合・初回／resume接続とWindows／iOS providerは実装途中です。詳細は[Native identity仕様](../../docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)を参照してください。

HTTP受渡しはPOST `native-identity-open` → `native-identity-observe`です。serverが発行する一回用connectionIdを現在のSDK接続とcapability digestへ束縛し、30秒以内・未消費32件まで扱います。observeはprovider呼出し前にsessionを消費します。接続切替・期限切れ・二重送信では新しいopenが必要です。TypeScriptの`LoopbackJsonBridge.observeNativeIdentity()`は同じ全体15秒の予算で両方を要求し、4 KiB／16 KiBの受信上限とschema・binding・時刻を照合します。この通信結果だけでtargetを承認せず、実行前の署名済み条件との接続は後続作業です。

native専用の`lakda/exploration-target-manifest/v2`は、端末digest・許可provider・必須観測・maxAgeMs・providerごとのbuild mappingを署名へ束縛します。承認期間等の署名metadataもpayloadに含め、v1の署名形式と読取を維持します。内部の署名済み実行wrapperと証跡保存を段階的に接続しています。CLI初回／resumeと既定readerへの接続が完成するまでは、CLIでv2をbridge接続前に拒否します。

共通target loaderのv2検証は`nativeIdentityPolicy: "validate-only"`を明示した場合だけ行います。省略した既存HATE／report／acceptance readerはv2を拒否し、署名済みpolicy文書だけを新identityの保存証跡として受理しません。この指定自体は実行許可ではありません。

POST `native-action`は観測記録のdigest・接続ID・challenge・連番を照合し、通常操作と復旧を観測したdeviceへ送ります。candidate準備後とSDK呼出し前後で期限・接続・選択device・Poco bindingを確認します。SDK操作を開始した後の失敗は`actionAttempted=true`で残します。この低水準APIだけでは署名済みpolicyの適用やsession証跡の保存を完了せず、CLIのv2拒否は維持します。

Androidの観測・操作は、接続済みAirtest 1.3.5のADB設定に一致するloopback serverを読み取り確認します。`host:track-devices-l`の継続接続と`host:devices-l`のtransport IDを照合し、同じSDK objectでもID変更・offline・監視切断・設定変更で旧session／leaseを拒否します。新しい観測には新しいopenが必要です。1接続を共有し、I/Oは各共通500ms、保持期間はsession期限と観測期限の合計以内とし、bridge終了時にthread停止を確認します。ADB serverの起動・再接続commandは送信しません。SDKと照合先の相違を避けるため、`ADB_SERVER_SOCKET`／`ANDROID_ADB_SERVER_ADDRESS`／`ANDROID_ADB_SERVER_PORT`が定義された環境ではこの取得を拒否します。任意のSDK内部時点での操作取消しを保証するものではありません。人工TCP peerでの検証であり、実ADB server・実機受入は未実施です。

native-action v2は、検証済みtarget文書の実bytesのSHA-256と承認期間を追加制約として渡します。bridgeは最初の要求でleaseへ固定し、途中の延長・target変更・v1への変更を拒否します。操作準備後とSDK呼出し前後に承認のwall clock・単調時計期限を確認します。Node内部の`createNativeIdentityExecutor`は署名とidentityを検証してv2へ接続し、期限の起点を維持します。失敗後は停止し、通信の成否が不明なら操作開始の有無をunknownとして扱います。bridge単体ではoperator署名を検証せず、CLI接続は継続中です。

Nodeの内部sinkは、session内へ観測→操作予定→操作終了の順に`lakda/native-execution-evidence/v1`を保存し、checkpointの参照とSHA-256を読取時に照合します。要求本文・入力値は保存せず、予定保存の失敗・期限切れではSDKへ進みません。応答不明や保存途中の不整合は未完了として残します。`complete`は記録の整合を示す値で、操作成功や実機受入の判定ではありません。HATE／reportの既定readerとの統合は残ります。

Windowsのnative protocolは高精度UTC APIを必須とし、Python 3.12の粗いtime.timeへfallbackしません。Nodeとの時計差で応答時刻が20ms以下だけ先に見える場合、受信側が元の予算内で20msを一度待ち、厳格に再検査します。待機後も未来・要求前・期限切れなら拒否します。期限を延ばしたりHTTP／SDK操作を再実行したりする処理ではありません。

build後に`<python.exe> -B tests/python/test_native_identity_actions_http.py --interop-node <node.exe>`を明示実行すると、人工ADBの実TCP接続・人工SDK・Python HTTP・Nodeの署名済みwrapper・fixture鍵のtarget v2検証・native-action v2応答・sessionの5件の証跡保存と再読取を確認できます。証跡は`.lakda/native-identity-evidence-interop-<固有値>/`へ残ります。実端末の操作やoperatorの実承認を示すものではありません。

`npm run build`後、`<python.exe> -B tests/python/test_native_identity_http.py --interop-node <node.exe>`で、Pythonの実HTTP handlerとbuild済みNode clientを人工のSDK応答へ接続できます。実端末・SDK processは起動せず、明示実行した場合だけNodeを使用します。通常のPython unittest discoveryへNode依存を追加しません。

## 導入済み依存とlockの照合

対象環境は[RUNTIME-MATRIX](RUNTIME-MATRIX.md)を参照してください。hash付きlockからinstallしたvenvのPythonで、`verify_dependencies.py --lock <lock-file> --out <new-evidence.json>`を実行します。新しい出力先を指定し、既存証跡への上書きはできません。検証処理はpackageのinstallやdevice接続を行いません。

v2の[証跡schema](../../schemas/lakda-bridge-dependency-verification-v2.schema.json)では、必要packageのversion照合、除外したinstaller、7 moduleのimport結果を個別に記録します。interpreterのpurelib／platlibを列挙し、同名重複・欠落・version差・未固定packageを拒否します。未固定の`pip`だけはinstallerとしてversionを記録して除外します。import時に検索対象へ加わるvendored distributionを導入済みpackageへ混ぜず、import元も同じ環境のsite-packages配下か確認します。

lockは1 MiB以下のUTF-8で、完全固定の`name==version`、SHA-256 hash、継続行、空行、行頭commentに対応します。未対応のmarker、URL、別file参照などを黙って無視しません。照合不合格時はmoduleのimportを行わず、理由を保存します。書込可能なら不合格の証跡も保存し、保存失敗は`evidenceSaved=false`と非0終了で通知します。v2は導入versionとimportの確認であり、導入後の全file bytesや実機動作の保証ではありません。

## operatorによる実機接続

```powershell
python -m pip install --require-hashes -r tools/airtest-poco-bridge/locks/windows-amd64-py312.txt
python tools/airtest-poco-bridge/server.py `
  --platform android `
  --target-revision approved-app-build-20260802 `
  --app-id com.example.approved `
  --app-revision approved-app-build-20260802 `
  --device-uri "Android:///" `
  --templates examples/airtest-templates.json `
  --templates-root examples `
  --allowed-staging-root .lakda/runs
```

上のinstall例はWindows／AMD64／Python 3.12.14向けです。[runtime matrix](RUNTIME-MATRIX.md)にhash付きlock、clean installとimport結果、未検証環境を記録しています。`requirements.txt`はresolver入力、`requirements.top-level-attestation.txt`はAirtest／Poco本体の過去のtop-level source attestationです。後者をpipのconstraintsに使わないでください。実機受入は未実施で、他環境への互換性をこのimport結果から推定しません。Lakda本体はinstall、upgrade、bridge起動を行いません。認証情報、raw device serial、実入力はbridgeの公開JSONやartifactへ返しません。

`examples/airtest-templates.json`は実画像を同梱しない非実行サンプルです。`operatorReplacementRequired`が`true`のままではbridgeが起動を拒否します。operatorは承認済み画像をmanifest親ディレクトリ（または明示した`--templates-root`）配下へ配置し、`REPLACE_WITH_OPERATOR_TEMPLATES/...`を置換し、各entryへ実画像の`sha256:...`（64桁小文字hex）と`confidence`（有限な0超1以下）を設定したうえで`operatorReplacementRequired=false`に変更してください。bridgeは起動時に各画像の実bytes SHA-256を再計算し、manifestの宣言と一致しない差替えをfail-closedで拒否します。AirtestのTemplate matcherにも同じconfidenceをthresholdとして渡します。各画像pathはrootからの相対pathで、root外、絶対path、存在しないpath、regular fileでないpathも拒否されます。画像entry／Poco entryのid重複も起動時に拒否します。

Poco候補はmanifestの`poco`配列に`operatorApproved=true`かつ`mutationKind=none`で明示したsemantic idだけが候補になります。未承認・未知のPoco要素は操作せず`unsupported-control`のcoverage debtとして記録します。

`--platform windows`、`--platform android`、`--platform ios` は独立したlaneです。capability handshakeは設定済みplatformとlivenessを明示し、Charterのlaneと一致しないbridgeはpreflightで停止します。実機接続、target revision、template corpus、artifact staging rootはCharterと一致させてください。Androidで録画 capabilityがない場合、bridgeは `sampled-frames/v1` を広告します。sampled frameはvideoとして登録しません。

実機laneでは`--serial-digest`と`--device-alias-digest`をraw値ではなく事前計算済みの`sha256:<64hex>`で渡します。`--app-id`、`--app-revision`、`--target-revision`は署名済みtarget manifestの値と一致させます。これらはreference bridgeが実機APIから取得する値ではなく、operatorがCLIで宣言した値です。bridge bindingは宣言の差替えを検知しますが、宣言の真正性までは証明しません。real acceptanceでは実機側の取得記録、operator署名、manual-bbを別証跡として照合してください。

Airtest/Poco未インストール時はcapabilityが欠落した状態で起動し、対象操作を実行しません。loopback以外へのbind、redirect、非JSON request、異なるOrigin、JSON 1 MiB超のpayloadは許可しません。また、このreference bridgeはbinary artifactのscan／署名attestationを生成しません。real runで画像・録画をHATEへ登録する場合は、target manifestで許可した外部attestorを別途用意してください。
