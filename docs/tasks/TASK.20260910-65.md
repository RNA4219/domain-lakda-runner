---
task_id: TASK.20260910-65
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/SPEC-01-REPORTING.md
status: in_progress
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-11
---

# Task Seed: report viewer・CLI自動生成・画面検証

## Objective

対象仕様: [実装仕様](../spec/verification-reports/SPEC-01-REPORTING.md)。

report viewer・CLI自動生成・画面検証を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-01。

## Scope

2026-09-11の実操作で見つかった2点を修正する。失敗手順・前後移動に左の履歴一覧を追従させ、状態名の`failed`と`failure`を日英で区別できる表示にする。状態filterの値と保存記録は維持し、表示名による検索、100件の境界、狭幅、ブラウザー実操作を確認する。

2026-09-11の利用フロー確認: 既存reference appをloopbackで配信し、実CLIの起動・正常終了／操作失敗・自動生成通知・レポート閲覧・証跡確認・日英再生成・verifyを接続する。過去の保存runも変更せず再生成して確認する。普段の実targetが未指定の場合はreference appと実運用を区別する。通常runの実出力で使い勝手の不足が見つかった場合、上記report viewerとCLI通知の範囲で最小修正し、実行結果や媒体の対応を推測しない。

2026-09-11のAirtest基準レビュー対応: AR-01〜03を実装する。report内の任意step情報に保存済みの操作名・対象説明・成否・時間・判定messageを投影し、旧bundleを受け付ける。実行／判定のstatusを区別し、未取得値や媒体対応を推測しない。表示は手順一覧と選択内容・画像をPCで並べ、狭幅で縦にする。失敗手順への移動、前後の手順、全体証跡への復帰、技術情報の開閉を追加する。日英・100件の境界・媒体の位置保持／停止・focus・機密区分を検証し、画面画像で調整する。

2026-09-11のレビュー指摘対応: UIR-01〜03を実装する。320 CSS px以下に動画の再生・一時停止とシークバーを追加し、操作状態・読込失敗を反映する。生成時の不足理由を上部で案内し、実行の警告件数を別ラベルにする。詳細に媒体への移動ボタンを付け、媒体を履歴・coverageより前へ配置する。既存の言語・媒体の保持・再生位置・停止・focus契約を維持し、UI testと媒体受入scriptの通常操作で確認する。

2026-09-11のUI調整: 白基調の配色・余白・文字階層を整える。概要の補足件数・時間を開閉できる領域へまとめ、結果一覧へ保存メッセージの短い表示を追加し、詳細のメッセージと閉じる操作を見つけやすくする。日本語・英語、狭幅、キーボード操作、媒体操作を確認する。集計・元データ・HTML契約は維持する。

2026-09-11の追加指示: レポートの出力言語を`ja|en`から選択する。以下のreport設定・view schema・CLI・HTML／viewer・test・配布確認の範囲で実装する。

対象path:
- `src/reporting/**`
- `src/commands/runtime.ts`
- `src/commands/exploration.ts`
- `src/commands/reports.ts`
- `src/cli/**`
- `src/core/artifacts.ts`
- `src/core/run-start.ts`（操作前の最小開始記録。既存run metadata／stdout／結果判定は変更しない）
- `src/core/runner.ts`
- `src/adaptive/evidence.ts`（pause／resume検証で判明したoperator記録の再生用projection混入の修正のみ。観測traceとHATEへの保持は維持）
- `src/adapters/playwright/adapter.ts`（操作後observeへのpersonaRef引渡し漏れのみ。fingerprint算法／照合条件は変更しない）
- `schemas/lakda-action-execution-v1.schema.json`
- `schemas/lakda-run-start-v1.schema.json`
- `schemas/lakda-report-*.schema.json`
- `tests/report*.spec.ts`
- `tests/cli-boundaries.spec.ts`（既存help行を保持した新command行・report option説明の追記のみ）
- `scripts/check-package-*.mjs`
- `scripts/run-acceptance.mjs`
- `scripts/run-real-llm-acceptance.mjs`
- `scripts/run-report-acceptance.mjs`
- `scripts/report-acceptance/**`（人工保存runの最大corpus・画像／動画／参照対応fixture生成、測定、隔離browser profileでのoffline UI受入のみ）
- `package.json`
- `package-lock.json`
- `examples/**`
- `README.md`
- `RUNBOOK.md`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- [Task 64](TASK.20260910-64.md)

