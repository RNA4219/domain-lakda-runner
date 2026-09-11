---
task_id: TASK.20260910-64
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/SPEC-01-REPORTING.md
status: in_progress
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-10
---

# Task Seed: report入力・schema・bundle検証

## Objective

対象仕様: [実装仕様](../spec/verification-reports/SPEC-01-REPORTING.md)。

report入力・schema・bundle検証を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-01。

## Scope

対象path:
- `src/reporting/**`
- `src/adaptive/replay.ts`（読取validationの分離のみ）
- `src/exploration/session.ts`（修復を伴わないsnapshot検証の分離のみ）
- `src/exploration/binary-attestation.ts`（保存済みbytes／digestとoperator鍵を受け取る検証関数の分離。既存file APIの判定・署名payloadは維持）
- `src/exploration/target-manifest.ts`（検証済みsnapshotを使うpath非依存の検証入口を分離。既存preflight／承認条件は維持）
- `src/commands/reports.ts`
- `schemas/lakda-report-*.schema.json`
- `tests/report*.spec.ts`
- `tests/schema-catalog.spec.ts`
- `tests/binary-attestation.spec.ts`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- [Task 63](TASK.20260910-63.md)

## Plan

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

- 5個のversioned report schema、表示型、設定と入力index loaderを追加した。設定はtarget configと独立し、CLI優先、file相対path、未知項目／timeoutを検査する。source indexはroot逸脱・junction逸脱・排他的入力を拒否する。
- `report-config`／`report-sources`／`report-contracts`の6件とschema catalog 1件がpass。型、変更領域ESLint、文書checkはexit 0。対象はb027b6b＋dirty差分。
- 通常4 mode／adaptiveのrun projectionと、修復を行わないsession snapshot readerを追加した。sessionのevent chain／projection、Charter／report／capability、finding、参照run manifest copyと実runを照合する。restricted sourceは内容を表示せず、旧action planは実行件数nullを維持する。
- fixtureの既存CLIで生成したsessionから子runを読取り、明示runとの重複除去、101参照から1 sourceへの正規化、壊れたcopy／同一IDの内容競合拒否を確認した。sessionの更新lock／resume、入力index／artifact変更は再確認で拒否する。failure／finding重複とUTC日時の境界も確認した。
- `npx playwright test report- runs.spec.ts docs-checks.spec.ts schema-catalog.spec.ts --reporter=dot`は47件pass。型／ESLint／docs checkもpass。全体`npm run check`は289/290 passで、既存fixtureの期限切れ1件をTask 69で修正し、関連4件の再検証がpassした。対象は引き続きb027b6b＋dirty差分であり、固定SHAの受入ではない。
- 全体view集計を追加し、結果順序、計画／観測済み件数、sessionとrunの分離、UTC、容量、schema／秘密値検査を通す。local／share／text-onlyの基本media policyとstreaming copyを追加した。headerはcontainer判別のみで、codecの実描画検証はviewerへ残す。copyは全sourceとの重なりを最初のwrite前に検査し、実転送後のbytesを再hashする。mediaの4件と型／ESLintがpass。
- 明示入力IDをviewへ保持し、保存後にもcounts／参照／UTC／coverage／表示状態を再照合する。固定HTML shell、manifestと全fileのstreaming hash照合、埋込JSON一致、余分なfile／参照逸脱の拒否を追加した。出力予約、入力との重複拒否、専用stageの検証後rename、中止時の所有stage後処理も追加した。bundle／view／mediaの関連13件、型、ESLintがpassした。
- 初回段階では署名済みmedia proofとの接続とrecord／媒体の関連付けが未完了であった。署名接続後の検証は下記を参照する。このTaskはin_progressを維持する。bundle writer／verifierはTask 65でreceipt／公開CLI／実viewerへ接続済み。private worker index、全workerの結果照合、batchでの未確定run診断と、通常run／replay／batch／探索sessionの自動生成も接続した。
- 単一の未確定runは`lakda/run-start/v1`を検証し、localの最小診断へ接続した。`startRecordSha256`、任意の`incompleteRuns`／件数を追加し、旧確定runの読取を維持する。開始記録と完成metadataのbinding、更新再検査、未検証結果の非読取、share拒否、restricted非表示、重複・競合を検証する。関連14件と型・ESLintがpassした。実行中か異常終了かは開始記録から推測しない。

## Notes

2026-09-10実装追記: 保存済みtrace／oracle JSONLの完全参照を検証し、項目と媒体を対応付けた。adapter IDとHATE IDの差をsource内の対応表で解決し、findingはsessionのrun参照とoracle参照へ限定する。対応不明・非媒体は任意の`evidenceNotes`へ、restrictedはsource単位の制限理由へ投影する。媒体の高い機密区分を維持し、参照不一致と不正なdigestを拒否する。view verifyへ双方向参照・source／run所属の検査を追加した。現在の残る受入と全体検証はTask 65／69を参照する。

新規`report-media-links`の8テストを含む全体353テスト、型・lint・buildがpassした。人工sessionを既存event／finding／HATE関数で保存し、参照runなし・1件・2件の対応／曖昧判定、無関係runへの誤接続拒否を確認した。隔離installでも実packageのCollector／HATEから作った人工runを使い、媒体1件と履歴1件の相互参照を生成・verifyできた。ログとdigestは[Task 69](TASK.20260910-69.md)へ記録した。

2026-09-10要件詳細化追記: record／媒体の実装前に、SPEC-01「項目と媒体の参照解決」と要件案0.1.3-draftへ解決条件を固定した。既存adapter IDとHATE IDの差、完全参照とoracle JSONLの検証、session／run所属、曖昧・未保持・restricted、双方向view検証を対象にする。IDだけで対応表が保存されていない旧記録は補完しない。この要件詳細化の時点では実装・試験は未完了であり、後続の実装追記へ続く。

2026-09-10追記: HATE snapshotとoperator指定trust storeから既存v1の署名済み媒体を検証し、生成処理のmedia policyへ接続した。trust storeは128 KiB・1〜64鍵に制限し、秘密鍵・重複・未知field・途中変更を拒否する。real targetの許可鍵、session digest、開始時刻、capability／bridgeを照合し、adaptive runでは全session参照の条件を要求する。この署名接続の時点ではrecord／媒体の関連付けは未完了で、後続の実装追記へ続く。

関連13テスト（binary-attestation、report-collection、report-media-target、report-proof、report-signed-media、report-trust）がpassした。署名済み画像の生成・コピー・bundle verify、未知trust、署名不一致・重複、raw媒体残存、trust fileの上書き防止・コピー後変更を確認した。target条件のテストは人工archiveであり、実target・実機の受入ではない。renameされたraw bytesの検出も追加し、全体345テストと隔離packageの署名済み媒体生成・verifyがpassした。最終logとdigestは[Task 69](TASK.20260910-69.md)へ記録した。

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。
