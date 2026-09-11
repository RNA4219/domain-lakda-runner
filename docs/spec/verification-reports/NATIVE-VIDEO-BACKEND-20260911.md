---
document_id: LAKDA-VERIFY-NATIVE-VIDEO-20260911
status: local-verified
last_updated: 2026-09-11
---

# Android録画backend・MP4のローカル検証

[仕様](SPEC-02-NATIVE-EVIDENCE.md)、[checklist](CHECKLIST-02-NATIVE-EVIDENCE.md)、[Task 68](../../tasks/TASK.20260910-68.md)に対応する補助証跡。7改修・57要件（Must 55／Should 2）・22 ACの範囲を維持する。

基準HEADはb027b6ba9797a2a30b5e98008a1cb848c2c81e05、packageは0.5.0-rc.1。既存差分を含むdirty worktreeで検証した。以下のdigestはこの記録時点の対象fileを表し、cleanな固定SHAによるrelease受入ではない。過去の[CLI検証](NATIVE-IDENTITY-CLI-20260911.md)を更新・再承認しない。

## 結果と範囲

- 固定Airtest 1.3.5のAndroid device側録画APIを優先する。開始時に選んだ停止methodを保持し、device／共有API／methodの参照変更後も別backendを停止しない。
- MP4のinventory、request MIME、core／session binary判定、video集計、HATE kindを接続した。未検査を検査済みへ昇格せず、署名後の同一sizeのbytes変更も拒否する。
- deviceの開始Noneを既存録画として採用せず、停止False／None／例外では媒体を返さずactiveを保持する。部分APIの共有backendへの切替を拒否する。
- Pythonの実行試験でMP4と従来WebMの完全な出力path、停止先、状態、artifact参照を確認した。実機や実映像codec・内容検査の受入ではない。

## 実行結果

| 検証 | 結果 | 記録 |
|---|---|---|
| MP4先行試験 | 3 failed。request拒否、coreのunsupported、session HATEのother／scan passを検出 | .lakda/mp4-contract-red-20260911.log |
| 契約試験の最初の修正確認 | 14 pass／1 fail。新testの検証関数の引数順を修正。型検査も同じ不備を検出 | .lakda/mp4-contract-green-20260911.log、.lakda/mp4-typecheck-20260911.log |
| MP4契約の修正確認 | 15 passed。その後追加した署名・改変・未知形式のassertionは最終全体checkで確認 | .lakda/mp4-contract-green-final-20260911.log |
| device録画先行試験 | 5 failed。共有API選択・停止先切替・未確認状態の成功を検出 | .lakda/device-video-red-20260911.log |
| 最初の全体check | 545 pass／1 fail。旧WebM固定のsource文字列assertionが不適合。出力pathの確認をPython動作試験へ移した | .lakda/device-video-check-20260911.log |
| 最終Python wrapper | 143 passed、skip／failure／error 0。JSON／JUnit保存 | .lakda/device-video-python-final-20260911/ |
| 最終npm run check | docs、型、Lint、build、全546件がpass | .lakda/device-video-check-final-20260911.log |
| offline npm run pack:check | 573 files／62 schemas、隔離install、native runtime import、既存report CLI等がpass | .lakda/device-video-pack-20260911.log |

PythonはWindows上の3.12.14。commandはnode scripts/run-python-tests.mjs --python .lakda/dependency-env-py312-verified/Scripts/python.exe --out .lakda/device-video-python-final-20260911。実行時刻はsummary.jsonの2026-09-10T18:19:59.646728+00:00〜18:20:06.509218+00:00。

最終checkのlog作成〜最終更新はUTC 2026-09-10T18:19:59.4039575Z〜2026-09-10T18:23:19.5749069Z。packはUTC 2026-09-10T18:23:29.4234584Z〜2026-09-10T18:23:57.6886206Z。log時刻はshell全体の区間であり、個々のcase時間とは別である。

Node24.11.0／npm11.6.1を使用した。宣言されたNode24.6.0／npm11.5.1とは異なり、pack時のEBADENGINE警告を記録している。既存のoffline npm cacheを使用し、新しいruntime・SDK・外部scannerの導入は行っていない。

## 残る受入

開始時のmethod固定は、SDK object内部のADB接続世代の固定やnative lease・承認期限に沿う背景撮影の停止を保証しない。native target v2のCLIは連続撮影offを引き続き要求する。実SDKによる連続撮影との統合、Windows／iOS provider、実機3lane、固定SHAと指定runtimeによる統合受入、manual-bb・外部QEGは未完了である。AC-UP-008／022やTask 68の完了を示さない。

## 記録時点のSHA-256

