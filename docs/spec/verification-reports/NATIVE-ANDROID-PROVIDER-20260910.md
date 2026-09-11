---
document_id: LAKDA-NATIVE-ANDROID-PROVIDER-20260910
status: local-evidence
last_updated: 2026-09-10
---

# Android実観測providerのローカル検証

対象は[Task 68](../../tasks/TASK.20260910-68.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)、REQ-UP-IDN-001〜005のAndroid取得部分。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存dirty差分込み。固定SHA・実機受入ではない。[先行の観測記録・照合器](NATIVE-IDENTITY-CONTRACT-20260910.md)に続く実装である。

## 追加した処理

operator bridge内の `native_identity_fields()` から、接続済みAirtest 1.3.5のADBで対象packageと端末propertyを読み取るproviderを呼ぶ。provider名は `lakda-airtest-android`、版は `1.0.0-airtest-1.3.5`。app IDを照会条件として検証し、応答の一意なPackage headerとversionCodeからinstalled appを観測する。CLIのapp revision、OS version、serial digestを観測値へ代入しない。

固定のread-only queryだけを使用し、端末propertyとpackage情報を再取得して一致を確認する。SDK object・selectorとBridgeStateのdevice／runtimeの差替えも拒否する。SDK版不一致、未接続、取得失敗、不正・曖昧な応答、期限切れでは観測成功にしない。SDKのcommandには共通予算の残時間を渡し、返却後にも期限を確認する。raw serialは共通canonical JSON規則のSHA-256へ変換する。