## Plan

1. 対象仕様・checklistを読み、変更前の関連testと状態を確認する。
2. 意味変更はtestで期待値を先に固定する。source変更は原則2fileまたは100行の小さいループで進める。
3. 関連test、型・lint、必要な統合／package検証を実行する。
4. 実結果をEvidenceへ記録し、未取得の外部条件はpending_externalとして残す。

## Patch

対象moduleの責務内で実装し、既存5 mode、stdout／exit、HATE／QEG境界を維持する。分割と機能追加は別変更単位にする。

## Tests

pause／resumeの統合検証で、再生用traceにもoperator-controlがコピーされ、resumeが既存replay validatorで拒否される不整合を確認した。新規のreplay用projectionからoperator操作の4種だけを除き、観測用traceには全件を残す。0 actionのresumeは空の再生fileを入力にせず、既存capability／fingerprint照合を保持して再開する。この限定した前提修正はTask 65に含める。既存保存fileの書換え、replay validatorの緩和、candidate選択の変更は行わない。

[詳細受入](../proposals/20260910-detailed-checklist.md)と対応仕様checklist。実機が必要なcaseはfixtureで代替しない。

## Commands

`npm run check:docs`、`npm run typecheck`、変更領域のtest、必要に応じて`npm run check`／`npm run pack:check`、`git diff --check`。

## Evidence

- [実操作の指摘2点への対応](../spec/verification-reports/TOUCH-FIXES-20260911.md): 履歴の選択行へのスクロールと、実行失敗／失敗項目の表示名を修正した。関連15件・全581件がpass。保存済みの参照アプリrunから日英を再生成し、Chromeで絞り込み・検索・手順移動・画像を確認した。

- [利用フロー確認](../spec/verification-reports/USER-FLOW-20260911.md): 参照アプリの実CLI実行から正常／失敗・自動生成・画像／動画・日英再生成まで接続した。通常runの失敗手順で全体証跡へ辿りにくいUF-01を修正し、長い保存パスの表示制約UF-02を記録した。過去保存runも再生成・閲覧した。全579件、Chrome／Edgeの40ケース、offline配布物検査がpass。普段の実targetでの受入とは区別する。

- [Airtest基準レビューへの対応](../spec/verification-reports/AIRTEST-ADJUSTMENT-20260911.md): AR-01〜03の手順情報、失敗・前後移動、手順と画像の左右配置を実装した。日英の100件境界、旧view、媒体の欠落・動画位置・focusを検証し、保存画面で高さと狭幅の余白を調整した。折り畳みにより隠れたworker未完了状態も初期表示へ戻した。指定Chrome／Edgeの8条件40ケースがpass。全体と配布物の結果は対応記録を参照する。

- [UIレビュー指摘対応](../spec/verification-reports/UI-REVIEW-FIXES-20260911.md): UIR-01〜03の動画操作・資料不足の案内・媒体への導線を日英で修正した。200%での画像縮小時の枠超過も修正し、関連21件と全571件がpass。Chrome／Edge媒体確認は単独実行で8条件40ケースがpassし、先行するtimeoutも保存した。人工サンプルの両言語bundle verifyはvalid。自動操作と保存画面での確認範囲を明記した。

- [生成レポートのUIレビュー](../spec/verification-reports/UI-REVIEW-20260911.md): 日英生成物の再verifyと保存画面・操作コードを照合した。200%での動画操作、資料不足の説明、媒体への導線にP2を3件記録し、未修正のままchecklistへ追加した。直接ブラウザ操作はポリシー上の制限があり、保存画面のレビューと区別する。今回source変更はない。

