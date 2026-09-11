---
document_id: LAKDA-ATTESTATION-ORIGINALS-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 原本の非公開保全・停止制御のローカル検証

対象は[Task 67](../../tasks/TASK.20260910-67.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)、AC-UP-003〜005。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存のdirty差分を含む。固定SHAでの正式受入ではない。Windows、Node v24.11.0、npm 11.6.1で実行した。宣言runtimeのNode 24.6.0／npm 11.5.1とは異なり、pack時のEBADENGINE警告も保存した。

## 変更と確認できた範囲

検査入力用の `sources/<sourcePath>` は独立したコピーとして作成する。その後、元file自体をrun外の `originals/<requestId>/<sourcePath>` へ移し、移管後のsizeとSHA-256を要求へ照合する。元fileのunlinkを行わず、元のfile identityと検査用コピーの両方を残す。移管先は新しく作成できたrequest directoryだけとし、既存保管先を再利用しない。

最終statの結果取得直後に実fileを書き換えるfixtureでは、変更前の処理は拒否を期待したところ成功値を返した。変更後は、移管した原本の照合で更新を拒否し、その更新後bytesをprivate原本として保持する。in-place更新だけでなく、元pathのfileを別fileへ置き換える場合も検証した。これは通常の書込みを最終stat後へ同期させた局所回帰であり、実scannerや第三者環境での試験ではない。

移管失敗時は `media-preservation-unavailable` として停止し、元fileと検査用コピーを残す。EXDEV・EACCES・EPERMは、対象fixtureのrenameだけにOSエラーを注入して確認した。実際の別volumeで正常に移管できたことを示す結果ではない。移管直前の停止、移管直後の停止・期限切れでも、run側またはprivate側に原本が残る。

先行の停止制御も同じ全体検証へ含めた。inventoryから媒体採用までの共通期限、64 KiB単位のread／writeと再照合への停止伝播、診断保存の独立した期限を確認した。正常なローカルI/O下の停止反映を測り、OSやstorage停止時までの応答時間保証とは扱わない。

## 実結果

| 検証 | 結果 | 記録 |
|---|---|---|
| 変更前の新規回帰 | 6件が失敗、exit 1。原本保管先が存在しない、更新後に成功値を返す、移管時の停止・エラーを受けない等を検出 | `.lakda/attestation-originals-red.log` |
| 途中段階の関連試験 | 44件pass、exit 0。この時点は原本の新規6件。後で停止前の1件と期限切れの分岐を追加した | `.lakda/attestation-originals-related.log` |
| 最終の `npm run check` | docs、型、lint、build、全456件pass、exit 0 | `.lakda/attestation-originals-check.log` |
| 最終の `npm run pack:check` | 521 files／55 schemas、隔離install・CLI・report生成の検証pass、exit 0 | `.lakda/attestation-originals-pack.log` |

全体checkの実行時刻はUTC `2026-09-10T10:06:42.7623708Z`〜`2026-09-10T10:09:30.6992120Z`。packはUTC `2026-09-10T10:10:06.3535313Z`〜`2026-09-10T10:10:30.1235523Z`。sourceとtestを変更せず両方を完了した。

最終456件の実際の成功行から、次の関連56件を照合した。

| test file | 成功件数 | 主な確認 |
|---|---:|---|
| `tests/attestation-originals.spec.ts` | 7 | file identityの保持、最終stat後の2種類の更新、既存保管先、移管失敗、移管前後の停止・期限 |
| `tests/attestation-media.spec.ts` | 20 | 隔離・採用、署名済みoutput、privateコピー、停止、診断公開とraw参照拒否 |
| `tests/attestation-io-stop.spec.ts` | 6 | chunk境界、inventory期限、診断の有界終了、公開writeの停止 |
| `tests/attestation-exchange.spec.ts` | 12 | 共通期限、request／response／receipt、受領の一意性 |
| `tests/attestation-run.spec.ts` | 11 | 通常runとHATEへの接続、capture停止、operator制御、失敗時の記録 |

原本7件では、fixtureに限定して組込みfs関数を一時差し替え、終了時に必ず元へ戻す。最終stat後の更新試験は、取得済みのstat値を返す直前に実fileを更新する。更新時刻の自然な衝突確率へ依存していない。既存の最終digest後の更新試験は、run内で拒否された場合と移管後に拒否された場合のどちらでも更新後bytesが残ることを確認する。

## IO-01と未完了事項

先行の独立probe `.lakda/attestation-stat-precision-probe.json` は、128 KiBを更新した60回中17回でms／nsの時刻情報が変わらない結果を記録している。これは当該Windows環境での観測であり、全filesystemへ一般化しない。このprobeは今回再実行せず、保存済みbytesとdigestを照合した。

今回の変更は「古いコピーを根拠に、最終確認後の更新を含む元fileをunlinkする」経路を置き換える。一般snapshot readerの排他性や、移管後に書込みを続けるwriterの停止を証明しない。capture停止、operatorによるoutputのatomic確定、private保管領域を他の処理が変更しない運用が前提である。**IO-01全体と媒体不変性の受入は未完了**とする。

