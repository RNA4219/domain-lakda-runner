---
document_id: LAKDA-NATIVE-EVIDENCE-20260911
status: local_verified
last_updated: 2026-09-11
specification: SPEC-02-NATIVE-EVIDENCE.md
---

# native実行証跡の保存・読取と相互運用のローカル検証

[仕様](SPEC-02-NATIVE-EVIDENCE.md)、[Checklist 02](CHECKLIST-02-NATIVE-EVIDENCE.md)、[Task 68](../../tasks/TASK.20260910-68.md)。Python fixtureと配布除外の修正は[Task 62](../../tasks/TASK.20260910-62.md)にも属する。日付はJST、以下の実行ログ内の時刻はUTC。過去の検証記録は変更しない。

## 対象と変更

基準HEADは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、作業中の差分を含む。Node v24.11.0／npm 11.6.1、Windows、Python 3.12.14で検証した。packageは0.5.0-rc.1。宣言Node 24.6.0／npm 11.5.1と固定したclean SHAによる正式受入ではない。

- 内部executorへ任意の証跡sinkを接続し、観測→操作予定→操作終了を保存する。予定の保存前にSDKを呼ばず、通信後に応答を検証できなければ開始の有無をunknownとして残す。
- 要求全文を保存せず、digest・lease・承認window・candidateの照合参照を保存する。応答の照合器は実通信と保存済み記録で共有する。
- `lakda/native-execution-evidence/v1`をsession内へ排他的に保存し、checkpointのversioned参照、file bytes、署名済みtargetへのbinding、phase・ordinalを再照合する。
- 保存先の呼出し後変更、観測の再使用、読取途中の増大、孤立・未完了・改変記録を拒否する。checkpoint追記の前後でも同じI/O期限を検査する。
- 正常HTTP応答がNode時計より5ms先に見える失敗を確認し、1〜20msの差では共通予算内で20msを一度待って再検査する。時刻の補正、未来・要求前・期限切れ条件の緩和、通信や操作の再送は追加していない。
- ヘッダーだけで拒否するPython fixtureは本文を送らず、本文検査caseは維持する。Python cacheが存在したままpackageから除外し、混入をcheckerでも拒否する。

## 検証結果

| 検証 | 実結果 | 証跡 |
|---|---|---|
| 時計差の先行試験 | 1 failed／1 passed。5ms先の時刻で待機しない旧処理を検出 | `.lakda/native-evidence-clock-red-20260911.log` |
| 時計・HTTP契約 | 23 passed。待機のabort、待機後も未来／要求前の拒否、binding・容量・共通15秒予算を含む | `.lakda/native-evidence-clock-green-20260911.log` |
| checkpoint期限の先行試験 | 予定追記中の期限切れでSDKへ進む挙動を検出 | `.lakda/native-evidence-checkpoint-red-20260911.log` |
| checkpoint修正後 | 1 passed。予定の保存ではSDK0件、終了の保存ではSDK1件とreceipt保持、以後停止 | `.lakda/native-evidence-checkpoint-fixed-20260911.log` |
| npm run check | docs・型・lint・build・全527件 passed、exit 0 | `.lakda/native-evidence-final-check-20260911.log` |
| Python全体・最初の実行 | 138件、error 1。既存ヘッダー拒否fixtureの応答読取で接続切断 | `.lakda/native-evidence-final-python-20260911/summary.json` |
| Python fixture修正後 | 138件、failure／error／skip 0、exit 0。JSONとJUnitを保存 | `.lakda/native-evidence-final-python-fixed-20260911/` |
| ヘッダー／本文のHTTP試験 | 5件を5回、全回exit 0。statusとdispatch 0件の期待値を維持 | `.lakda/native-evidence-http-fixture-20260911-trials.json` |
| package混入の先行検査 | cacheが含まれる配布一覧を新checkerで拒否、exit 1 | `.lakda/native-evidence-package-cache-red-20260911.log` |
| offline npm run pack:check | 561 files／62 schemas、隔離installとnative evidence import、既存report CLI等がpass、exit 0 | `.lakda/native-evidence-pack-final-20260911.log` |
| 診断を外した相互運用 | 時計修正後の10回と、その後の最終runtimeで1回pass。各回で人工操作と復旧、5記録を確認 | `.lakda/native-evidence-interop-20260911-trials.json`、`.lakda/native-evidence-final-interop-20260911.json` |

全527件の実行はUTC 2026-09-10 15:53:20〜15:56:27。その後のsource差分はPython HTTP fixture、package checker、配布除外で、それぞれ上記のPython／package検証を適用した。TypeScript runtimeとそのtestは全体検証後に変更していない。

## 相互運用の範囲

人工ADB peerの実TCP接続→Python HTTP handler→Android providerの人工SDK→Nodeのfixture署名済みwrapper→session file保存→独立readerを接続した。最終結果はnative-action v2、ordinal [1,2]、actionAttempted [true,true]、5記録、complete=true。人工SDK操作2回、共有API操作0回、SDK読取5回、ADB query17回、監視接続1本、終了時の監視thread停止を確認した。