- [基本レポートのUI調整](../spec/verification-reports/UI-ADJUSTMENT-20260911.md): 白基調と主要件数の優先表示、補足情報の開閉、一覧でのメッセージ表示、詳細の全幅メッセージと固定した閉じる操作を実装した。日英の表示7件、最終全566件、Chrome／Edgeの媒体8条件40ケースがpass。画面画像で見つけた200%の本文と閉じるボタンの重なりも修正し、最終形で再確認した。

- [日本語・英語のレポート出力](../spec/verification-reports/REPORT-LANGUAGE-20260911.md): `--report-language ja|en`と設定ファイルのlanguageを自動生成・再生成へ接続した。既定値は日本語、元メッセージとIDを保持し、旧bundleのverifyも成功した。全564件とoffline package 592 files／65 schemasがpass。両言語の人工サンプル、画面画像、20 sourceのhashを保存した。

- [基本レポートの仕上げ](../spec/verification-reports/BASIC-REPORT-20260911.md): ユーザーの簡素化方針を要件へ反映した。195 CSS pxで画像が約55pxへ縮む問題を先行テストで検出し、狭い画面の余白を修正した。最終全559件とChrome／Edgeの媒体40ケースがpass。表示サンプルとbundle verifyを保存した。比較・開発用テスト集約・レポート履歴管理は保留し、固定revisionでの全条件受入の状態は維持する。

- [native v2の保存証跡・report接続](../spec/verification-reports/NATIVE-IDENTITY-REPORT-20260911.md): Task 68で媒体なし／textOnlyにも署名・観測検証を接続した。report設定のtrustだけを使用し、応答不明はwarningとdegraded、HATEの記録欠落・不正・孤立fileは拒否する。全体534件とpackage検査がpass。今回Pythonや実機受入は再実行していない。

- Task 64のview／bundle境界を使い、offline viewerとstandalone CLIを実装する。Task 64の残りの入力／media policyと自動生成の接続は未完了であり、依存全体の完了を意味しない。
- 固定CSS／JS viewerを追加し、概要、AND filter、安定順／ページ分割、詳細dialog、sequence優先履歴、coverage、媒体、入力digestを表示する。UTC／端末timezone切替と詳細を閉じた際のfocus復帰を実装した。browser test 2件がpassし、file://での移動後起動、外部HTTP通信なし、文字としてのmessage表示、390pxでの横overflowなし、実PNGの表示／拡大、frame順、画像／動画decode errorの理由表示、autoplayなしを確認した。
- 1366×768／390pxのスクリーンショットを確認した。現時点はPlaywright Chromiumによるfixture検証であり、指定Chrome／Edge実build、200% zoom、最大corpus性能測定、自動生成は未完了。
- 通常modeの`lakda/action-execution/v1`を追加した。安全・予算検査後の試行だけをsequence、ID／kind、開始／終了UTC、monotonic duration、completed／failedとして記録し、HATEへ含める。入力値／locator／URL／raw errorを追加しない。report readerは実行済みprefixと同じrun／計画のbindingを検査し、新規履歴では観測attemptだけをtimelineへ出す。旧runは計画／件数未取得を維持する。record生成・境界3件を含む関連11件、型、ESLintがpassした。
- 通常runnerの回帰34件がpassした。standalone `report generate`／`report verify`と生成receiptを接続し、failed runをfailedのままready reportへ出すこと、receiptの単一JSON、出力と入力の保持、重複／競合／無関係option拒否、保存後変更の検出をCLIテストで確認した。関連CLI 5件、型、ESLintがpass。自動生成／private worker入力と署名済み媒体proofの接続は未完了。

## Notes

