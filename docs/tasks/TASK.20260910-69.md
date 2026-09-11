---
task_id: TASK.20260910-69
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/README.md
status: in_progress
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-11
---

# Task Seed: 統合Gate・package・実環境受入

## Objective

対象仕様: [実装仕様](../spec/verification-reports/README.md)。

統合Gate・package・実環境受入を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象は全仕様。

## Scope

2026-09-11のPR #17のCI対応として、Git管理外のローカル生成物へのリンク表記、Python fixtureの短縮パス比較、依存CIのPython導入方法を修正する。PlaywrightのWindows fixture用TEMPを実パスへ揃え、正規pathを要求する既存I/O契約を維持して全テストを再実行する。本体のパス検証条件・署名・hash付きlockは変更しない。

対象path:
- `package.json`
- `package-lock.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release-evidence.yml`
- `playwright.config.ts`（Windowsのfixture用TEMPを実パスへ揃える前処理のみ）
- `release-profiles/**`
- `scripts/validate-release-profile.mjs`
- `scripts/docs-checks/**`
- `scripts/check-docs.mjs`
- `tests/release-gate-evidence.spec.js`（期限に依存するfixtureの修正のみ）
- `docs/birdseye/**`
- `docs/acceptance/**`
- `docs/tasks/**`
- `docs/spec/verification-reports/**`
- `README.md`
- `RUNBOOK.md`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- [Task 66](TASK.20260910-66.md)
- [Task 67](TASK.20260910-67.md)
- [Task 68](TASK.20260910-68.md)

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

