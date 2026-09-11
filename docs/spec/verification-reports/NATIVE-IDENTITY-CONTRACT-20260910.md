---
document_id: LAKDA-NATIVE-IDENTITY-CONTRACT-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 実機identityの観測契約・照合器のローカル検証

対象は[Task 68](../../tasks/TASK.20260910-68.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)、REQ-UP-IDN-001〜005のうち観測記録と照合処理。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存のdirty差分を含む。固定SHAでの正式受入記録ではない。

## 実装範囲

観測記録 `lakda/native-identity-observation/v1` とbuild mapping `lakda/native-build-mapping/v1`、構造・値の検証器、承認済みcontextに対する純粋な照合器を追加した。Windows／Android／iOSの取得元tagを定義し、observed・declared-only・unavailableとoperator宣言を別々に保持する。必須のapp ID・build・device digestを宣言値で代用しない。

照合はplatform、bridge／capability digest、接続ID、今回のchallenge、provider名・版、app・端末、build mappingのdigestとrevisionを確認する。wall clockと単調時計の期限を両方検査し、期限境界・未来・再接続に相当するbinding差を拒否する。device digestはraw identifierを含む固定canonical JSONから生成し、返す記録と例外へraw値を出さない。これは署名承認や操作許可を生成する処理ではない。

## 検証結果

実行環境はWindows、Node `24.11.0`、npm `11.6.1`。宣言runtimeのNode `24.6.0`／npm `11.5.1`とは異なり、pack時のEBADENGINE警告を残している。宣言runtimeでの受入成功とは扱わない。

| command／段階 | 結果 | 範囲 |
|---|---|---|
| 実装前のnative test | exit 1、0件実行 | module未存在でload失敗。動作上の12件の失敗を確認した記録ではない |
| 初期のnative＋schema catalog test | exit 0、13件pass | 初期契約12件とschema catalog 1件。後続の境界assert追加前 |
| 初期の型検査 | 2件の型不整合を修正 | readonly配列の絞込みと判別unionのfixture。修正後の型検査はpass |
| 最初の全体check | exit 1、Lint 2件 | 制御文字の正規表現が規則に不適合。文字コード判定へ修正。build・test前に停止 |
| 最終 `npm run check` | exit 0、468件pass | docs、型、Lint、build、全回帰。native 12件・schema catalog 1件を含む |
| `npm run pack:check` | exit 0、529 files／57 schemas | offline cache、隔離install、CLI／package import、bridge、各report生成・検証 |

最終checkはUTC `2026-09-10T10:42:44.9754762Z`〜`2026-09-10T10:45:31.8829958Z`、packはUTC `2026-09-10T10:46:00.0812200Z`〜`2026-09-10T10:46:23.7707869Z`。その間にsource・schema・testを変更していない。Task・索引・checklist更新後の `npm run check:docs` と `git diff --check` はexit 0。記録した12件のbytes／digestが一致し、追加fileを含む10件の空白検査もpass。Gitの改行変換警告は別logへ保持した。

新しい12件は人工のin-memory観測値による試験であり、OS／SDKから実機情報を取得しない。全体checkには既存のローカルbrowser fixture試験を含む。

| 観点 | 確認内容 |
|---|---|
| 3 platformの正常照合 | build mappingから承認revisionへ対応し、返すproviderを入力objectから分離する |
| 必須観測 | app ID・build・device digestのdeclared-only／unavailableを拒否 |
| 構造と非公開値 | 未知field、raw device値、path／drive付きapp ID、不正Unicode、status／source矛盾、null buildを拒否 |
| 接続の対応 | 別bridge、capability、接続ID、challenge、platformを拒否 |
| 鮮度 | 1000／60000／300000 ms、期限境界、短い観測期限、未来・不正時計を検証。単調時計の小数は許容し、maxAgeの小数は拒否 |
| providerと宣言 | 許可名・版、app・device・宣言revision等の不一致を拒否 |
| mapping | 別digest・app・platform・provider・revision、存在しないbuild、重複、0件／513件、64 KiB超過を拒否。512件の有効な入力は受理 |
| 任意項目とdigest | platformVersionの必須化、必須field除外の拒否、platformごとのdigest差、固定golden値とraw非出力を確認 |