2026-09-10、媒体の指定browser受入: Chrome／Edge・1366／390px・100%／200%の8条件で画像対応・未対応・share除外・動画・形式fallbackの計40ケースがpassした。狭幅の画像拡大が実寸を変えない問題を修正し、原寸以上の表示、画像枠内の横／縦キー移動、縮小時のfit／focus復帰を確認した。別runにだけ一致候補が1件あるcaseも追加して拒否を確認。全体358 tests、最終acceptance:reports、offline pack:checkがpassし、[媒体受入記録](../spec/verification-reports/MEDIA-ACCEPTANCE-20260910.md)へscope・全sample・digest・途中結果を残した。native動画controlsの全pointer操作や実機再生の手動受入、容量全境界、fixed SHA／指定runtimeの受入はこの記録では完了扱いにしない。

2026-09-10、最大件数・指定browserの媒体なし受入: 専用`acceptance:reports`を追加し、100 run・履歴10,000件・failure 1,000件の均等／集中配置、Chrome／Edgeの1366／390px・100%／200%の16条件がpassした。初回に検出した195 CSS pxでの横overflowを修正し、回帰testを追加した。生成10 sampleの最大4,383.5ms、初期80 sampleの最大384.2ms、filterの各100 sampleのp95最大32.2ms。外部HTTP・page error 0件。全体356 testsとoffline pack:checkもpass。詳細とdigestは[測定記録](../spec/verification-reports/PERFORMANCE-20260910.md)を参照する。媒体操作の指定browser／zoom全組合せと容量全境界、固定SHAの受入は残る。以下の過去Notesにある最大corpus未検証の状態は本追記で更新する。

最大corpus受入の実装範囲を追加する。100 runへ均等配置する場合と1 runへ集中する場合の双方で、実行履歴10,000件・failure 1,000件を含む人工保存入力を使用する。専用commandに分離し、通常testへインストール済みChrome／Edgeや性能閾値を要求しない。測定条件はSPEC-01の「性能・browser受入の測定契約」に従う。実targetへ接続せず、実機の受入証跡とはしない。

2026-09-10実装追記: 履歴の「証跡を見る」から媒体を絞り込み、解除時に元の履歴buttonへfocusを戻す。findingでは当該項目と所属run全体を切り替え、run／worker／session概要では関連付け済み媒体も表示する。表示可能・除外件数と対応不明理由を表示し、一覧filterを維持する。実再生可能な人工WebMで、履歴選択による再生位置の巻戻りを検出・修正し、非表示／詳細close時の停止も確認した。指定Chrome／Edge build、200% zoomと最大corpusの受入は未完了のままである。

この実装後の全体353テストとoffline pack:checkがpassした（466file、50schema、`linkedMediaReport=true`）。新規8テストには人工archiveの参照検証、session／findingの対応、実PNG表示と実再生可能な人工WebMを含む。390px幅の媒体選択・解除、focus／filter維持、横overflowなし、外部HTTP request 0件を確認した。画像は`test-results/report-media-links-viewer--8825e-d-focus-restoration-offline/media-associations.png`。実結果とdigestは[Task 69](TASK.20260910-69.md)を参照する。

2026-09-10要件詳細化追記: 要件案0.1.3-draftの詳細画面操作とMEDIA-01〜06をTask 65の受入に含める。run全体と個別項目の証跡を区別し、関連付け済み媒体がrun一覧から消えないこと、履歴の選択／解除、filter／page維持、focus復帰を確認する。媒体対応の実装・UI test、最大corpus性能、指定browser受入の完了状態は変更しない。