AirtestのADB APIの根拠は[公式API reference](https://airtest.readthedocs.io/en/latest/all_module/airtest.core.android.adb.html)と、導入済み1.3.5の `adb.py`／`compat.py`。最新ドキュメントを固定版の証明に使わず、読んだローカルsourceのdigestを末尾へ保存した。固定版ではADB commandをDEBUGへ出力し、timeout例外にも引数・出力を含め得るため、観測threadの当該loggerを抑制し、SDK例外本文を結果へ転記しない。他threadのloggingと既存filterは保持する。

## 検証結果

環境はWindows／Python 3.12.14、Airtest 1.3.5、Node 24.11.0、npm 11.6.1。packageの宣言runtimeはNode 24.6.0／npm 11.5.1であり、EBADENGINE警告を保持する。導入済みSDKからのimportには既存SyntaxWarningがあった。実機へは接続していない。

| 検証 | 実結果 | 範囲 |
|---|---|---|
| provider実装前の試験 | 11 tests実行、exit 1、28 errors（subtestを含む） | provider本体の未実装stubが失敗することを確認。既存不具合を実機再現した記録ではない |
| 途中のprovider関連試験 | 14 tests、exit 0 | 最後のBridgeState差替えcase追加前のlogとして保持 |
| 最終 `npm run test:bridge:python` | 63 tests、exit 0、failure／error／skip 0 | 新しいAndroid関連15件を含む。JSONとJUnitの63件一致も照合 |
| `npm run check` | 468 tests、exit 0 | docs、型、Lint、build、既存全回帰。TypeScriptのnative照合12件を含む |
| 初回 `npm run pack:check` | 530 files／57 schemas、exit 0 | offline cache、隔離install、CLI／package import／report検証 |
| 配布検査補強後のLint＋pack | 530 files／57 schemas、exit 0 | 新helperを必須fileとし、隔離install先で存在確認する検査を追加 |
| 導入済みSDKの互換性probe | 5回の実SDK cmd呼出し、process起動0、端末接続0 | Popenを偽processに置き換え、SDK実装の引数・bytes・ログ抑制を確認 |
| Python／TypeScript digest相互運用 | 3 cases一致 | ASCII、日本語＋絵文字、UTF-16で512 unitsの境界 |

Python全体はUTC `2026-09-10T11:02:50.0618818Z`〜`2026-09-10T11:02:55.8566786Z`、全体checkは `2026-09-10T11:02:49.7850908Z`〜`2026-09-10T11:05:37.6416140Z`。初回packは `2026-09-10T11:05:58.6466996Z`〜`2026-09-10T11:06:22.3680311Z`。

その後の変更はpackage checkerのhelper必須化2か所であり、runtime・schema・testは変更していない。補強後のLint＋packは `2026-09-10T11:09:32.9734936Z`〜`2026-09-10T11:10:00.5967316Z`。全体checkを補強後に再実行したとは主張しない。isolated installのairtestBridge結果は配布fileの存在確認であり、配布先の実機操作成功を意味しない。

新しい15件は、正常取得、版固定、入力拒否、package header／versionの曖昧さ、別sectionの値の拒否、端末・build変化、SDK／BridgeState接続切替、未接続時のquery 0、通信失敗・不正UTF-8・過大応答、共通期限、property不正、thread単位のログ抑制、digest規則、宣言との分離、未対応platformの拒否を検証する。実SDK probeは `ADB.__new__` で接続初期化を行わず、実 `cmd`／`start_cmd` と偽 `subprocess.Popen` を組み合わせた人工入力の検証である。

## 残る実装と受入

- 現在はbridge内部のfields取得まで。公開HTTP endpoint、観測recordの組立て、接続ID・challengeの発行／照合、署名済みexploration target manifest v2、初回action前・resume・再接続への接続は未実装。
- Windows／iOS providerと実機3laneの受入は残る。Androidについても端末上の取得成功・timeout・実SDK接続切替を確認していない。
- installed appの一致をforeground windowの証明とはしない。各応答1 MiBの検査はSDKから返った後に行い、SDK内部のbuffer割当を制限するものではない。
- ログ抑制の確認範囲はこの観測threadのADB query。bridge起動時・他SDK操作を含む全ログの秘匿を実証したとは扱わない。
- 当該providerの内部snapshotは承認や操作許可ではない。既存capabilityのCLI宣言値を、新しい実観測へ自動昇格していない。
- Task 68、AC-UP-008／022、固定SHA・宣言runtime・manual-bb・外部QEGの受入は未完了。媒体の隔離途中・派生bundle・IO-01を含む7領域全体の完了条件を維持する。

## 再検証

既存の導入済みPythonを使う例。出力先は履歴を上書きしない新しいdirectoryにする。

```powershell
npm run test:bridge:python -- --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out <new-output-directory>
npm run check
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
```

SDK probeはローカル補助検証であり、stdlibだけのCI試験にSDK import要件を追加していない。digest相互運用の保存JSONは人工identifierのみを含み、実端末情報ではない。

## 検証対象・記録のdigest

最終のruntime・testと各検証log、SDK sourceを含む20件。途中のred／14件pass／初回packは履歴として区別する。本文書と後からリンクを加えるTask・索引・checklist・セルフレビューは表へ含めない。過去記録のdigestは当時のsnapshotとして保持する。

| file | bytes | SHA-256 |
|---|---:|---|
| `tools/airtest-poco-bridge/native_identity.py` | 5652 | `aea6e3f20895829088b07d11101dd35db7456eb6751fd36d78f59df8b2145c96` |
| `tools/airtest-poco-bridge/server.py` | 54528 | `f42771cdd4595a3240da0b99d7a28611d4f7463df5d7ee4d5acc34627598898b` |
| `tools/airtest-poco-bridge/README.md` | 8170 | `2378622885989675c48b4771a9e551b672d0155894f2a0c2270e2131db9e9081` |
| `tests/python/test_native_identity.py` | 10912 | `efdfb8a14a369ab8e98b2ff517f8cf9e6afea3160a3de0ec9049d33005e7f333` |
| `tests/python/bridge_fixture.py` | 3034 | `4af688b908ce05d0a89fcbf48ecfe9113c785d2eb646948e2f0c7da4191bb67b` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 33137 | `6433412edb49abc5dc37e454bca55d0479f22bdea2233d2e1bb1a4700083a8b0` |
| `.lakda/native-android-provider-red.log` | 32280 | `febbea34e9f3eed1b3379ba54ce205e4c3201fed19a58e8b94920f6c66cd1a3d` |
| `.lakda/native-android-provider-related.log` | 118 | `5e156742d1f628b949efda9f1a0100d05f6779211b4cee9f149906fc1355c5eb` |
| `.lakda/native-android-provider-python.log` | 10516 | `d0c9912a94c003e5879cbdc45c0782e56f72c9500c0f6804424f6a90a202b52d` |
| `.lakda/native-android-provider-check.log` | 78021 | `3b17256ddf9c19a68725afaf1416cbb5c7c4d7dd8ae5eda5ee88a4430eadfc86` |
| `.lakda/native-android-provider-pack.log` | 4722 | `34679e20750b9eb0b6555712fba929cdba3b14c6987a39d4d045dc47c5a8c713` |
| `.lakda/native-android-python-tests/summary.json` | 12934 | `b6b5aaa8dad3de355126d618a2c913e816245a4960889fcbcfd3eecec740040d` |
| `.lakda/native-android-python-tests/junit.xml` | 7824 | `9198eae9b6b49ba6aa4dcd475beeec11bad14b9ac51b48257d428f1ba7bab7c0` |
| `.lakda/native-android-sdk-probe.json` | 792 | `8815764e1865614bb837caa531438ce9a09197e5ddba720c931286aa32096814` |
| `.lakda/native-android-digest-interop.json` | 1524 | `c9b255bd62bcf5d0384bdc3ba6fbf587225e6b10e05baf3f24b3da7ee2e7c6a7` |
| `.lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/android/adb.py` | 62305 | `4e606e67cfa1b92dac67b01215d131bc0f87b13bda9cc01f380e96b64ba2a68c` |
| `.lakda/dependency-env-py312-verified/Lib/site-packages/airtest/utils/compat.py` | 3066 | `da1c8128668e790e4bc606dc698f3a431b82610e2abf96db729b8576e3f7e52c` |
| `scripts/check-package-contents.mjs` | 4538 | `b7dbd20b27f261a48c9923435e4b9a30026552ba347809d21cad568f39327110` |
| `scripts/check-package-install.mjs` | 15280 | `97147f07b1093028b3281e7a37ae4bd6a64aeca17b30de14e59fc892053954de` |
| `.lakda/native-android-provider-package-final.log` | 4838 | `893ce1a07713bfc70be630e3fd7c98239f01dd85d7a615ca50342331f33be173` |
