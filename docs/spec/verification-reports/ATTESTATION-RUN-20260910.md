---
document_id: LAKDA-ATTESTATION-RUN-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 通常runからの媒体受渡しのローカル検証

[Task 67](../../tasks/TASK.20260910-67.md)と[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)の通常run接続を、HEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`とdirty差分で検証した。[保存済みv2の先行記録](ATTESTATION-EVIDENCE-REPORT-20260910.md)に続き、run開始前の準備、capture停止後の要求・受領・採用、metadataとHATEへのbindingを接続した。Task全体はin_progressである。

## 接続した動作

- real Charterのcapture.binaryAttestation設定をCLIからrun runtimeへ渡す。CLIのtarget preflightではroot／trust／許可keyを検証し、run本体は実run IDに束縛したprivate directoryを準備してから実行する。
- private rootは既存の正規directoryに限定する。configured run／sessionの公開保存root内と、ancestorにHATE／run-start recordがある保存先を拒否する。先行testで不正設定のままtarget requestが発生することを確認し、接続0件・private directory作成0件へ修正した。
- collectorはcaptureの開始と停止確認を記録する。停止を確認できない場合、新handoffのretention・隔離・HATE公開を進めず、元媒体を未確定runに保持する。
- 保持するPNG／JPEG／WebM／trace ZIPの一覧とbytesを確認し、共通createdAt／expiresAtで要求する。全stage後に各要求の受領・採用を待つため、先頭が無応答でも後続を採用できる。全Promiseの終了を待ってから記録を公開する。
- 前処理時のtrust file snapshotを受渡し前と記録公開前に再照合する。途中変更があった場合、採用済みproof recordやHATEを公開しない。
- 探索loopが消費済みのpause／killをcollectorへ引き継ぐ。待機中の制御fileも読み、pause／killを受領recordとmetadataへ反映する。bookmarkによるtarget操作は追加しない。
- 受領工程が終了したrunではmetadata.binaryAttestationへ要求数、採用数、source、受領status、採用状態、固定reasonを記録する。実run bindingをArtifact PolicyとHATEの再検証へ渡す。

operatorの設定とatomic受渡し手順を[RUNBOOK](../../../RUNBOOK.md)へ追記した。旧設定のv1読取と既存modeのstdout／exit契約を維持する。

## 試験結果

| 検証 | 最終結果 | 確認範囲 |
|---|---|---|
| 新しいrun接続test | 9 tests pass、exit 0 | 実browserからのPNG／trace受渡し、無応答の先頭と正常な後続、native stop状態、待機中kill、既消費pause、trust変更、browser close未確認、trust欠落、不正なprivate root |
| npm run check | 417 tests pass、exit 0 | 文書、型、ESLint、build、全体回帰。先行416件の後にprivate rootの拒否testと修正を加えて再実行 |
| npm run pack:check | 508 files、54 schemas、exit 0 | repo内の既存offline cacheで配布内容と隔離install、既存CLI／bridge／report経路を検証 |

Windows、Node 24.11.0／npm 11.6.1で実施した。宣言runtimeのNode 24.6.0／npm 11.5.1とは異なる。実target、実scanner、実画像negative corpus、実機operator、manual受入の代替ではない。

正常系はrunLakdaをローカルfixtureへ実行し、HTTP失敗で保存されたPNGとtraceを、一時Ed25519 keyの人工attestorへ受け渡す。PNGは人工1 pixel出力、traceはno-sensitive-contentの人工判定である。失敗したテスト対象のoutcomeをfailedに保ち、2要求・2採用、元PNG非登録、trace保持、受領record 2件、HATE確定を確認した。

無応答testは共通期限1000 msで先頭PNGだけ応答せず、後続traceが採用されたことを確認した。kill testは2要求の公開後にcommandをatomic配置し、各cancelled receiptのfinishedAtとcommand公開時刻との差が1000 ms未満であることをassertした。これは小さいfixtureでの待機停止検証であり、大型媒体のI/O中を含む全状態の上限を証明しない。

native stop状態は人工backendで確認した。browser close未確認は実browserを閉じた後に応答例外を発生させるfixtureで、停止確認が失敗した場合の保守的な分岐を検査した。実processが停止不能になった環境を再現した試験ではない。CLIの新設定配線を追加したが、署名済みreal Charterから実scanner、実機、最終HTMLまでの受入完了は主張しない。

## 残る工程

timeout／rejected等で必須媒体が隔離されると、既存HATEのprofileMissingPaths検査によりHATE未確定で終わる。受領recordとmetadataは保存できるが、未保持理由・採用失敗を含む確定HATEと詳細な失敗reportは未完了である。すでにpause済みで受渡し開始を中止した場合も、元bytesを未確定runに保持する。これをprivateへの隔離完了とは扱わない。

次は失敗時の確定記録、source→sanitized outputの項目別関連付け、producer側の元媒体別名残存拒否、大型媒体I/O中の停止・期限、期限後応答の派生bundleを進める。実機identityはTask 68、固定SHAと実機・manual・外部GateはTask 69に残る。AC-UP-003〜005やTask 67全体の完了にはしていない。

## 再実行

```powershell
npx playwright test tests/attestation-run.spec.ts --workers=1
npm run check
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
```

offline cacheはこの環境で取得済みの配布物を使用した。runtimeコードの検証後に文書のリンクと表記を更新し、文書checkerで再確認する。

## sourceと証跡のSHA-256

この表は今回のlocal snapshotである。先行記録にあるsource digestは当時の履歴として保持し、今回の変更へ流用しない。

| path | bytes | SHA-256 |
|---|---:|---|
| `src/exploration/attestation-preflight.ts` | 4488 | `e3fd8d31c5f412a19da84d4091df1f13bb26adec6371fceef85ea3b6e2aebae1` |
| `src/exploration/attestation-inventory.ts` | 2437 | `e0caa66dfd687bdfeeaa75518f030630221fa76113b70b69e7513c5a9f47ed9e` |
| `src/exploration/attestation-control.ts` | 2732 | `ca159a9ab8e2dcb0f88482398838b57da8c76df4d10bcf9c41d9625a0c36c9ea` |
| `src/exploration/attestation-run.ts` | 3297 | `45474f19895ee4b0877507243e1a5aa4443090d146b01a18412687ccd6e53449` |
| `src/exploration/attestation-evidence.ts` | 5068 | `cf5c2d9c9eb1c715939acb03240584351f776bfa8e86d994205d73a3f6c4c152` |
| `src/exploration/attestation-exchange.ts` | 11276 | `5cf32800cc0a2606f65d76a495152c4463f1e1e011a81d54cf9f7c76f98e8e3e` |
| `src/core/artifacts.ts` | 10036 | `2e072b6fcd0cb60a22ae3c79dfa39d5f6dbb729890b5800662408d0db011fec3` |
| `src/core/runner.ts` | 30578 | `7cec2c9121e92210b01a6a1e44a373b80093cbb8db4c516ccfbb36ac7ed2df1a` |
| `src/adaptive/coordinator/runtime.ts` | 11094 | `9b847a24c8efaef4e295fb6426d1a898df072545b470059e89a4a5658d9b612d` |
| `src/adaptive/coordinator/orchestrator.ts` | 21213 | `f0a19eb2257ec2c9f9dc2d92a35dfdbd56af4b915c0a0373fb5425c69df4ef74` |
| `src/commands/exploration.ts` | 32740 | `501cc9efacc8ad495b99a1ed5cd2aa92ba61b69fa0e45aeebdd7ba605731eb3c` |
| `tests/attestation-run.spec.ts` | 19858 | `88904a7a92da7e0af53c3ffd31c393064cbd2243a78d1f1aed52939bde1494d8` |
| `.lakda/attestation-run-integration-final.log` | 1411 | `a9de86499cc104db8275175be749f07346e1b2bf87918fee1fc35b8e353f74ae` |
| `.lakda/attestation-run-public-root-red.log` | 2184 | `3e44045d6c7fafc28ea683040731256971d64b9b3d8c1d96b258442f083035d6` |
| `.lakda/attestation-run-check-final.log` | 70600 | `05fb01f175628136823faf7017c34eba6dd30c0cd86062a64c6533d0a3c47d19` |
| `.lakda/attestation-run-pack-final.log` | 4420 | `27384c8ac754dd08f65ffef0f09bf5f228f364b14164e172b65a7d32b80fb19b` |