- 配布tarballの独立install後にreport generate／verifyを実行し、5fileのtext-only bundleを確認した（pack:check exit 0）。必要な公開npm cacheをworkspace専用cacheへコピーしてofflineで検証。Node 24.11.0／npm 11.6.1のため、指定release runtimeとの差は残る。
- 探索run／resumeの自動生成を接続した。設定は開始前に解決し、stdoutを保ったままstderr通知／run外receiptを出す。正常終了、off、設定不備、出力失敗、pause前後の別ID／旧bundle不変を確認した。1 action後の再開で発見したpersonaRef引渡し漏れを修正し、0／1 actionの双方でresume passedを確認した。report-auto／Playwright adapter／coordinatorの関連26件、型、ESLintがpass。hash算法・厳格な照合条件を変更せず、観測traceにはoperator記録を保持する。
- 通常run／replayとworker batchの自動生成を接続した。run作成前に失敗した全worker、未成立manifest、既存不正manifest、seed／batch／outcome binding、重複集計、restricted非表示を確認するbatch 6件と、HTTP 200／500のrun・replay、batch再生成、全worker開始失敗、off／設定不備／出力失敗のruntime 5件がpass。生成前にprivate indexを別保存し、共通deadline内で検証してからbundleを作る。worker詳細から子run履歴を表示し、runがないworkerのseed／元statusも保持する。UI関連2件を含む7件、型、ESLintがpassした。
- full fixtureと実LLM fullは既にlibrary APIを使い、HTML自動生成を呼ばないことを確認した。CLI childを追加する場合の`--report off`要件は維持する。録画offの既存設定も維持した。
- 単一の未確定runの最小診断を実装した。操作前に選択fieldだけの開始記録を排他的に保存し、衝突時はtarget接続0件を維持する。元CLIはartifact failureを返したまま、HTMLは「結果未確定」と件数未取得を表示する。開始記録のdigestをHATEと区別し、既存の正常なrun内junctionは従来のstrict readerで検証する。新規7件を含む関連14件と型・ESLintがpassした。
- batchの壊れたmanifest保存directoryを不存在扱いにする不整合も修正した。batch／単一runで不存在検査を共用し、生成後の再検証でも拒否する。未確定run画面の「確定した実行結果なし」、seed、件数未取得、媒体非表示理由、開始記録digest、外部request 0件を含む2件がpassし、スクリーンショットも確認した。
- 署名済み媒体proofをstandalone／自動生成のreport設定へ接続した。検証に使ったattestation／署名payload／trust store／policy／targetのdigestを媒体の折りたたみ詳細へ表示し、raw key IDやPEMは出力しない。実PNGの同梱、画面表示、詳細展開、外部HTTP request 0件をPlaywrightで確認した。対応スクリーンショットは`test-results/report-signed-media-genera-6da8b--rejects-retained-raw-bytes/signed-media-proof.png`。これはfixture UI確認であり、指定Chrome／Edge buildの受入とは別である。
- receiptはstageへの書込み完了後に最終file名を排他的に公開する。write失敗／abortの途中JSONが最終名に残らないことを2テストで確認し、standaloneも保存終了まで共通deadlineを渡すようにした。
- この段階ではrecordと媒体の関連付け、最大corpus性能・指定browser受入が残っていた。対応付けの後続実装は上の実装追記を参照する。
- batchの1366×768／390px表示をスクリーンショットで確認し、横overflowがないこと、workerの詳細と履歴、batch index digest表示を確認した。Playwright Chromiumのfixture検証であり、指定Chrome／Edge実buildの受入は別途必要。全体326 testsと独立install後の通常／batch report生成・検証はpassし、[Task 69](TASK.20260910-69.md)へ記録した。
- 単一run診断の接続後、全体334 tests、型・lint・buildがpass。独立installの検査へ開始記録だけのfixtureを追加し、generateのexit 2／degraded、verifyのexit 0、確定run 0／未確定run 1、outcome全件0を確認した。offline pack:checkもpassし、`incompleteReport=true`を記録した（445file、50schema）。
- 署名済み媒体・receipt修正後の全体345テスト、型・lint・buildとoffline pack:checkがpass。隔離install側のCollector／HATE exporterで署名済み人工PNGを確定し、共有reportの生成・verify、媒体1件・6file bundleを確認した。`signedMediaReport=true`、457file・50schema。最終logとdigestは[Task 69](TASK.20260910-69.md)を参照する。

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。
