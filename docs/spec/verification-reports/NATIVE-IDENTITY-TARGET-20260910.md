---
document_id: LAKDA-NATIVE-IDENTITY-TARGET-20260910
status: local-evidence
last_updated: 2026-09-10
---

# Native target v2の署名・policy照合

対象は[Task 68](../../tasks/TASK.20260910-68.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)、[セルフレビュー](SELF-REVIEW-20260910.md)のSR-58〜61。[HTTP受渡し](NATIVE-IDENTITY-EXCHANGE-20260910.md)に続く、署名済み条件の検証部分である。HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、既存dirty差分込み。実機・固定SHAの受入ではない。

## 実装した境界

native専用のexploration target manifest v2へ、端末digest、許可provider、必須field、maxAgeMs、providerごとのbuild mappingとdigestを追加した。mappingは外部pathを参照せず文書へ埋め込む。許可providerとmappingを一対一で対応させ、platform・app ID・canonical digest・承認revisionへの対応を検査する。mappingに別revisionのentryがあっても、観測したbuildの対応先が今回のrevisionでなければ拒否する。

v2の署名payloadにはalgorithm・keyId・承認期間・承認参照も残し、signedPayloadDigestとvalueBase64だけを除外する。承認期間はcanonicalなミリ秒付きUTCでfrom < until、検証時刻はfrom以上・until未満とする。共通target loaderは同一keyIdの複数候補を拒否する。v1の署名payloadとschemaを維持し、保存済みv1の署名検証を回帰試験した。v1 schemaのgit objectもHEADと一致する。

署名検証済みtargetのpolicyを、今回のacquisitionと既存の観測照合器へ渡すhelperを追加した。helper単独ではoperator署名を検証せず、呼出し側が先に署名検証を完了する契約である。acquisitionもNode HTTP clientが検証した今回の応答を前提とし、保存された観測を操作許可へ昇格するAPIではない。

段階導入中のv2は、共通loaderへ `nativeIdentityPolicy: "validate-only"` を明示した文書検証でのみ受理する。既定のHATE／report／acceptance readerへ新しい観測証跡の検証が接続されるまでは、既定loaderでv2を拒否する。CLI preflightは明示検証後も未接続のaction制御を理由にbridge接続前で拒否する。この指定は実行許可ではない。

## 検証結果

Windows、Node 24.11.0／npm 11.6.1。宣言runtimeのNode 24.6.0／npm 11.5.1とは異なり、packのEBADENGINE警告を保持する。署名試験はローカル生成のEd25519鍵と人工の条件・観測を使用した。target入力のexecutionMode=realはschema上の条件であり、実環境の実行証跡を意味しない。

| 検証 | 結果 | 内容 |
|---|---|---|
| v2実装前 | 8 tests、6 failed／2 passed | 既存v1 loaderではv2の正常系が成立しないことを確認 |
| reader境界の追加前 | 1 test failed | 既定snapshot loaderがv2を受理していた。SR-61の追加試験と失敗logを保持 |
| 最終関連試験 | 26 passed | v2 target 13件、既存native verifier 12件、schema catalog 1件 |
| 最初の全体check | 488 passed | SR-61反映前。最終結果とは区別して保存 |
| 最終 `npm run check` | 489 passed、exit 0 | docs・型・Lint・build・全回帰。新target 13件の実行をlogで照合 |
| 最初のoffline pack | 539 files／59 schemas、exit 0 | SR-61反映前の配布物検査 |
| 最終offline pack | 539 files／59 schemas、exit 0 | 新schema収載、隔離install・CLI・package import・report検査 |

最終全体checkはUTC `2026-09-10T12:20:40.6817103Z`〜`2026-09-10T12:23:46.0568314Z`、最終packは `2026-09-10T12:24:03.8114112Z`〜`2026-09-10T12:24:27.3827429Z`。最終check開始以降、runtime・schema・test・配布READMEは変更していない。本記録・Task・索引・checklist・セルフレビューのリンク追加後にdocsとdiffを再検査する。

13件は3 platformの署名・観測照合、署名metadataとpolicyの変更拒否、必須fieldの緩和拒否、providerとmappingの一対一対応、厳密な期限・重複keyId、署名済み条件による観測の拒否、旧v1互換、file／snapshotと容量、digestを再計算した後のmapping意味不整合、不正UTF-8・過大padding・未知version、CLI初回／draft resumeの接続0、1／300秒・provider 16件の境界、既定readerのv2拒否を扱う。

CLI試験は接続関数を計数し、初回とaction履歴のないdraft resumeで呼出し0を確認した。初回のsessionはaborted・actionCount=0となる。実SDK・端末への接続、履歴のあるpaused sessionの再開成功、再接続後のaction guardを検証したものではない。既定readerの追加試験は共通file／snapshot loaderの拒否であり、新しいHATE／report観測表示の完成試験ではない。