- [PR #17の初回CI](https://github.com/RNA4219/domain-lakda-runner/actions/runs/34583789813)（`0956085`）ではqualityとpackage-smokeが成功した。文書のローカル生成物リンク、WindowsのTEMP短縮名、Python 3.12.14のWindows配布方法で失敗したため、上記Scopeの範囲で修正した。本体のI/O検証、署名、依存lockの条件は変更していない。
- 2026-09-11の短縮TEMPによる再現では、`realpathSync()`が8.3形式を展開せず、CIと同じ106件が失敗した（`.lakda/ci-17-check-short-temp.log`）。`realpathSync.native()`へ補正した全体検査はdocs／型／lint／buildと579件が成功し、媒体応答待ちの1件とローカルheadedの1件が失敗した（`.lakda/ci-17-check-native-temp.log`）。この2件は同じ短縮TEMPで個別再実行し、変更なしで2件成功、9.2秒（`.lakda/ci-17-targeted-recheck.log`）。失敗した全体結果も保持する。Python fixtureは短縮TEMPで175件成功、skip 0（`.lakda/ci-17-python-path-fix.log`）。GitHubの最終成否はPRの対象commitに対応するCIで確認する。

- Task 64の先行回帰として`npm run check`を実行した。docs／型／lint／buildはpass、Playwrightは289/290 pass。唯一の失敗は既存release-gate fixtureのtriage dueDateが2026-08-31固定で期限切れだった。対象test／runtime scriptに今回の差分がないことを確認した。fixtureの期限を実行日＋7日へ変更し、`npx playwright test tests/release-gate-evidence.spec.js --reporter=line`の4件がpassした。runtimeの期限判定やhistorical evidenceは変更していない。
- bundle／offline viewer追加後の`npm run check`はdocs／型／lint／build／303 testsすべてpass（Playwright 1.4分、exit 0）。`test-results/.last-run.json`もpassed／failedTests空を確認した。対象はb027b6b＋dirty差分であり、固定SHAの受入ではない。
- 探索sessionの自動生成とpause／resume前提修正後の`npm run check`もdocs／型／lint／build／315 testsすべてpass（Playwright 1.6分、exit 0）。`test-results/.last-run.json`はpassed／failedTests空。対象はb027b6b＋dirty差分。
- `npm_config_cache=.lakda/npm-cache-offline`、`npm_config_offline=true`で`npm run pack:check`がpass。tarballの416file、全48schema、独立install後のCLI／package import／Python bridge同梱と、report generate／verifyの5file bundleを確認した。Node 24.11.0／npm 11.6.1のengine警告があり、指定release runtimeによる固定SHA検証は未実施。
- 固定SHAの統合Gate、実環境受入は未実施。Task 66〜68の完了を待つ項目は未完了のまま維持する。
- 通常run／replay／worker batchの自動生成・private index・worker表示接続後、`npm run check`のdocs／型／lint／build／326 testsがすべてpass（Playwright 2.1分、exit 0）。`test-results/.last-run.json`はpassed／failedTests空。対象は引き続きb027b6b＋dirty差分。
- 同変更後のoffline `npm run pack:check`もpass（435file、全49schema）。独立installしたpackageから通常runとprivate batch indexの両方でgenerate／verifyが成功し、`batchReport=true`を確認した。指定release runtimeとの差は未解消。ログは`.lakda/report-batch-check.log`と`.lakda/report-batch-pack-check.log`で、再実行時に更新されるローカル補助記録である。
- 単一runの開始記録・最小診断、旧完成runの参照互換修正後、`npm run check`のdocs／型／lint／build／334 testsがpass（Playwright 2.0分、exit 0）。実行直後の`test-results/.last-run.json`はpassed／failedTests空だった。ログは`.lakda/report-incomplete-check.log`。
- 同report変更後のoffline `npm run pack:check`は445file、50schemaでpass。独立install後の通常／batch／未確定runのgenerate／verifyが成功し、`incompleteReport=true`を確認した。未確定runは生成exit 2とdegraded、整合bundleのverifyはexit 0。ログは`.lakda/report-incomplete-pack-check.log`。Node 24.11.0／npm 11.6.1でのdirty補助検証であり、指定runtimeの固定SHAリリース受入ではない。
- 旧P6履歴化と文書checkerの回帰検査を追加した後、`npm run check`のdocs／型／lint／build／335 testsがすべてpass（Playwright 3.1分、exit 0）。`test-results/.last-run.json`はpassed／failedTests空。ログは`.lakda/report-incomplete-legacy-check.log`。現行profileの検証、文書検査、`git diff --check`もexit 0。Task 66〜68と本Task全体の固定SHA／外部受入が完了したという意味ではない。

## Notes

2026-09-10、媒体表示の補助検証: 原寸画像表示の修正後、全体358 testsとoffline package確認がpass。専用acceptance:reportsは最大corpus16条件と媒体40ケースにpassし、[媒体受入記録](../spec/verification-reports/MEDIA-ACCEPTANCE-20260910.md)へ証跡を集約した。最終source snapshotは`baa85ec15cc24ee566d4e0a50360dcbed6e3abc68543b130c9eca63d52ad9bbe`、HEAD＋dirty差分である。native controlsの全pointer操作、容量全境界、Task 62の残項目、Task 66〜68、fixed SHA／実環境／manual-bb／外部QEGは別途必要。

2026-09-10、レポート最大件数・browser zoom修正後: `npm run check`の356 tests／型／lint／build、`npm run acceptance:reports`の2 corpus・16 browser条件、offline `npm run pack:check`の466 files／50 schemas・隔離installがpassした。結果と全sample、source snapshot digest、初回失敗と修正内容、log digestは[測定記録](../spec/verification-reports/PERFORMANCE-20260910.md)に集約した。Node 24.11.0／npm 11.6.1、HEAD＋dirty差分でのlocal証跡である。最大byte容量の全境界と媒体操作の指定browser全条件、Task 62の残り、Task 66〜68、fixed SHA／実環境／manual-bb／外部QEGは未完了のまま維持する。

2026-09-10、項目と媒体の対応・動画状態保持・所属検証の補助検証:

- 最終の`npm run check`: exit 0。docs／型／lint／buildと353テストがpass（Playwright 2.8分）。終了後の`test-results/.last-run.json`は`passed`、`failedTests=[]`。新規`report-media-links.spec.ts`の8件を含む。
- offline `npm run pack:check`: exit 0。466file、50schema。隔離installのpackage自身のCollector／HATE exporterから人工adaptive runを作り、媒体1件と履歴1件の相互参照、生成・bundle verifyを確認した。意図的にcoverageを省いたfixtureのため、generateはexit 2／degraded、verifyは有効。`linkedMediaReport=true`。通常／batch／未確定／署名済み媒体の検査も維持してpassした。
- subjectは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`＋dirty差分。Node `24.11.0`／npm `11.6.1`。宣言runtimeとの差によるengine警告があり、固定SHA・指定runtimeのrelease受入ではない。
- 全体log: `.lakda/report-media-links-check.log`、SHA-256 `01ea321e37634ed907c013a638f0235486a2863611412c17f1eb315603312e21`。
- package log: `.lakda/report-media-links-pack-check.log`、SHA-256 `b5f4d659fccc62be59e57f13b6dbbc5744a78d68f7d97052919a66aaba09bf97`。
- UI画像: `test-results/report-media-links-viewer--8825e-d-focus-restoration-offline/media-associations.png`、SHA-256 `67199943dba5736561a20eeabe3230710d1d1d53a15282159fa1724c4bc3c025`。390px幅で履歴を選択した人工fixtureの画面を確認した。元媒体も人工データであり、実targetの証跡ではない。
- 最終監査で、項目関連のない媒体の`runKey`をnullにしても旧view検証が受理することを確認し、所属検証を補強した。その後の全体・package再実行を上記の最終結果とする。これらのlog／画像は再実行時に更新されるローカル補助記録である。
- 残項目: 指定Chrome／Edge build・200% zoom・最大corpus性能、Task 62の残るPython受入、Task 66〜68、固定SHAでの統合・実環境・manual-bb／外部QEG。対応付けのlocal実装からこれらの完了を推定しない。

2026-09-10、署名済み媒体接続・receipt公開修正後の補助検証:

- `npm run check`: exit 0。docs／型／lint／buildと345テストがpass（Playwright 2.4分）。終了後の`test-results/.last-run.json`は`passed`、`failedTests=[]`。
- offline cacheを指定した`npm run pack:check`: exit 0。457file、50schema。隔離installしたpackage自身のCollectorとHATE exporterで人工PNGと署名を確定し、report設定のtrust storeを使って共有HTMLを生成・verifyした。署名済み媒体1件、6file bundle、`signedMediaReport=true`を確認した。通常／batch／未確定runの検査も維持してpass。
- subjectは`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`＋dirty差分。Node `24.11.0`／npm `11.6.1`で実行した。宣言runtimeとの差によるengine警告があり、固定SHA・指定runtime・実機・外部QEGの受入完了ではない。
- 全体log: `.lakda/report-signed-media-check.log`、SHA-256 `51243e9d7e6b66c1a1fe9e52dc3b4fa10b2219ca5d00e29a209c71d70bf6b8a2`。
- package log: `.lakda/report-signed-media-pack-check.log`、SHA-256 `05ddcbb8dd508ad90c4ba111260f2dd1746ee0ac9989fcf5445b8aa1bce14957`。
- UI画像: `test-results/report-signed-media-genera-6da8b--rejects-retained-raw-bytes/signed-media-proof.png`、SHA-256 `14e5037f55717e31fd8338601811b48b3579e6020a20b1dd91d02c59b8ff4d4d`。生成時の検証記録を展開したfixture画像であり、実targetの証跡ではない。
- これらのlog／test-resultsは再実行時に更新されるローカル補助記録。Task 62、64〜69の残項目と固定SHAの受入状態は変更しない。

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。
