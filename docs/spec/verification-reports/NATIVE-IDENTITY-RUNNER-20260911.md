---
document_id: LAKDA-NATIVE-RUNNER-20260911
status: local_verified
last_updated: 2026-09-11
specification: SPEC-02-NATIVE-EVIDENCE.md
---

# native runnerの操作接続・撮影停止のローカル検証

[仕様02](SPEC-02-NATIVE-EVIDENCE.md)、[Checklist 02](CHECKLIST-02-NATIVE-EVIDENCE.md)、[Task 68](../../tasks/TASK.20260910-68.md)。7改修・57要件・22受入条件を維持し、今回の変更は通常の探索ループから署名済みnative実行とsession証跡保存へ接続するbridgeを扱う。

## 変更とセルフレビュー

`createNativeIdentityBridge`はsession証跡sinkを必須とし、execute／recoverを署名済みexecutorへ送る。従来のexecute／recoverは呼ばず、低水準nativeActionをrunnerへ公開しない。bridge methodと入力を固定し、並行呼出し・bindingの変更・失敗後の追加操作を拒否する。

観測・候補取得・撮影開始の前後に、保存観測の期限、署名、bridgeが報告するbindingを検査する。撮影開始の応答後に承認が失効すると撮影が残ることを先行試験で確認し、開始を送った後の失敗では同じrun／保存先へstopを送るよう修正した。停止応答のacceptedとstoppedを確認できない場合は固定理由で失敗する。期限後もstop／discardを送れる。

セルフレビューSR-87〜89には操作経路、開始中の失効、検証範囲を記録した。このbridgeの読取前後のbinding確認はローカルの申告情報の確認であり、SDKの現在の選択や撮影中のtransportを独立に観測した証明ではない。SDK入力時のdevice／transport照合は既存native-action側が担う。

## 検証

基準HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、dirty差分込み。Windows、Node 24.11.0／npm 11.6.1、package 0.5.0-rc.1。宣言runtimeのNode 24.6.0／npm 11.5.1で固定SHAを検証した正式受入ではない。

| 検証 | 結果 | ログ |
|---|---|---|
| bridgeの先行試験→実装後 | 未実装moduleで2 failed、その後2 passed | `.lakda/native-runner-bridge-red-20260911.log`、`.lakda/native-runner-bridge-green-20260911.log` |
| 撮影開始中の失効→修正後 | stop不足を1 failedで検出、その後関連3 passed | `.lakda/native-runner-capture-red-20260911.log`、`.lakda/native-runner-capture-green-20260911.log` |
| bridge関連 | 5 passed。execute／recover・旧操作0件・同時呼出し・binding変更・停止未確認を含む | `.lakda/native-runner-bridge-verified-20260911.log` |
| npm run check | docs・型・Lint・build・全539件 passed、exit 0 | `.lakda/native-runner-bridge-check-20260911.log` |
| adaptive探索との接続 | 1 passed。実際のrunLakdaから候補選択→native execute 1件→観測／予定／終了の3記録を保存、旧操作0件 | `.lakda/native-runner-adaptive-integration-20260911.log` |
| 最終native関連 | 84 passed、exit 0。上記の追加接続試験と既存native試験を含む | `.lakda/native-runner-related-final-20260911.log` |
| 最終型／対象Lint | exit 0 | `.lakda/native-runner-final-types-20260911.log`、`.lakda/native-runner-final-lint-20260911.log` |
| offline npm run pack:check | 570 files／62 schemas、隔離installとnativeRunnerBridgeImportを含む既存CLI／report検査がpass、exit 0 | `.lakda/native-runner-bridge-pack-20260911.log` |

全539件の実行後、fixture helperへ任意config引数を加え、adaptive接続試験を1件追加した。その後にnative関連全84件と型・Lint、最終buildを含むpackを実行した。全540件を実行した記録とは扱わない。全体検証後の実行sourceの変更はない。失敗ログは保持する。

