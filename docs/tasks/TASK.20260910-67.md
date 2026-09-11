---
task_id: TASK.20260910-67
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md
status: in_progress
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-10
---

# Task Seed: binary attestation受渡し実装

## Objective

対象仕様: [実装仕様](../spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)と[レポートの項目別参照](../spec/verification-reports/SPEC-01-REPORTING.md)。

binary attestation受渡し実装を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-02。

## Scope

対象path:
- `src/exploration/binary-attestation.ts`
- `src/exploration/attestation-*.ts`
- `src/adaptive/coordinator/runtime.ts`
- `src/adaptive/coordinator/orchestrator.ts`
- `src/core/artifact-policy.ts`
- `src/core/artifacts.ts`
- `src/core/hate.ts`
- `src/exploration/session.ts`
- `src/exploration/contracts.ts`
- `src/commands/exploration.ts`
- `src/core/runner.ts`
- `src/runs/artifact-snapshot.ts`
- `src/reporting/media-attestations.ts`
- `src/reporting/media-proof.ts`
- `src/reporting/media-target.ts`
- `src/reporting/media-replacements.ts`
- `src/reporting/evidence-index.ts`
- `src/reporting/evidence-links.ts`
- `src/reporting/generation.ts`
- `src/reporting/run-source.ts`
- `src/reporting/attestation-results.ts`
- `src/reporting/contracts.ts`
- `src/reporting/types.ts`
- `src/reporting/viewer-client.ts`
- `schemas/lakda-binary-*.schema.json`
- `schemas/lakda-exploration-charter-v1.schema.json`
- `schemas/lakda-report-view-v1.schema.json`
- `tests/binary-attestation*.spec.ts`
- `tests/attestation*.spec.ts`
- `tests/report-media-target.spec.ts`
- `tests/report-media-replacements.spec.ts`
- `tools/airtest-poco-bridge/**`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- [Task 62](TASK.20260910-62.md)

## Plan

IO-01の元媒体喪失経路は、コピー後のunlinkを、run外のprivate `originals/<requestId>/<sourcePath>`への移管へ変更して検証する。検査入力用の`sources/`は独立コピーのままとし、移管した元fileは削除・上書きしない。移管先のrequest directoryを排他的に新規作成し、directory identityとpathを移管前後に検証する。異なるvolumeやOSの使用中制限で移管できない場合はコピー＋削除へfallbackせず、元fileを保持してstageを失敗にする。移管直後の停止やbytes不一致でも移管済み原本を保持する。`tests/attestation-originals.spec.ts`で最終stat後のin-place更新・path差替え、移管失敗、既存保管先、停止を同期注入して検証する。一般readerの排他性、移管後も動くwriter、異volumeの成功経路は引き続き別の設計・受入課題として扱う。

未解決IO-01を保持する。同一inode・容量・mtimeNs・ctimeNsで内容が更新されるcaseをlocalで確認したため、metadata再照合だけで媒体不変性を証明したとは扱わない。元fileを除去する前のprivate保持と排他／file移管方式を評価し、in-place更新の先行失敗を修正済みへ書き換えない。check後のfile差替え検出とは別の受入条件とする。

大型媒体の読取では共通snapshot readerに任意の非破壊checkを追加し、64 KiB以下のread前後と最終照合前後へ停止・期限を伝える。inventory、隔離後の元file再照合、採用前のprivate source照合、コピー先再読取、公開前の再照合へ接続する。既存のsignalと、callbackなしの読取契約を維持する。通常runの受渡し期限はinventory開始前に固定し、wall clock後退で単調時計の期限を延長しない。診断証跡の確定は期限後も必要なため媒体採用と分離し、独立した有界の終了処理として検証する。中断時の元bytes・private copy・既存採用先の保持、作成途中の新規copyの撤回を同期fixtureで確認する。

項目別media参照は、署名・媒体bytes・適用されるtarget条件を検証してから、sanitizedのsource→output対応を参照索引へ渡す。完全参照のpath／size／digestが同一source内の署名済みsourceと一致した場合だけoutputへ解決する。IDのみの旧記録を命名規則から補完せず、曖昧な対応や未検証proofを採用しない。対応元の機密区分は出力媒体へ引き継ぎ、履歴・finding・eventとbundleの双方向参照を検証する。

失敗時の確定記録は`lakda/binary-attestation-result/v1`で要求全体・受領file digest・採用状態・理由・採用先を結び付ける。Artifact Policyは実際の必須媒体欠落を保持し、同一runの検証済み未採用記録に対応する欠落だけを別欄へ記録する。HATEはerror outcomeで全欠落を説明できる場合に限って診断証跡を確定する。reportは同じHATEのsnapshotから記録を検証して未保持理由を表示する。成功への昇格、未記録欠落の免除、raw媒体の公開を禁止する。

Task 62のPython fixture・lock照合はlocalで確認済み。remote CI・実機受入の残項目は同Taskに保持する。本Taskではまず要求／応答schemaと署名・期限・参照bindingを固定し、その後private staging、待機・停止、採用とrun finalization、report読取へ接続する。契約単体の通過を受渡し全体の完了とは扱わない。

媒体処理では、停止済みsourceの隔離、署名済みoutputのstreaming照合、元fileと採用先の不変性、失敗時のprivate保持を先にfixtureへ固定する。既存run内に未隔離rawが残る場合は公開finalizationへ進めない。no-sensitive-contentは検査済み元bytesを元pathへ保持し、sanitizedは予定outputだけを採用する。