途中の型検査では遅延import先のassertion関数にTS2776／TS2775が発生し、明示したmodule型で解消した。試験の空fixture引数によるLint 2件はbrowserNameを出力directoryへ用いる形で修正した。このfixtureはbrowserを起動しない。全体回帰は既存のlocalhost browser／HTTP試験を含む。Python source・testsはこのv2変更単位では変更せず、先行HTTP記録の83件passを参照し、Python全体を改めて実行したとは主張しない。

## 残る実装と受入

- action直前の有効性確認、初回／resume／再接続への実行接続、観測のsession保存とHATE／report読取は未実装。CLIと既定readerの拒否を解除しない。
- Windows／iOSの実provider、Androidを含む実機3lane、実operator署名による対象承認、固定SHA・宣言runtime・manual-bb・外部QEGの受入は残る。人工の鍵・観測を代用しない。
- 文書の256 KiB制約はraw bytesと構造化文書を検査する。共通loaderがfileを読みJSONをparseする前のmemory割当上限を保証する実装ではない。
- v1の形式互換を保つことは、新しいnative観測要件を満たすことではない。validFrom等も含めた新版の署名規則をv1へ遡及適用しない。
- Task 68とAC-UP-008／022はin_progress／未完了を維持する。媒体のIO-01・隔離途中・派生bundle、固定SHAの受入を含む7領域の残作業も維持する。

## 再検証

`npm test -- tests/native-identity-target.spec.ts tests/native-identity.spec.ts tests/schema-catalog.spec.ts`、`npm run check`、offline cacheを指定した`npm run pack:check`を使う。既存の記録を上書きしない新しいlog名を指定する。

## 検証対象・記録のdigest

14件。SR-61以前の全体check・packは履歴として区別する。本記録とリンク追加先のTask・索引・checklist・セルフレビューは表へ含めない。過去のHTTP／Android記録のdigestは当時のsnapshotとして維持する。

| file | bytes | SHA-256 |
|---|---:|---|
| `src/exploration/native-identity-target.ts` | 4831 | `e1d268e4e6e207f3dc23e3c065e08425c2143eeddeb4adda337ce01bfcf727f8` |
| `src/exploration/target-manifest.ts` | 12329 | `33d8a4c68fbdf8dd5e2dda7148218d5754f87a1c89b70b5198f4aafcd3d2c71a` |
| `src/commands/exploration.ts` | 32953 | `3024704ca3c40a4360f6c2a397c9e11646b8df9fd6e4a6f744d6f0a3fe45ee17` |
| `schemas/lakda-exploration-target-manifest-v2.schema.json` | 5194 | `7730e3244bd688fff0aec1d743c252acd4acbc1082bf59755a11beb8f985f980` |
| `tests/native-identity-target.spec.ts` | 21835 | `5601664bac03addf1b82dace39c8a9c41dcb41ee70674e9eef7873ace9416d7c` |
| `docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md` | 38757 | `c9a93516241eb3fd2889f123e8432dd29d632b95a060f77fc63b4305e31cf77d` |
| `tools/airtest-poco-bridge/README.md` | 10017 | `62f99dc5b37d7a9c9aa5b01f20a4d1b602e525d03e9364f8c8da4993b7b99709` |
| `.lakda/native-identity-target-red.log` | 19586 | `34b5fe09b54c67fc28c1d387810417f0efbcd898f3b92851900e5aa8ad6dc059` |
| `.lakda/native-identity-target-reader-red.log` | 3715 | `784de957e6b3f7f9c6a48c1351cbcafe22e19d2a95d19eef1051745f0155b2a4` |
| `.lakda/native-identity-target-reader-related.log` | 4089 | `126a2a053a78f58249d6412c6411341f04f6e1d86a488fcade2a366edd32e683` |
| `.lakda/native-identity-target-check-before-reader-guard.log` | 80955 | `c773ded94163e6bea8964b7f82afa90492db2970da17f4355e1c8a4d8964c7b9` |
| `.lakda/native-identity-target-pack-before-reader-guard.log` | 4940 | `d03c60f236011143f7224e1def0dcfd061d5e92558bd305e7a0c40fb36ad29f7` |
| `.lakda/native-identity-target-check.log` | 81104 | `ed90e68a4fca134afc3e8a97aaa111c7f190e1daad8ab09b52c2c267c19f6b51` |
| `.lakda/native-identity-target-pack.log` | 4940 | `7684fa9896a65718b40a2ed21e572da7dcb409e3e790c8d309d982557dbf3756` |