保存sessionは`.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179`。fixture内のexecutionMode=realはv2契約の試験用であり、実環境受入の資格を与えない。承認は一時生成したfixture鍵のみ。実端末・実ADB server・実app・実operator承認は使用していない。

失敗の診断では、既存検証式の直前に数値と固定codeを同期記録した。失敗回はissued=1789055061404、sessionNow=1789055061399、HTTP200、challenge／platform／binding一致であった。診断用load hookは配布sourceに含めず、最終相互運用では使用していない。以前のunwrapped試験・診断ログ・保存されたunknown記録は保持する。

## 残る必須作業

CLI初回／resumeとHATE／reportの既定readerへnative証跡を接続する工程、Windows／iOSの実provider、実機3lane、固定SHA・指定runtimeの受入は未完了。v2の既存CLI／既定reader拒否とAC-UP-008／022の未完了状態を維持する。媒体の隔離・期限後bundle、report容量境界、他の改修Taskも引き続き全体の対象である。

readerのcompleteは記録の整合であって操作成功ではない。署名／trust検証は呼出し側の責務。file公開とcheckpoint追記は単一transactionではなく、未完了時は不足を検出して停止する。稼働中のI/Oの強制中断、directory／eventの電源断耐久性、実時間の独立証明はこの試験から主張しない。ヘッダー拒否fixtureの修正もOS接続切断全般の解決を意味しない。

## SHA-256

以下はこの記録時点の実bytes。sourceの後続変更で更新せず、新しい検証記録を作る。

