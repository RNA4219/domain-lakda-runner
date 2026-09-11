---
document_id: LAKDA-ATTESTATION-EVIDENCE-REPORT-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 媒体受領記録の公開・保存済みv2・レポートのローカル検証

[Task 67](../../tasks/TASK.20260910-67.md)と[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)を、HEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`とdirty差分で検証した。[媒体隔離・採用の先行記録](ATTESTATION-MEDIA-20260910.md)に続き、公開可能な記録の保存、Artifact Policy／HATEの再照合、保存済みv2からのHTML生成へ接続した。通常runのcoordinatorから受渡しを開始・完了させる工程は未接続である。

## 確認した動作

- exchangeの全stage／retain完了後、保存済みrequest・response・receiptと採用媒体を再照合する。採用済み応答だけをbinary-artifacts.jsonlへ保存し、timeout等の受領recordも保存する。保存先の上書き、媒体差替え、署名recordのredactionによる改変を拒否する。
- 保存済みv2は当時の受領時刻、要求・応答file digest、run／session／target／policy、明示許可key、媒体path／size／SHA-256を照合する。v2のbindingを要求した検証に旧署名を流用しない。
- Artifact Policyは検証済みsanitized source→outputの対応を必須screenshot等の判定へ使う。HATE再exportでもmetadataに保存した実run bindingを再検証し、不一致時に既存manifestを上書きしない。このHATE testは最小metadata等を使うcomponent fixtureであり、通常run全体の成功を示さない。
- Charterに任意のcapture.binaryAttestationを追加し、real lane、stagingRoot、policyDigest、1000〜300000 msのtimeoutを検証する。設定自体は既存target署名のcharterDigestへ束縛される。schemaで設定を読めることだけで受渡しを開始しない。
- reportは署名済みtarget、Charterのpolicy、参照元session、媒体を保持するHATEのrun IDからv2 bindingを組み立てる。同じHATEに登録された有界なcanonical受領snapshotを読み、未登録・bytes欠落・restricted・scan不合格・別run・応答digest変更・非canonical・容量超過を拒否する。受領recordのclassificationも継承する。
- HTMLの検証記録へrequest／receiptのdigestを表示し、v2 proofの必須fieldをschemaで検証する。share生成、bundle再検証、オフライン表示、HTTP(S) request 0件を人工archiveで確認した。
- v1の既存表示、設定からのtrust選択、署名後の媒体・trust差替え拒否を維持する。target許可不一致によって旧署名のraw別名残存検査を飛ばす回帰を追加testで再現し、拒否順序を戻した。

## 実行結果

| 検証 | 最終結果 | 範囲 |
|---|---|---|
| 受領記録公開と保存済みv2 | 35 tests pass、exit 0 | 媒体15件、exchange 11件、保存済みv2 9件。公開file、timeout診断、採用後の同size変更を含む |
| report接続と回帰 | 21 tests pass、exit 0 | media target 7件、旧signed media 3件、report契約2件、保存済みv2 9件。先行35件と重複するため件数を単純合算しない |
| npm run check | 408 tests pass、exit 0 | 文書、型、ESLint、build、全体回帰。407件の先行実行後、raw残存の回帰testと修正を加えて全体を再実行した |
| npm run pack:check | 496 files、54 schemas、exit 0 | repo内offline cacheで配布内容・隔離install・既存CLI／bridge／report経路を検証 |

初回pack確認は既定npm cacheへの書込みがOSのEPERMで失敗した。`npm_config_cache`を既存のrepo内`.lakda/npm-cache-offline`へ、`npm_config_offline=true`へ指定した再実行が通った。失敗logと成功logを両方保持した。

Windows、Node 24.11.0／npm 11.6.1で実行した。宣言runtimeのNode 24.6.0／npm 11.5.1とは異なる。試験は一時Ed25519 key、人工archive、PNG fixture、保存時刻の人工値を使う。実画像の内容検査、実scanner、実operatorの署名履歴、実機受入の証明ではない。package内のreport試験は既存経路の回帰であり、新しい通常runの受渡し全体の受入ではない。

## 再実行

```powershell
npx playwright test tests/attestation-media.spec.ts tests/attestation-exchange.spec.ts tests/binary-attestation-v2.spec.ts --workers=1
npx playwright test tests/report-media-target.spec.ts tests/report-signed-media.spec.ts tests/report-contracts.spec.ts tests/binary-attestation-v2.spec.ts --workers=1
npm run check
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
```

offline cacheはこの作業環境に存在する依存配布物を使った。新しい環境で未取得依存を暗黙に取得できる手順ではない。

## 残る工程

通常run接続前のprivate root／trust検証、capture停止後の共通期限、全媒体のstage／retain、operator停止の引継ぎ、最終記録とcollector finalizationを接続する。timeout／rejectedで必須媒体が隔離された場合、既存HATEのprofileMissingPaths検査に掛かるため、受領recordを保存できることだけでエラーrunのHATE生成を完了扱いにしない。採用失敗のreasonと未保持媒体を最終記録へ結び付ける。

source→sanitized outputの項目別関連付け、producer側での元媒体の別名残存拒否、期限後応答の派生bundleも残る。実機identityはTask 68、固定SHA・実機／manual・外部GateはTask 69の継続項目である。AC-UP-003〜005やTask 67全体の完了は主張しない。

## sourceと証跡のSHA-256

この表は検証時のlocal snapshotであり、将来の修正やリリースSHAへ流用しない。先行失敗と最終成功を同じlogへ上書きしていない。

| path | bytes | SHA-256 |
|---|---:|---|
| `src/exploration/binary-attestation.ts` | 12970 | `c36f6ce8aa5f040bbace3f1c094e0fa63a371cdc2689fd9a1726ed30a291c03c` |
| `src/exploration/attestation-evidence.ts` | 4386 | `c82078246a5898bc79681f9dacc009407c91ef3c870c046fc318f8dbf63fab0f` |
| `src/exploration/attestation-publication.ts` | 4617 | `160b0a216b95cffe5d3e658851edc820131ff9ea797ae9e862eaeee171268d8d` |
| `src/exploration/attestation-exchange.ts` | 10945 | `6998cbad0fdc0f27336ec772596b80725aa3ec26be9fd9f84561069d040e5201` |
| `src/exploration/attestation-io.ts` | 7421 | `4356bdaba1c3d8ca44756ea03578b82e9c92dbb27794c505f9dcfec5790a3c59` |
| `src/exploration/contracts.ts` | 19018 | `3f6eeae33c27f5fb05531e3b21a7345854c1cf5b0c7f149c785f09d46e30c83a` |
| `src/core/artifact-policy.ts` | 6426 | `d72c732d5649632b9128e3630a548bbf0a2d616fbcf278cdf6003f01f2506551` |
| `src/core/hate.ts` | 6988 | `a42eb96edd905b75df738d77c41045872c599a44af606d2bc59dfedc3b217020` |
| `src/reporting/contracts.ts` | 3331 | `418daa21c23af96e0e756be2be63d67e32460fb71ca6eef19dcc8b8082468350` |
| `src/reporting/media-attestations.ts` | 3685 | `3019b37747ab6d145e99c22300ba47cd991076502311622c74788b98354f9b60` |
| `src/reporting/media-target.ts` | 2846 | `8376d08a7aa1411ec90c9e07c56221aa12bdef1964680bd4a1b3d322066d09fa` |
| `src/reporting/media-proof.ts` | 7167 | `44dd9ad4fad52729736f76a9346695e5e901c8384661286623a66ebab0850a3a` |
| `src/reporting/types.ts` | 5726 | `79fe609f0889f497c8159b6e7e2a7f728091439475ebd569e09e713ff8635f43` |
| `src/reporting/viewer-client.ts` | 25901 | `b07e1d5166616f96caef949262ea185fdfccd11e3c4898998ed9b0f07f3cff78` |
| `schemas/lakda-exploration-charter-v1.schema.json` | 7169 | `15cd5f475fdb2339553dd2e3f79c0e5b9813f9d4386faffa753b916cbf8e4e49` |
| `schemas/lakda-report-view-v1.schema.json` | 23985 | `03f2467a1e053ca25d7a1c3b411a3924a3173d22466ce452fdf74a5f591dff57` |
| `tests/binary-attestation-v2.spec.ts` | 12812 | `306f0a32017c5e997e432d67d4262c38d07f462d66f5dbb561378aa9c1bb3674` |
| `tests/attestation-media.spec.ts` | 17534 | `9c6a1af38d2c6d48ffa01014d011b1fe288e27a1a5fd561ced132cdeef7306bd` |
| `tests/report-media-target.spec.ts` | 20422 | `6244bb722acef43e313a00a1ec668ec0b16bec2bee63b606b9c8ca8dbc6e1c50` |
| `.lakda/attestation-publication-green.log` | 5098 | `5693ea9a1dee4d868eb6ff69b73da3760e9770a6dc4489c9e32ee28b3c70b8a4` |
| `.lakda/attestation-report-v2-final.log` | 3245 | `ec2600394ba2c4cfe874303b5b0756d0897a4382a7828338c0597d0d6f2f76f6` |
| `.lakda/attestation-report-raw-red.log` | 1820 | `e50d1c81685f5bf60267546579ce3c2c4880714b8b5f6062cb3f9a4b63713c0d` |
| `.lakda/attestation-evidence-report-check-final.log` | 69399 | `e3e961456d63f9803355dd047a8baea2304f419764ed25975a7592415feb645a` |
| `.lakda/attestation-evidence-report-pack-final.log` | 7460 | `1c302eb7500a8b989467b1d71d33e1d30780a09f4c366b132a2ff03d58b6d06a` |
| `.lakda/attestation-evidence-report-pack-offline.log` | 4420 | `602ee2c67303989d2fe1c2829176a7e7445d79f86973c977a5eb18202e4b036f` |
