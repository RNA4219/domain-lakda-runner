---
document_id: LAKDA-ATTESTATION-RESULT-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 媒体の未採用理由・診断HATE・レポートのローカル検証

[Task 67](../../tasks/TASK.20260910-67.md)と[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)の失敗時記録を、HEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`とdirty差分で検証した。[通常run接続の先行記録](ATTESTATION-RUN-20260910.md)に残っていた、媒体が採用されない場合のHATE確定と理由表示を接続した。Task全体はin_progressである。

## 実装・確認した範囲

- `lakda/binary-attestation-result/v1`を追加し、request全体、requestとreceiptのdigest、adoption、固定reason、採用先をcanonicalな64 KiB以下のrecordへ保存する。
- 公開直前に未採用媒体のprivate bytesを再照合する。元path、予定output、元bytesの別名残存を検出した場合、証跡を公開しない。
- 必須媒体の期待値とprofileMissingPathsを保持し、検証済みresultで説明できる欠落をdocumentedMissingPathsへ別に列挙する。outcome=errorで全欠落を説明できる場合だけHATEを確定する。通常のcapture欠落やHAR／DOM欠落は免除しない。
- 新runのmetadataにある全要求・採用一覧とresult／receiptを照合する。採用済み媒体のrecordも必須とし、削除・重複・状態や理由の変更を拒否する。旧v2の読取を維持する。
- reportは同じHATEのsnapshotを検証して、媒体を保持できなかった理由を表示する。record／receiptの区分とscan状態を確認し、restrictedのsourceやreasonを公開しない。
- timeout、rejected、response-verified後の採用失敗を区別する。エラー実行の診断記録が揃っている場合、元outcomeをerrorに保ち、report生成自体はreadyになれる。

resultはrunnerによる採用・診断記録であり、attestor署名済みの画像検査結果や受領時刻の証明ではない。未採用の媒体bytesやprivate保存先をreportへ含めない。

## 試験結果

| 検証 | 結果 | 範囲 |
|---|---|---|
| 関連4 test file | 46 tests pass、exit 0 | result 9件、media 17件、run 11件、保存済みv2 9件 |
| npm run check | 430 tests pass、exit 0 | 文書・型・ESLint・build・全体回帰 |
| npm run pack:check | 518 files、55 schemas、exit 0 | repo内offline cacheを利用。配布内容・隔離install・既存CLI／report経路 |
| npm run check:hate | exit 0 | vendored schemaの固定digest一致。pinnedChecked=true、upstreamChecked=false |
| ローカル表示サンプル | error run／ready report、外部request 0、page error 0 | Playwright Chromium 149.0.7827.55、1366×1000、file表示・スクリーンショット確認 |

Windows、Node 24.11.0／npm 11.6.1で実施した。宣言runtimeのNode 24.6.0／npm 11.5.1とは異なり、その組合せのrelease受入は主張しない。HATE upstream checkoutとの実照合も今回のcheck:hateには含まれない。

先行試験では、timeout／kill後のHATEが欠けること、変更されたprivate sourceや別名rawがあっても公開できること、reportに理由がないこと、正常媒体のresultを削除しても再exportできることを確認した。対応後の46件と全体430件で再確認した。途中の統合試験で内部digestとHATE形式のprefix差を検出し、境界で明示変換した。

## 表示サンプル

サンプルはrepo内の `.lakda/attestation-result-demo-CP7OK1/report/index.html`。画像は `.lakda/attestation-result-demo-CP7OK1/report-preview.png`、計測情報は同directoryのdemo-result.jsonに保存した。report directory一式だけで表示できる。上位directoryには人工runとprivate captureもあり、report bundleの範囲には含めない。

生成は `node --input-type=module -` に渡した一回限りのfixture programで行った。operator keyは一時生成した公開鍵、target／policy digestは人工値で、loopback HTTP 500の画面を実browserからcaptureする。scannerは起動せず、共通1000 msの期限まで応答を供給しない。PNGとtraceの未採用記録を持つerror HATEから、local／text-onlyのHTMLを生成・verifyした。保存した生成物は上表と下記digestで識別する。機能の再実行検証は次節のtest fileを使う。

画面確認では、error 1 run、ready、failure 3件が別表示され、末尾の「根拠・未確認事項」にPNGとtraceのrequest-expiredが見えることを確認した。これは人工環境の診断表示であり、real Charterから実scanner・実機までの受入を示さない。

HATE manifest SHA-256: `6630426c891332894018238a7d1abb48be3237bcf68213923fd27e1f6c67ff77`。report manifest SHA-256: `bb47027bc79d61c3ceaeef90eef317f4af030a446855d215f345281763fc1257`。

## 再実行と残る工程

```powershell
npx playwright test tests/attestation-results.spec.ts tests/attestation-media.spec.ts tests/attestation-run.spec.ts tests/binary-attestation-v2.spec.ts --workers=1
npm run check
npm run check:hate
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
```

capture停止未確認、既消費pauseによる受渡し前中止、隔離途中の失敗では、元bytesを保持した未確定runとして終わる。これらをprivate隔離完了や診断HATE確定へ昇格していない。大型媒体I/O中の停止・期限、source→sanitized outputの項目別関連付け、期限後の派生bundleは継続する。別名残存拒否の今回の範囲は新受渡しの公開前とresultを持つ保存済みrunである。

Task 68の実機identity、Task 69の固定SHA・実機・manual・外部Gateも未完了である。人工署名とfixture成功を実画像検査・実機受入へ代替しない。今回のlocal成功だけでAC-UP-003〜005や全7件の改修完了とはしない。

## sourceと証跡のSHA-256

先行記録のdigestは履歴として保持する。この表は今回のsource・実行log・表示サンプルの30件を識別する。

| path | bytes | SHA-256 |
|---|---:|---|
| `schemas/lakda-binary-attestation-result-v1.schema.json` | 1659 | `cfa1187f39a7fa9f390d642886e04fc27574b0ff5fc8648f119d38933ac80b94` |
| `src/exploration/attestation-results.ts` | 6314 | `97336e9dd76ee93e975ee5d82e437442fa8ac22c530c9db8014acac69ecc4b38` |
| `src/exploration/attestation-policy.ts` | 2548 | `711506930b93f8073a227ea921f189dffdaad5d94050b67dd438fefda75136cd` |
| `src/exploration/attestation-publication.ts` | 6637 | `1ed79e951b3f3095105fa18980354c94fef07daaf64879f799c5ecee83a325b2` |
| `src/exploration/attestation-io.ts` | 7433 | `f6b8a4441611a8c0e98f2f539e36c12e83644b7c0aff8bcabb5d86a3eee388e1` |
| `src/core/artifact-policy.ts` | 8253 | `5d79935678e1f6c88e85afa001bab065ecd9dd2e6e7150a18c1a34af6b5a50f3` |
| `src/core/hate.ts` | 7197 | `20404daddbdc213497f429284c2b2c6ce476ce636d9f11bd3d26ee34b71239d1` |
| `src/core/runner.ts` | 30625 | `25730b5ef1848dfc7916159635ba61bcfe2fd7fa2ae971afd7cd0cfbd20a659c` |
| `src/reporting/attestation-results.ts` | 3135 | `a51c1d655676aecebadfc4d16c69cc86ff03b57029ea75ca6712426bd34f0695` |
| `src/reporting/run-source.ts` | 8673 | `0230efe1b8a14a71fa06ee2cdf08845e285cef85420d8689a4553050c254e4cf` |
| `tests/attestation-results.spec.ts` | 13515 | `6619275494b27ff4d5de1bf647df5aea1ff1c9d373b9c7c7bab87fc6474626c1` |
| `tests/attestation-media.spec.ts` | 19632 | `51fd852e7192a1f2624fccabf59029ea426be8f6dd1c73224e5bbd042e32cc29` |
| `tests/attestation-run.spec.ts` | 24108 | `53607a306e60f210b36dc3cf8ebac9623c6b13d088c5fc72f86c87a6928e031b` |
| `.lakda/attestation-result-integration-final.log` | 6619 | `dbbc1cfa506626556b67e22497ad83101c69506b31904d8bfe478eca9802b1f0` |
| `.lakda/attestation-result-check-final.log` | 72427 | `d53affed49e565719e3a8a60a91aeb75b8a6abc3658ebb715f6ce5760e304b77` |
| `.lakda/attestation-result-pack-final.log` | 4477 | `cfc35ceb7153f1edea2b50b9f9e1d1bcee35c7243a0c6c6982f6351c263c952a` |
| `.lakda/attestation-result-hate-contract.log` | 284 | `f278aababa99429b403401538359d2fb26154d29aafbf19f51fa42f535a7cff1` |
| `.lakda/attestation-result-run-red.log` | 4342 | `5d9daf282ef5618a77062fc6bb20612fbda379baff75c8bd89102479e3c1de6d` |
| `.lakda/attestation-result-publication-red.log` | 3433 | `2f3bf14d385f5773c5f54ebcf5f03928c7d6c54a04d755df53618a14f5246219` |
| `.lakda/attestation-result-report-red.log` | 2986 | `e3a2b7fdef742a2d02835f848d0d89ca7ee0a501ec18184db18a06c41d34e32d` |
| `.lakda/attestation-result-completeness-red.log` | 9646 | `df85050b3e8222c9e708fa37ec39f00730a79c3a9d8df2333c0791eb879de596` |
| `.lakda/attestation-result-demo.log` | 712 | `8b5a498821d0e68c82ae542650be764058ae1294bd8f4afde7cea25367e6e681` |
| `.lakda/attestation-result-demo-CP7OK1/demo-result.json` | 756 | `d0a110cf94fdbbbdc8a8e3705ea3b0e227a657e6e968bf18b6e26682ac310728` |
| `.lakda/attestation-result-demo-CP7OK1/report/index.html` | 5169 | `ab7df0232344481521c2289f9ba8e9ee16cca1235ffa7a3a34ab68c8ea71234f` |
| `.lakda/attestation-result-demo-CP7OK1/report/report-data.json` | 4230 | `fa2d7a19a1027fed185cbfa95c4bfbd5ca640f45f1ba98ae82db077f9a9dbf90` |
| `.lakda/attestation-result-demo-CP7OK1/report/report-manifest.json` | 1322 | `bb47027bc79d61c3ceaeef90eef317f4af030a446855d215f345281763fc1257` |
| `.lakda/attestation-result-demo-CP7OK1/report/report.js` | 29148 | `74113ed2012a3b988500b54b2e06e7a1af19c473937b66eb857b7c2e13c9e81f` |
| `.lakda/attestation-result-demo-CP7OK1/report/report.css` | 5504 | `ac695fca89774523fd5b55bdbe9e80b0c10acf375ce9b475af202e1c037faab5` |
| `.lakda/attestation-result-demo-CP7OK1/report-preview.png` | 146123 | `deacc098cc61a45ece166f00c6511766ac6f4f54bbacad3fb548a429baf4f3b8` |
| `.lakda/attestation-result-demo-CP7OK1/runs/lakda-run-2026-09-10T08-19-16-296Z-434a47/exports/artifact-manifest.json` | 10182 | `6630426c891332894018238a7d1abb48be3237bcf68213923fd27e1f6c67ff77` |
