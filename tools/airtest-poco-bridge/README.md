# Lakda Airtest/Poco loopback bridge

これは operator が手動起動するリファレンス bridge です。Lakda はこのプロセスを起動せず、`127.0.0.1` の JSON endpoint にだけ接続します。

```powershell
python -m pip install -r tools/airtest-poco-bridge/requirements.txt
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

依存はPython 3.10+を運用想定とするoperator管理venvでだけ解決します。現在のLakdaローカルGateではPython runtimeがなく、この組合せの実行確認は未実施です。`requirements.txt`はinstall入力であり、transitive dependencyまで固定した完全lockではありません。`requirements.top-level-attestation.txt`はAirtest／Poco本体のtop-level source distribution versionとSHA-256のattestationで、pipへ直接渡すconstraintsではありません。Lakdaはinstall、upgrade、bridge起動を行わず、transitive dependencyの解決結果を運用者がレビューして別途固定してください。認証情報、raw device serial、実入力はbridgeの公開JSONやartifactへ返しません。

`examples/airtest-templates.json`は実画像を同梱しない非実行サンプルです。`operatorReplacementRequired`が`true`のままではbridgeが起動を拒否します。operatorは承認済み画像をmanifest親ディレクトリ（または明示した`--templates-root`）配下へ配置し、`REPLACE_WITH_OPERATOR_TEMPLATES/...`を置換し、各entryへ実画像の`sha256:...`（64桁小文字hex）と`confidence`（有限な0超1以下）を設定したうえで`operatorReplacementRequired=false`に変更してください。bridgeは起動時に各画像の実bytes SHA-256を再計算し、manifestの宣言と一致しない差替えをfail-closedで拒否します。AirtestのTemplate matcherにも同じconfidenceをthresholdとして渡します。各画像pathはrootからの相対pathで、root外、絶対path、存在しないpath、regular fileでないpathも拒否されます。画像entry／Poco entryのid重複も起動時に拒否します。

Poco候補はmanifestの`poco`配列に`operatorApproved=true`かつ`mutationKind=none`で明示したsemantic idだけが候補になります。未承認・未知のPoco要素は操作せず`unsupported-control`のcoverage debtとして記録します。

`--platform windows`、`--platform android`、`--platform ios` は独立したlaneです。capability handshakeは設定済みplatformとlivenessを明示し、Charterのlaneと一致しないbridgeはpreflightで停止します。実機接続、target revision、template corpus、artifact staging rootはCharterと一致させてください。Androidで録画 capabilityがない場合、bridgeは `sampled-frames/v1` を広告します。sampled frameはvideoとして登録しません。

実機laneでは`--serial-digest`と`--device-alias-digest`をraw値ではなく事前計算済みの`sha256:<64hex>`で渡します。`--app-id`、`--app-revision`、`--target-revision`は署名済みtarget manifestの値と一致させます。これらはreference bridgeが実機APIから取得する値ではなく、operatorがCLIで宣言した値です。bridge bindingは宣言の差替えを検知しますが、宣言の真正性までは証明しません。real acceptanceでは実機側の取得記録、operator署名、manual-bbを別証跡として照合してください。

Airtest/Poco未インストール時はcapabilityが欠落した状態で起動し、対象操作を実行しません。loopback以外へのbind、redirect、非JSON request、異なるOrigin、JSON 1 MiB超のpayloadは許可しません。また、このreference bridgeはbinary artifactのscan／署名attestationを生成しません。real runで画像・録画をHATEへ登録する場合は、target manifestで許可した外部attestorを別途用意してください。