1. 対象仕様・checklistを読み、変更前の関連testと状態を確認する。
2. 意味変更はtestで期待値を先に固定する。source変更は原則2fileまたは100行の小さいループで進める。
3. 関連test、型・lint、必要な統合／package検証を実行する。
4. 実結果をEvidenceへ記録し、未取得の外部条件はpending_externalとして残す。

## Patch

対象moduleの責務内で実装し、既存5 mode、stdout／exit、HATE／QEG境界を維持する。分割と機能追加は別変更単位にする。

## Tests

[詳細受入](../proposals/20260910-detailed-checklist.md)と対応仕様checklist。実機が必要なcaseはfixtureで代替しない。

## Commands

`npm run check:docs`、`npm run typecheck`、変更領域のtest、必要に応じて`npm run check`／`npm run pack:check`、`git diff --check`。

## Evidence

- [要求／応答受領のローカル検証](../spec/verification-reports/ATTESTATION-EXCHANGE-20260910.md): request v1、response v2、receipt v1、署名binding、公開run外のatomic受領を実装。新契約9件・受領11件・schema catalog 1件がpass。
- `npm run check`: 379 tests pass、exit 0。`npm run pack:check`: 484 files／54 schemas、隔離install pass、exit 0。対象はHEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`とdirty差分。source・test・logの13 digestを上記記録へ保存。
- 通常run接続、媒体bytesの隔離／採用、HATE／report v2、期限後の派生bundleは残る。上記はTask全体・実scanner・実機受入の完了ではない。
- 後続の[媒体隔離・採用のローカル検証](../spec/verification-reports/ATTESTATION-MEDIA-20260910.md): sourceを保持するstreamingコピーと採用をexchange.stage／retainへ接続。新しい媒体13件を含む関連33件、全体392件、package 490 files／54 schemasがpass、各commandはexit 0。11件のsource／log digestを保存した。通常run／HATE／report v2は継続対象。

## Notes

最新のlocal検証: [原本の非公開保全・停止制御](../spec/verification-reports/ATTESTATION-ORIGINALS-20260910.md)。原本保全7件を含む関連56件、全体456件、package 521 files／55 schemasがpass、各commandはexit 0。最終stat後の更新と差替えを拒否し、移管後の原本を保持する。コピー後のunlinkを除去し、移管前後の停止・期限、EXDEV／EACCES／EPERM、既存保管先を検証した。21件のsource／test／log digestを保存した。別volumeでの成功、一般readerの排他性、IO-01全体と下記の残作業は未完了である。

先行のlocal検証: [検査済み画像と履歴・findingの対応付け](../spec/verification-reports/ATTESTATION-MEDIA-LINKS-20260910.md)。関連30件、全体439件、package 521 files／55 schemasがpass、各commandはexit 0。同じsource内の署名済み対応、機密区分の継承、子run履歴・finding・eventのHTML表示とbundleを検証し、16件のsource／log digestを保存した。

先行のlocal検証: [未採用理由・診断HATE・HTML表示](../spec/verification-reports/ATTESTATION-RESULT-20260910.md)。関連46件、全体430件、package 518 files／55 schemasがpass、各commandはexit 0。resultの要求binding、全件照合、診断HATEと保存済みreportを検証した。Chromiumの表示サンプルと30件のsource／log／出力digestを保存した。

通常runへの接続のlocal検証: [capture停止・要求と採用・operator制御・保存先検証](../spec/verification-reports/ATTESTATION-RUN-20260910.md)。接続9件、全体417件、package 508 files／54 schemasがpass、各commandはexit 0。source／logの16 digestを照合した。失敗時の最終記録など下記の残作業を保持し、Task状態はin_progressとする。

保存済み証跡のlocal検証: [受領記録の公開・HATE／report v2](../spec/verification-reports/ATTESTATION-EVIDENCE-REPORT-20260910.md)。受領公開の関連35件、reportの関連21件（共通testを含む）、全体408件、package 496 files／54 schemasがpass。25件のsource／log digestと先行失敗を記録した。状態はin_progressを維持する。

通常runへ`capture.binaryAttestation`の受渡しを接続した。private root／trustの接続前検証、capture停止状態、共通期限の全媒体stage／retain、既消費operator commandの引継ぎ、採用後の記録公開、collector finalizationを通す。実browserと人工attestorによる正常HATE、応答なしと後続応答、待機中kill、既消費pause、trust変更、close未確認、不正なprivate保存先を9件のfixtureで確認した。

timeout／rejected／採用失敗で隔離された必須媒体は、versioned resultと全要求一覧により欠落理由を照合し、error outcomeを保った診断HATEへ確定できる。reportにも保持できなかった理由を表示する。必須媒体の期待値は解除しない。新受渡しの公開前とresultを持つ保存済みrunで、元媒体の別名残存を拒否する。source→sanitized outputの項目別関連付けは検証済み対応を使って接続した。停止未確認・隔離途中の失敗は未確定のままであり、既消費pause時の完全隔離、実storageでの大型媒体受入、期限後の派生bundleは残る。通常ローカルI/Oの停止・期限伝播は上記の関連56件へ含めて確認した。

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。

接続点は`runLakda`のvideo retention後・collector.finalize前で、captureの停止未確認時はretentionも進めない。run metadataとArtifact Policy／HATEの両経路へrun／target／policy bindingを伝え、固定media pathの必須判定を検証済みsource→output対応で補う。保存済みv2は当時の受領時刻で検証する。次はIO-01の残る排他・保管方式、隔離途中の終了と期限後の派生bundleを実装・検証する。