- 別volumeでhandoffを成功させる経路は未受入。エラー時の原本保全だけで対応済みとしない。
- 原本と検査用コピーを保持するため、private保管容量が増える。自動削除や共有bundleへの取込みは追加しない。
- 隔離開始前・隔離途中で停止したrunの完全な隔離と、期限後応答の派生bundleは継続する。未確定runを成功したHATEへ昇格しない。
- Task 68の実機identity、Task 69の固定SHA受入、実機・実scanner・manual-bb・外部QEGは未完了。全7件の改修完了やリリース承認を示す記録ではない。

## 再検証

現在の関連56件を選択するcommand（上表の実績は最終全体checkから集計）:

```powershell
npm test -- tests/attestation-originals.spec.ts tests/attestation-media.spec.ts tests/attestation-io-stop.spec.ts tests/attestation-exchange.spec.ts tests/attestation-run.spec.ts
npm run check
```

packでは既存のローカルcacheを使い、networkから依存を取得しなかった。

```powershell
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
```

## 検証対象・記録のdigest

以下の21件を最終検証後に採取した。先行の6件失敗・途中44件成功のlogは履歴であり、現在のtestが6件だけであることを意味しない。本文書自身、後からリンクを追加するTask・索引・checklistはこの表へ含めない。

| file | bytes | SHA-256 |
|---|---:|---|
| `src/runs/artifact-snapshot.ts` | 3210 | `d8cfe06b54545b05988fdfc564ab4b593b7970d18dbac54fc2749a9999d1dc95` |
| `src/exploration/attestation-inventory.ts` | 2444 | `70e55de319cb30df7bb15378d62bbd11e8b61f4782e719dd72fada556a8191be` |
| `src/exploration/attestation-io.ts` | 9672 | `f2df4fcb5447e480186aba7036d274ea1ee0f6fd782f15068141e3896e00d4c8` |
| `src/exploration/attestation-copy.ts` | 4915 | `509c2773c6411af5d9e6f454495400ec98359836e5eca9fbe3cbf97b25716517` |
| `src/exploration/attestation-media.ts` | 6214 | `9a5db2ba1bb41065f5828d46f5c5f9e4b6a9fd5c6a4ffffd7f3d5b97ef4af85e` |
| `src/exploration/attestation-run.ts` | 4177 | `6af438866dcc40b6225a09103ac2c6ff1436e73e50b69ac1e661b68ea6838210` |
| `src/exploration/attestation-exchange.ts` | 12834 | `bef9090216c0e37d7398188bc450b5b2c1e810cf678f4db200ab00b38ed8f55c` |
| `src/exploration/attestation-publication.ts` | 7086 | `072a0444dd1c00cb4f3e62fbe7295b907a132bc1a89ba17419c48282354b217b` |
| `tests/attestation-originals.spec.ts` | 7307 | `4c34702fa718735aac556796c4d07ef9d7323fe5437c46841765e5b3471f34d8` |
| `tests/attestation-media.spec.ts` | 24982 | `8c0ad3146b1f33298da15a3a631ad0ac155ac32a481cb19a6374e1ce2a7c4aa1` |
| `tests/attestation-io-stop.spec.ts` | 8137 | `d66c68ad0bc42c4ddbc4ea21cfabd4fe551b94e0ab4c950076e3c740b9f40fa4` |
| `tests/attestation-exchange.spec.ts` | 9837 | `c6bbfee56b3cd34d50ea1801dcbeacfd0de0e493caf57c662532416a9ff2bb5c` |
| `tests/attestation-run.spec.ts` | 24108 | `53607a306e60f210b36dc3cf8ebac9623c6b13d088c5fc72f86c87a6928e031b` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 26994 | `9b58ee00e0fdcb04eb157a4001f9b3e309e83f14e470818abd2be80000678ffb` |
| `RUNBOOK.md` | 30730 | `0c9dc937df1df6b587aa422a246f982bf0eb72cb33065091f69843558877e6f9` |
| `.lakda/attestation-originals-red.log` | 10056 | `a9f597b89fd49e2435c63a5d5c8fda44151bbae6fc14d8c8a420d45fc7a81dc6` |
| `.lakda/attestation-originals-related.log` | 6516 | `60e940a4a31a93890b3d7f790ad78adb64735f6db7342e6737898dbb985c2caf` |
| `.lakda/attestation-originals-check.log` | 76369 | `e2c9f93dd7ae57318d2f975a08e8f00101099ac487cd9fd27e050d648ca5c0f2` |
| `.lakda/attestation-originals-pack.log` | 4611 | `373d50f2de9a7f1e9395d6eea343e2b4e433c50d10b70c6dd651a93e3eccc3ab` |
| `.lakda/attestation-stat-precision-probe.mjs` | 1848 | `3fa4c08b62abf9128105618131fab24d0a8fe3f64e6686095009f1abce472bd8` |
| `.lakda/attestation-stat-precision-probe.json` | 372 | `0571393c1f6a4a6ce9b63f58272f5232fac6950a402107ff273c98d19f46c606` |