## 範囲と未完了

一時生成したEd25519鍵と人工bridgeを使い、既存探索ループへbridgeを注入して検証した。実SDK・実ADB・実端末・scanner・外部targetには接続していない。Python sourceの変更とPython試験の再実行はなく、以前の138件を今回の件数へ合算しない。

CLI初回／resumeは引き続きv2を接続前に拒否する。保存済みtargetとtrustの解決、再開前の保存証跡照合、新しい観測・sinkとの接続、captureとの統合は残る。Windows／iOS provider、実機3lane、媒体I/Oの残項目、固定SHAの受入・manual-bb・外部QEGも未完了である。この記録はTask 68や7改修全体の完了を示さない。

[前段のHATE／report記録](NATIVE-IDENTITY-REPORT-20260911.md)はSHA-256 `c8d69331da5023a300b81a7659fb24916e7347e522774e0c426995d8fc59a5be`のまま保持した。以前の記録にあるsource hashを現在値へ更新しない。

## 対象ファイルのSHA-256

作成時の実bytes 17件を固定する。以後の変更は新しい記録へ残す。

| 対象 | SHA-256 |
|---|---|
| `src/exploration/native-identity-bridge.ts` | `f7a694bf3a3b6089df7df4e03f83be5acaf4e379862c37f2077496eec619df93` |
| `src/exploration/native-identity-executor.ts` | `400e226ee038b1918b422cb30434ddd247629bb2187497c7cec85f240a978e49` |
| `tests/native-identity-target.spec.ts` | `5de65e8f67a151a9bb81095cd0db942a790e49349ca50459070ada55d68d5363` |
| `scripts/check-package-contents.mjs` | `d91644970ab2683c43784061d9c9dbb8f4676b84a6e85dcb78c4220ce44dd587` |
| `scripts/check-package-install.mjs` | `7035234d1fc6c5188d1c1fdbecfdba88bfc12eab8b59d568661985a85c6c54b4` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | `f881b29dcec59a909a8952c8b462f7c429768cffb018073d765346c89fe92dd3` |
| `.lakda/native-runner-bridge-red-20260911.log` | `4b80f3d7797063f12522d4263bce53259d81b3662d1d3fc5de8f682e0e0003a4` |
| `.lakda/native-runner-bridge-green-20260911.log` | `3d2d6e9d6d1875437c46f6f30571d60574bdd1fea87b03ab1fcea6b0a2b318ac` |
| `.lakda/native-runner-capture-red-20260911.log` | `2272e9eb33f39be960ebf6c3962eabddf1e698ab356f025e73c232f5c359820d` |
| `.lakda/native-runner-capture-green-20260911.log` | `dc2121ffca697d604f05c36d3533a41bf27da5d5f8ab534a3a3425ff9adf9701` |
| `.lakda/native-runner-bridge-verified-20260911.log` | `cf396c661b52a4d2c62e56c123f2a9b57c5736e423db95f7904e73f4f9845203` |
| `.lakda/native-runner-bridge-check-20260911.log` | `e575a76c4bec62a841447ffd9271bf5a7c04cd1971749067d8dc2e0876929c96` |
| `.lakda/native-runner-adaptive-integration-20260911.log` | `d40e279ad05d984cfc167f687235e9798521b6bf6688fc40b00d59de4187c1ca` |
| `.lakda/native-runner-related-final-20260911.log` | `e30322f2a301a93ab716f75558b5ce61f5085b3ca2b6cf5421dc8d5e48f89ece` |
| `.lakda/native-runner-final-types-20260911.log` | `a7146661d36faf27db56ff0b856ed4fcbfaf38f4b68159e20bb87749b594de5a` |
| `.lakda/native-runner-final-lint-20260911.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `.lakda/native-runner-bridge-pack-20260911.log` | `47e3c02dbe1e79834d7a7428517143249aa9bf46af35d97a53b718ff46c214ef` |