golden値は人工identifier `raw-device-canary` のAndroid入力について、production関数を使わず固定canonical JSON文字列とNode cryptoで独立計算した `sha256:2ed25b90cc813d5fb19ada61d2a6a4a8c7a541f50dd3a0d5bd22844f8ba15089` と照合する。Python providerとの相互運用は後続の検証対象である。

## 未完了事項

- OS／SDKから情報を読むprovider、bridgeの観測endpoint、接続ID・challengeを実行時に発行する処理は未実装。取得元tagはproviderの出力契約であり、取得APIの実装完了を示さない。
- 許可provider・必須field・mapping digestを署名へ束縛するexploration target manifest v2と、初回action前・resume・再接続への接続が残る。旧v1署名payloadと既存capabilityの意味を変更していない。
- 現行bridgeのCLI引数由来のrevision／端末digestが、この追加だけで独立した実観測に変わることはない。
- 実機3lane、宣言runtime、固定SHA、manual-bb、外部QEGの受入は未実施。AC-UP-008／022とTask 68は未完了を維持する。
- 媒体の隔離途中・派生bundle、IO-01、固定revision受入を含め、7領域全体の作業は継続する。

## 再検証

```powershell
npm test -- tests/native-identity.spec.ts tests/schema-catalog.spec.ts
npm run check
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
```

## 検証対象・記録のdigest

以下は最終検証後に採取した12件。先行のred／初期関連test／Lint失敗logは履歴として保存し、最終結果と区別する。本文書自身と後からリンクを加えるTask・索引・checklist・セルフレビューは含めない。過去の検証記録にあるdigestは当時のsnapshotとして保持する。

| file | bytes | SHA-256 |
|---|---:|---|
| `src/exploration/native-identity-contracts.ts` | 6865 | `60530983f34bba299253347a06c3b592c560d6daaf08f9252454a96a68aa69f0` |
| `src/exploration/native-identity.ts` | 6275 | `979b042e8337ecc9cd3f59a331ed62536571ddc4e4a5b30bf01ad87196ab3ddc` |
| `schemas/lakda-native-identity-observation-v1.schema.json` | 7660 | `3e7e043f9c2788e6e5d661dd13022ac55d60dd2c0ee9440ec15e8fecafdd1b72` |
| `schemas/lakda-native-build-mapping-v1.schema.json` | 2001 | `6eea3268d2fd418ce96e1b432d31802c6491fdf1d9a00d1acf38dec8685dc52d` |
| `tests/native-identity.spec.ts` | 12929 | `4e329621dcd9c2b2a1275e640c9629c11286e6e83976202205817513bb2fe724` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 31491 | `1392fb55f77f6156dec844819fa82b3749f60b81ef486285dc311c25361d979b` |
| `package.json` | 4207 | `5ca12adffd9a434c356972a6d607ddfd3fade5b678519c9810330168024ee78d` |
| `.lakda/native-identity-contract-red.log` | 482 | `bdfa91c1ec708671bb35ea5736dff6be55df0e030a081117640d9dad864c72d5` |
| `.lakda/native-identity-contract-related.log` | 2141 | `c4065383879a596f828bc3f1ed59c7ace7681c19d4eacd5d366d68454cca63e9` |
| `.lakda/native-identity-contract-check-lint-failure.log` | 920 | `6ac0e52a0946bfb30be69ed909548e4342ab870752b150eeafec0aa49264ead4` |
| `.lakda/native-identity-contract-check.log` | 78017 | `8e0203daeec3862d75b2da79fcf4501cdb22be45d74ed74e0a006bb03ed64d39` |
| `.lakda/native-identity-contract-pack.log` | 4722 | `2fee4b0adc419d3d7f179feffd5bc97f751dc97228e73f908c9b3d156ab45060` |