pathはrepo root基準。SDK fileは固定版の実装を読み取った証拠であり、実deviceで実行した証拠ではない。後続変更時にこの表を更新しない。

| path | SHA-256 |
|---|---|
| src/core/artifact-policy.ts | 5d9d4cce97be07f0dfc00ed87e8674f5a072ad64f0e62dbf5452b919af02b2b4 |
| src/core/hate.ts | 2f72ce842b2209ebdf34e5bb42f0e747304a62a2afc4c24cba3180a6e9572269 |
| src/exploration/session.ts | 0b2a3f8cc3ff07fae79915c33fd381d31238ca12a4388cf812137c4004a8f590 |
| src/exploration/attestation-contracts.ts | 408d42da85427ebeca220a88d870e6657e49f2ece8a1eac39fbdbffa412c9e78 |
| src/exploration/attestation-inventory.ts | 8930e484c046a0368d09ef08add5d9aef45884d5dc7ecfe90ed1afb01cacb5be |
| schemas/lakda-binary-attestation-request-v1.schema.json | 6a9c9df7a4d0a733f2650a9c99ab10861d4ac3edac75232d80521a3951f6798e |
| tools/airtest-poco-bridge/server.py | 35b504410f6ab722a4a38be6d60c872e9bcfc80fc05bf03ec32dcda1e5768ea3 |
| tools/airtest-poco-bridge/README.md | 667793c176ca6e100b5d240a7c96ebb73faf14788ec2e00e651a9f397b288c24 |
| tests/binary-attestation.spec.ts | 1458c3bf488410881c3202aba179608e71db39eaa59a7dfc963bb2b3216b241f |
| tests/attestation-contracts.spec.ts | 379cbe0bd9b57c05b247379c1e1140db341b1adfb6096fc0e2197248827b04a1 |
| tests/airtest-poco-bridge-contract.spec.ts | 4f64a6e373b2b8bb6f14ea2b4b4dcac31d73cfbc4592ea3b03010eafa1c4887d |
| tests/python/test_capture_device_video.py | 1c6da8de7596e3f0e1a3b05774692e0c035890df53508626d5062cb23fbb3a47 |
| docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md | 2cb103b6ba3afe75ef98dc5c77a71fe44590c3b87ca0754625451385fcd6bb8c |
| docs/spec/verification-reports/SELF-REVIEW-20260910.md | 41421ffc684e56d6b0d2203ca44ea506f6d85976fe7c2d1a6ff436bfc33f5dc1 |
| .lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/android/android.py | 443ed9f4a6f92fd18c5af0f114f08ec0eaa11160dadb97dde5217219ce413f3d |
| .lakda/dependency-env-py312-verified/Lib/site-packages/airtest/core/android/recorder.py | 304c6ffe78624058ecc023efc06ac846df65d79359f5593632a23bb06b108cab |
| .lakda/mp4-contract-red-20260911.log | c3b354bd6cb6e1942c97ec15a51fa9ae281acb5eb4094c07b49fc82143b9bfe4 |
| .lakda/mp4-contract-green-20260911.log | 42c2e4856b12da5ec9b50430cacf6b2c47093fb2800ded86a8eeb9b6289ef8cd |
| .lakda/mp4-typecheck-20260911.log | 8fa8af0639ff5ef814d010682de324d0dde0d61b634c4b223f5cf359fb70b34a |
| .lakda/mp4-contract-green-final-20260911.log | bf114d91a2968ccd657d1c428b56e5bdba24840380a6f1e484df6b4a422d7b5c |
| .lakda/device-video-red-20260911.log | 007992fff2d08eeff51efa019edde301faccf78cec0020b92f24d0a8f52714c4 |
| .lakda/device-video-python-final-20260911.log | ab9cecc3fb7f57200bc63b22572d9f70f97c42dcedd049c7da587e1313b73429 |
| .lakda/device-video-python-final-20260911/summary.json | 588eb324c947b63acd3324d9383d09774b2b63bc1007d6bf8331f644f88dfba4 |
| .lakda/device-video-python-final-20260911/junit.xml | 80b7b49d800e8b5a7c843eb8f4fac9d475a24d4b45d0d7f6d7d07a8ad1c7781f |
| .lakda/device-video-check-20260911.log | ab4b87181777bc7c26c766ae7f1fa90e1222965e3022562fa8a98581d85c026f |
| .lakda/device-video-check-final-20260911.log | e97575375d23af4d2a26ce401d4b0d737a65350a7cf2504de793850c45db289b |
| .lakda/device-video-pack-20260911.log | df5c90c431d56c62d2c99f22f3993165bae4744d6f651b5060e93a2211ddec9d |