| path（repository基準） | SHA-256 |
|---|---|
| `src/exploration/native-identity-actions.ts` | `9383916f1f5db21e9a40f0e07ac07775da5171a1920a80f6fb378361db610924` |
| `src/exploration/native-identity-exchange.ts` | `9a5f2dd123c3d5a1b9c538339926bec88a88213eb57a06d93115001227c8e6df` |
| `src/exploration/native-identity-executor.ts` | `539015f653a0af71daf09a7471d1aee11a20059b9f4cb24e3855eb3bd2c6c058` |
| `src/exploration/native-identity-evidence.ts` | `c4d876755fa1f71be1a5c0c7cd417e75eb4488021a0cb79c834344dde33c08a3` |
| `src/exploration/native-identity-evidence-io.ts` | `d08e35feff44bda8bf370bdac2f57d9cc87177f23a048440b8f807d37c937ea8` |
| `src/exploration/native-identity-evidence-store.ts` | `f270a49e2389043c1bf8f9abedff82989b39121f5460b05a2ef439ce819430b1` |
| `schemas/lakda-native-execution-evidence-v1.schema.json` | `20dd5043e9e62d55c5de3ffcd04f0171a554ecffc416a706ecbf80d08e376073` |
| `tests/native-identity-actions.spec.ts` | `d7ef9334fcb572730b4f8c7f12c8183a72cb3d9b53bfc3d09ced5b2290f96a3c` |
| `tests/native-identity-target.spec.ts` | `330d66ac0580a4ab0d96fdc8a1a8e49301195a101f8134e391958975f2143981` |
| `tests/native-identity-evidence-io.spec.ts` | `4153665f01764117440aea0a9d560d5223c8138d324920c1794f9e864299114e` |
| `tests/python/test_native_identity_actions_http.py` | `e5141d9cb138bb068935556228c6f3c9a5e102aa22bcf1aa53f7d7f1975f882c` |
| `tests/python/test_http.py` | `7ae66d30320b2ccb61c7b2ec5a9b06f6001f4bf942729cd009fba8c987e74afb` |
| `scripts/check-package-contents.mjs` | `68bc3f27805da583dee5265664107165ef5c91d51851823ba157d159bb556372` |
| `scripts/check-package-install.mjs` | `73d9c2172d12a18db839e6bbd9ebcccbf3a30c9c78f3637051c1dc12775e9ce6` |
| `tools/airtest-poco-bridge/.npmignore` | `ac2de72f51a815d5d4c3b2c16f8aa800a4c817c4b4f5e054218e300c661b47fa` |
| `tools/airtest-poco-bridge/README.md` | `b427730db3c43d2f3bec22a4dbe50a1c2e57c0e3a202a9c67fb5f23e0063049c` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | `1bfad471d221cd0fe52615920335e0ffd1d99a17aeb16756ccf2ac6a183a0ca2` |
| `docs/spec/verification-reports/SELF-REVIEW-20260910.md` | `4844f36c2c40465dc7c8245f87eb34f2066a6017ca6481c1899d5acb79fbd319` |
| `.lakda/native-evidence-final-check-20260911.log` | `9ecb89c2b293a3e256ca3bf20cb7777d28b174bc73c8d8694993209d34687183` |
| `.lakda/native-evidence-final-check-20260911.execution.json` | `b0c4a86a02133ce03af6c8125c581aec35ab2676d4b44b2228d936290c7306dc` |
| `.lakda/native-evidence-final-python-fixed-20260911.log` | `241303c762d7d6dbcbcd081f445256d6e5cef83a1d01a239131e82cf3173b933` |
| `.lakda/native-evidence-final-python-fixed-20260911/summary.json` | `223f6616cf49035373e157300bd9092b24347288d184a321c8b71a4e13b18a1d` |
| `.lakda/native-evidence-final-python-fixed-20260911/junit.xml` | `0ad596daf5df506fb20324c843c813ccd1eb95f99258645fe0419708bf76c786` |
| `.lakda/native-evidence-pack-final-20260911.log` | `a3b0d853d1900d9c40a43a664552918c36f2c583810577934b4bb54ac3238fe7` |
| `.lakda/native-evidence-pack-final-20260911.execution.json` | `2aee240554b41435715ebe6491fab081a34eff67e8c18793fd3a20b296ce89f6` |
| `.lakda/native-evidence-final-interop-20260911.json` | `9e60a5ae6229cda95f97c279750470e7e882c7cab86d57d73bb95092946a6fd0` |
| `.lakda/native-evidence-final-interop-20260911.stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `.lakda/native-evidence-diagnostic-20260911.cjs` | `12333193c9f70b3ed650246e526f1bb7d0df0a58bf47e5e3da0ec255ba3f1e35` |
| `.lakda/native-evidence-clock-20260911-3.stderr.log` | `964e861c35aa79cea6bbb11f0629992dd55692a243d8d0ca45ade75d0e4740a5` |
| `.lakda/native-evidence-clock-red-20260911.log` | `8efe2245e13175b2ce8aa4949aa593ce24b60e3b8c4f77810030f014c1cfa29e` |
| `.lakda/native-evidence-clock-green-20260911.log` | `5f88601f946911813e61a62c0e099a73e3a5dda9fb3f3278616b7de76a6da106` |
| `.lakda/native-evidence-checkpoint-red-20260911.log` | `9c9ba5dd7629cad5976a18e7e0ee3447f7f193ba2f4721f91afa927d5f04231e` |
| `.lakda/native-evidence-checkpoint-fixed-20260911.log` | `e00ad82d0578ce1586877ad24a749a06267ea49227b8b257997d3427c3ecd19e` |
| `.lakda/native-evidence-final-python-20260911/summary.json` | `e23245c31133bbea68a2fd5b86aca1ee0dd74895f90f1b57bf7d2888492b039d` |
| `.lakda/native-evidence-package-cache-red-20260911.log` | `a126685a00c9aed147db1255abaa1638e21e7005a0e082ffea56887b26a74d64` |
| `.lakda/native-evidence-interop-20260911-trials.json` | `ebef70e4f63edf1d2b143fe57ba5168568edc6a880f922ea0736c581453a283c` |
| `.lakda/native-evidence-http-fixture-20260911-trials.json` | `f104311aefdd007c7a394ace2e1250d25291c40a92e261a7260947d5d4adf84b` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/session.json` | `968f923b94ab9c8d3adf94206324ad2a5b258530bc5d79f648f3e86a3443c66d` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/events.jsonl` | `af76d859bafe3644e38b55b9e2bde3d4b43c26ed7e038f3d0e87f3f192d31cee` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/target-manifest.json` | `b4b35c91e0cec6def09098f7351129f16a7084a0df9b04fa872653a629724dd9` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/charter.json` | `3c1e951f8cc0d31a9e75ad99ff87f2d9faad2f1630649d0507baa9b48a0971f0` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/native-identity/6a9ddaa2-0797-4177-8f74-5f31336ef47a/000001.json` | `87f37e148a8ac4b72035e554f9674578432eaecdb8234dd6c318d77fb9de387e` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/native-identity/6a9ddaa2-0797-4177-8f74-5f31336ef47a/000002.json` | `3d04af31a8869054b109f18e2f5574ef303b482eb590447ac3092175c497f5e9` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/native-identity/6a9ddaa2-0797-4177-8f74-5f31336ef47a/000003.json` | `52c1108593e2b5459ae2f88a13631bcaab1021139cbcde000c213fddae0d6e54` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/native-identity/6a9ddaa2-0797-4177-8f74-5f31336ef47a/000004.json` | `8ecd826856bf4f69e86b2bd2797d353b8aba75b5d0423cd461af2b888522e497` |
| `.lakda/native-identity-evidence-interop-PQiLd9/sample-playwright-exploration-1789055891787-4163f179/native-identity/6a9ddaa2-0797-4177-8f74-5f31336ef47a/000005.json` | `28ed570aaef1f634b6a29da0977ce97c54a60db687b6cb78f73e513b613d1f6e` |
