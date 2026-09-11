---
document_id: LAKDA-CHK-UP-001
status: review-ready
version: 0.1.6-draft
last_updated: 2026-09-11
requirements: 20260910-detailed-requirements.md
report_detail: 20260910-report-detail.md
---

# 改修詳細要件の受入・トレーサビリティ

[全体要件](20260910-detailed-requirements.md)と[レポート詳細](20260910-report-detail.md)の正本チェックリスト。本書はAC全体の期待結果と必要証跡を定義する。未チェックはAC全体の受入未確定を表し、個別の実装・ローカル試験の有無を表さない。進捗と個別の実結果は[仕様索引から辿るTaskのEvidence](../spec/verification-reports/README.md)を参照する。M1ローカル完了とM3実環境・外部Gate完了を区別する。

## 1. 要件と受入の対応

| 受入ID | 対象 | 要件ID | 段階 |
|---|---|---|---|
| AC-UP-001 | Python bridgeの動作 | REQ-UP-BRG-001、REQ-UP-BRG-002、REQ-UP-BRG-003 | M1 |
| AC-UP-002 | Python CIと依存再現性 | REQ-UP-BRG-004、REQ-UP-BRG-005、REQ-UP-BRG-006 | M1 |
| AC-UP-003 | 検査要求と受渡し | REQ-UP-ATT-001、REQ-UP-ATT-002 | M2 |
| AC-UP-004 | 署名と出力媒体照合 | REQ-UP-ATT-003、REQ-UP-ATT-004 | M2 |
| AC-UP-005 | 検査待機・停止・再投入 | REQ-UP-ATT-005、REQ-UP-ATT-006、REQ-UP-ATT-007 | M2 |
| AC-UP-006 | 固定revisionとTask状態 | REQ-UP-EVD-001、REQ-UP-EVD-002、REQ-UP-EVD-003、REQ-UP-EVD-005、REQ-UP-COM-002 | M1/M3 |
| AC-UP-007 | Legacy P6履歴化 | REQ-UP-LEG-001、REQ-UP-LEG-002、REQ-UP-LEG-003 | M1 |
| AC-UP-008 | 実機identity | REQ-UP-IDN-001、REQ-UP-IDN-002、REQ-UP-IDN-003、REQ-UP-IDN-004、REQ-UP-IDN-005、REQ-UP-COM-004 | M2 |
| AC-UP-009 | catalog分割の互換性 | REQ-UP-MOD-001、REQ-UP-MOD-003、REQ-UP-COM-001 | M1 |
| AC-UP-010 | 文書checkerと対応検査 | REQ-UP-MOD-002、REQ-UP-MOD-004、REQ-UP-COM-004 | M1 |
| AC-UP-011 | report入力とCLI互換 | REQ-UP-RPT-001、REQ-UP-RPT-003、REQ-UP-COM-001 | M1 |
| AC-UP-012 | 自動生成と終了code | REQ-UP-RPT-002、REQ-UP-RPT-004 | M1 |
| AC-UP-013 | 保存・再生成・bundle verify | REQ-UP-RPT-005、REQ-UP-RPT-016 | M1 |
| AC-UP-014 | 概要・集計・絞り込み | REQ-UP-RPT-006、REQ-UP-RPT-007、REQ-UP-RPT-008、REQ-UP-RPT-009 | M1 |
| AC-UP-015 | 履歴と媒体 | REQ-UP-RPT-010、REQ-UP-RPT-018 | M1 |
| AC-UP-016 | coverage表示 | REQ-UP-RPT-011 | M1 |
| AC-UP-017 | 欠損・不整合・実行中入力 | REQ-UP-RPT-012、REQ-UP-RPT-013 | M1 |
| AC-UP-018 | profile・機密・入力文字 | REQ-UP-RPT-014、REQ-UP-RPT-017、REQ-UP-COM-003 | M1 |
| AC-UP-019 | offlineと容量・性能 | REQ-UP-RPT-015、REQ-UP-RPT-019 | M1 |
| AC-UP-020 | 操作性と人間の確認 | REQ-UP-RPT-020、REQ-UP-RPT-021 | M1 |
| AC-UP-021 | packageと回帰接続 | REQ-UP-RPT-021、REQ-UP-COM-004 | M1 |
| AC-UP-022 | 実環境と外部Gate | REQ-UP-EVD-004、REQ-UP-ATT-007、REQ-UP-IDN-005、REQ-UP-COM-002、REQ-UP-COM-003 | M3 |

後続ShouldのREQ-UP-RPT-022（比較・対話graph）とREQ-UP-RPT-023（AI要約・追加export・開発suite集約）はM1必須ACの対象外。2026-09-11のユーザー指示により、これらとレポート履歴管理は保留し、自動的に着手しない。改めて採用した場合に独立受入を追加し、未実装をM1不合格または実装済みと表現しない。今回の仕上げは、終了後のHTMLで概要・失敗理由・保存済み画像や動画を確認する基本操作を中心に検証する。

## 2. 受入チェックリスト

### AC-UP-001：Python bridgeの動作

- [ ] fixture deviceで開始→停止／破棄、二重開始、未開始停止、mode違い、0 frame、backend error、停止timeout、frame／byte上限の前後を実行する。正常は宣言した媒体と実bytesが一致し、異常は成功扱い0件、samplerの残留を検出する。HTTP入出力とstaging参照も実handlerで検証する。
- 証跡: Python test結果、case一覧、timeout／counter記録。
- 実結果: 未実施。

### AC-UP-002：Python CIと依存再現性

- [ ] Windows CIで実Pythonの構文・動作試験を実行し、全skipを拒否する。実機対応を宣言するmatrixの各環境でclean venvからlock install・import・依存整合を再現し、解決済みversion／hashを固定する。未検証の組合せは対応外と明記する。
- [ ] 全体要件6.1の結果表を照合する。0件・全skip・全expected failure・unexpected successを合格とせず、module／classの初期化・後始末errorを所属付きで記録する。複数subtestの失敗と後続skipを含め、実行開始case数、結果record数、JSON／JUnitの結果・件数が一致する。出力不能時は保存済みと通知しない。
- [ ] lockに一致する環境、package欠落、version差、同名distributionの曖昧さ、解釈不能lock、import失敗を照合する。vendored distributionによる誤判定を防ぎ、lockのdigest記録とimport成功だけで依存整合を合格にしない。install時の配布物hash検証と導入version照合を別に記録する。
- 証跡: CI結果、JUnit等、環境matrix、lock digest、運用手順。
- 実結果: 未実施。

### AC-UP-003：検査要求と受渡し

- [ ] 停止済み媒体だけからrequestを作り、正常応答は1回受領する。未確定bytes、途中書込、別run／policy、重複競合、期限後応答を拒否する。scanner自動起動・外部接続0件を確認する。
- 証跡: request／responseのfixture、受領event、I/O監査。
- 実結果: 未実施。

### AC-UP-004：署名と出力媒体照合

- [ ] 許可key・request binding・source／output bytes一致の場合だけ受理する。未知key、署名不一致、別request、scan不合格、output差替えを拒否し、マスク済みoutput採用時にraw sourceのHATE登録が0件である。旧v1読取と新契約への非昇格も確認する。
- 証跡: 署名fixture、digest照合結果、HATE manifest。
- 実結果: 未実施。

### AC-UP-005：検査待機・停止・再投入

- [ ] 待機1／30／300秒と範囲外を検証し、stop要求を1秒以内に反映する。期限後応答でfinalized runが変わらず、別bundleを使い、同一request再投入が二重処理されない。capture失敗と検査失敗のreasonが区別される。
- [ ] 全体要件7.1の各停止位置を確認する。媒体一覧作成から採用まで期限を共有し、隔離開始前・隔離途中・再読取・診断保存の停止で元媒体とprivateコピーを保持する。署名受領と採用を別記録にし、診断保存の時間を新たな媒体採用へ流用しない。1秒の測定には環境・媒体量・停止位置と反映時刻を添える。
- [ ] size等の変更が観測できる場合と、同じsize・時刻でも内容が更新される場合を別に検証する。更新後の元媒体の消失0件を確認し、前者だけの成功で不変性を合格にしない。停止や保存途中の失敗を正常HATE確定として扱わない。
- 証跡: clock／stop計測、前後hash、派生bundle、reason一覧。
- 実結果: 未実施。

### AC-UP-006：固定revisionとTask状態

- [ ] 固定SHAの必要Gate結果とartifact digestを記録し、dirty結果を正式証跡へ流用しない。Task 59／60のlocal完了と外部blockerを照合する。M1後のsource変更でM3が旧SHAを流用せず、過去recordのbytes変更0件を確認する。
- 証跡: Acceptance Record、Task差分、Gate一覧、digest。
- 実結果: 未実施。

### AC-UP-007：Legacy P6履歴化

- [ ] 旧workflowが実行対象から外れ、元revisionと内容を履歴から辿れる。現行導線はcurrent profile経由だけとなり、live workflowの過去RC固定検査が0件。過去release／artifactは保持される。
- 証跡: workflow差分、文書link検査、履歴参照。
- 実結果: 未実施。

### AC-UP-008：実機identity

- [ ] platformごとに実観測と宣言を別記録し、CLI echoを観測済みとしない。初回／resume時に別app・端末・build、観測期限切れ、再接続、取得不能を拒否し操作0件を確認する。1／60／300秒の期限と新旧schemaの扱い、raw識別値非出力を検証する。
- 証跡: fixture契約、platform別実観測record、操作counter、scan。
- 実結果: 未実施。

### AC-UP-009：catalog分割の互換性

- [ ] 既存正常／異常corpusを分割前後で処理し、canonical比較bytes、list順序／上限、export、終了codeが一致する。改竄と未知versionの拒否も一致し、report readerが同じ検証境界を使う。
- 証跡: characterisation結果、golden比較、module依存図。
- 実結果: 未実施。

### AC-UP-010：文書checkerと対応検査

- [ ] 各checkerを独立fixtureで実行する。正常文書を受理し、broken link、schema欠落、profile不一致、Birdseye不整合、孤立要件、受入対応漏れを検出する。既存文書corpusの判定を維持する。
- 証跡: checker test、要件対応一覧、既存check:docs結果。
- 実結果: 未実施。

### AC-UP-011：report入力とCLI互換

- [ ] 5 mode、worker batch、session、複数入力で生成する。source数0／1／100／101、重複同一digest・競合digest、排他的入力併用、未知optionを検証する。batchのrun未作成worker errorを保持し、既存report leads／explore reportの出力を変えない。
- 証跡: CLI契約test、mode matrix、source-index fixture。
- 実結果: 未実施。

### AC-UP-012：自動生成と終了code

- [ ] passed／failed／partial／errorの終了後とsession pause／abort／resume後に所定bundleを生成する。off／ライブラリAPI／要求送信CLIでは生成0件。生成失敗時も元stdoutとexitを維持し、standaloneの0／1／2はreport状態に一致する。
- 証跡: stdout bytes／exit比較、receipt、生成数。
- 実結果: 未実施。

### AC-UP-013：保存・再生成・bundle verify

- [ ] 別directoryへatomic生成し、入力と既存reportの変更0件を確認する。同じ入力の再生成でprojection・順序が一致し、generation情報だけの差を許容する。view model／HTML埋込値一致、全file列挙、出力差替えをverifyで検出する。
- 証跡: 前後hash、bundle manifest、receipt、verify結果。
- 実結果: 未実施。

### AC-UP-014：概要・集計・絞り込み

- [ ] 人工的な混合結果で確定run／結果未確定run／worker／failure／finding／action各件数が元データと一致する。未確定runをpassed等へ加算せず、その未取得件数を0件と表示しない。状態・mode・platform・severity・keywordのAND条件、解除、0件、同時刻の安定順を確認し、未確認findingをdefectに昇格しない。
- 証跡: 集計oracle、UI test、画面確認record。
- 実結果: 未実施。

### AC-UP-015：履歴と媒体

- [ ] action対応あり／なしの画像・動画・frames、媒体未取得、保持対象外、非対応codecを表示する。対応がない媒体を任意actionへ結び付けず、再撮影・再録画・transcode 0件、autoplay 0件。traceは所定profileの案内だけとなる。
- [ ] レポート詳細3.2〜3.3のMEDIA-01〜06を照合する。完全参照とHATE IDの解決、adapter IDとHATE IDの相違、同一画像への複数参照、無関係run・曖昧参照・未保持・非媒体・restricted・profile除外を確認する。path／size／SHA-256不一致は入力拒否となり、対応と共有適格性を混同しない。
- [ ] runの媒体一覧に項目対応済みの媒体も残り、履歴の選択／解除とfindingからの表示が一致する。保存後のview検証では双方向参照とsource／runの所属を照合し、片側だけの関連や無関係runへの関連を拒否する。
- [ ] レポート詳細3.4の表示を照合し、保持設定、profile除外、検査・採用の失敗、対応未確認、再生不可を区別する。根拠のない理由の補完、private媒体の取込み、代替画像の割当てを行わない。元証跡の不整合はAC-UP-017の入力拒否として確認する。
- 証跡: 媒体fixture、UI test、通信／process／保存確認。
- 実結果: 未実施。

### AC-UP-016：coverage表示

- [ ] 分子・分母・範囲を元artifactと照合する。分母0、非対応mode、未取得、定義の異なる複数runを含め、NaN／架空の100%／異なる分母の平均が0件である。
- 証跡: coverage fixture、期待値比較、画面確認。
- 実結果: 未実施。

### AC-UP-017：欠損・不整合・実行中入力

- [ ] 有効な開始記録だけを持つrunをlocal最小診断／share拒否にする。「結果未確定」と表示し、実行中／異常終了を断定せず、終了時刻・停止理由・合否・件数を推定しない。開始記録もないrun、開始記録不正、既存manifest不正を診断成功にしない。
- [ ] 開始記録の生成中更新、manifestの後発作成、run directoryの差替え、hash・run binding・event chain不一致、未知version、参照逸脱、実行中sessionでは成功HTMLを生成しない。開始記録を持たない旧確定runは従来のHATE検証で受理できる。
- [ ] 未確定runの未検証metadata・failure・媒体は表示に使用せず、元artifact修復と不正sourceの黙示除外は0件である。
- 証跡: negative corpus、状態／exit比較、元hash。
- 実結果: 未実施。

### AC-UP-018：profile・機密・入力文字

- [ ] localとshareで未検査媒体・検証済み媒体・restrictedの規則を確認する。人工的な秘密値・特殊文字を含むmessage／URLを安全に処理し、実行可能入力やraw認証状態の混入0件。区分の引下げとQEG verdict生成0件を確認する。
- 証跡: profile matrix、scan、UI test、manifest。
- 実結果: 未実施。

### AC-UP-019：offlineと容量・性能

- [ ] bundleを別pathへ移しnetwork無効で操作する。外部request 0件。10,000／10,001 event、1,000／1,001 finding、各MiB／GiB制限の直前・同値・超過を検証する。基準corpusで生成5回・初期描画・filter p95を測定し、本書の目標とtimeoutを判定する。
- 証跡: 機器条件、全計測値、networkログ、境界test。
- 実結果: 未実施。

### AC-UP-020：操作性と人間の確認

- [ ] Chrome／Edgeの1366×768と幅390px、100%／200% zoom、キーボードのみで主要flowを確認する。色以外のラベル、focus復帰、長文、timezone切替、0件表示を確認する。fixture上のUI確認として記録し、実target受入と区別する。
- [ ] レポート詳細3.3とMEDIA-02／06に従い、履歴の媒体選択・解除、画像拡大、詳細を閉じた後のfocus・filter・page維持、再度開いた際の選択初期化を確認する。動画の自動再生・根拠のないseekは0件とする。
- 証跡: browser build、スクリーンショット、確認者・日時・case結果。
- 実結果: 未実施。

### AC-UP-021：packageと回帰接続

- [ ] 隔離installからreport CLIを実行し、renderer assets・schemaが揃い生成とverifyが成功する。必要testをprofileへ接続し、元CLI／JSON／capture方針が回帰しない。report packageに実証跡や秘密値が混入しない。
- 証跡: pack:check、隔離install、契約回帰、package scan。
- 実結果: 未実施。

### AC-UP-022：実環境と外部Gate

- [ ] 固定SHAのscopeに従いPC Web／mobile Web／Windows／Android実機／iOS実機、P7／P11、実Qwen、manual-bb、外部QEGを照合する。実機媒体の検査と人間の確認を含め、未取得laneはpending_externalのままとする。
- 証跡: lane別real record、HATE、manual-bb、外部QEG参照。
- 実結果: 未実施。

## 3. 実装開始前・完了時の確認

- [x] 7件の改修を要件IDへ展開し、初期版と後続を分けた。
- [x] reportの画面、CLI、状態、媒体、保存、性能上限を提案契約として記述した。
- [x] 利用シナリオを既存ACへ対応付け、未確定runの表示・集計・拒否条件を明示した。
- [x] 段階ごとの成果物・完了条件と、人工入力による表示例を既存ACに対応付けた。
- [x] report設定のfile名・field・相対pathの基準・未指定時の動作を実装仕様と一致させた。
- [x] 項目と媒体の参照解決、対応不明時の扱い、詳細を開いて戻る操作を既存ACの受入例へ展開した。
- [x] 媒体が表示されない理由と、検査・保存途中の停止時に保全するものを既存要件・ACへ対応付けた。
- [x] 実機・依存matrix・scanner・性能基準機など外部条件を明示した。
- [ ] 変更対象と必要schema versionを実装Task Seedへ固定した。
- [ ] 対象ACすべての実結果・command・終了code・証跡digestを記録した。
- [ ] 実装後SHA、worktree状態、環境、未実施項目をAcceptance Recordへ固定した。
- [ ] 未取得の実機・manual-bb・QEGをpending_externalとして維持した。

## 4. 検証recordの最低項目

subject SHA、worktree状態、AC ID、case ID、fixture／real資格、環境／runtime version、実行command、開始・終了日時、exit code、実行数／skip／失敗数、期待結果と実結果、artifact相対参照・SHA-256、確認者、残留blockerを記録する。性能値は全測定結果と基準機を添え、人間の確認は確認した画面・操作と対象revisionを記録する。

## 5. 文書だけの検証

要件詳細化ではcheck:docs、差分のwhitespace、要件IDの定義一意性、MustのAC対応、AC見出しの対応、相互参照を検査する。文書の検査結果からruntimeのAC合格を主張しない。

2026-09-10、要件案`0.1.1-draft`の確認結果:

- `npm run check:docs`: exit 0、`docs contract: pass`。
- 要件定義の独立集計: 全57件、Must 55件、Should 2件。定義IDの重複0件、AC 22件と見出しが一致。
- 利用シナリオ6件のAC参照: 未定義参照0件。
- 変更した文書3件の末尾空白検査、および`git diff --check`: exit 0。
- 今回の確認対象は文書であり、runtime・性能・実機の受入試験は実行していない。

2026-09-10、要件案`0.1.2-draft`の確認結果:

- 段階別の成果物・完了条件、人工入力による表示例6件を追記した。新規機能要件を追加せず、全57件（Must 55件、Should 2件）とAC 22件を維持した。
- report設定の記述をSPEC-01の`lakda.report.json`、`lakda/report-config/v1`、path解決規則に揃えた。
- `npm run check:docs`: exit 0、`docs contract: pass`。
- 独立集計: 重複要件0件、Mustの未対応AC 0件、未定義要件・AC参照0件。利用シナリオ6件・表示例6件の参照を照合した。
- 変更文書3件の相対file参照・末尾空白検査と`git -c core.safecrlf=false diff --check`: exit 0。
- 今回は要件文書3件の更新であり、既存の実装進捗・runtime試験・性能・実機受入の状態を変更しない。

2026-09-10、要件案`0.1.3-draft`の確認結果:

- 履歴・findingと媒体の対応、対応未確認・非媒体・restricted・除外の扱い、詳細画面の操作を具体化した。MEDIA-01〜06を既存のAC-UP-015／020へ追加した。
- 全57要件（Must 55件、Should 2件）とAC 22件を維持。独立集計で重複要件、Mustの未対応、未定義要件・AC参照はいずれも0件。媒体表示例6件のIDは一意。
- 要件3文書、SPEC-01、対応checklist、セルフレビュー、Task 64／65の計8文書について、相対file参照・末尾空白を検査し問題0件。
- `npm run check:docs`: exit 0、`docs contract: pass`。`git -c core.safecrlf=false diff --check`: exit 0。
- この追記は文書検証の記録であり、媒体対応機能・性能・実機受入の試験結果ではない。実装と試験はTask 64／65で継続する。

2026-09-10、要件案`0.1.4-draft`の確認結果:

- Python検証の完了条件を具体化し、fixtureの初期化・後始末error、expected failure、unexpected success、subtest、0件・全skipの記録と判定をAC-UP-002へ対応付けた。
- lockと導入versionの照合、vendored distributionとの区別、import-only証跡の扱いを明記した。対応するSPEC-02とChecklist 02も更新した。
- 初期HTMLの対象をLakdaの実行結果とする提案を維持し、Pythonの開発用JSON／JUnitとの入力・集計境界を明記した。
- 独立集計: 全57要件（Must 55件、Should 2件）、AC 22件。重複要件・Mustの対応漏れ・未定義参照0件。変更文書5件の相対file参照・末尾空白に問題0件。
- `npm run check:docs`: exit 0、`docs contract: pass`。要件詳細化の検証であり、追加した受入条件についてruntimeの合格や実機対応を主張しない。

2026-09-10、要件案`0.1.5-draft`の確認結果:

- 全体要件7.1へ撮影停止未確認、一覧作成の期限、隔離途中、署名受領後の採用失敗、診断保存、期限後応答、元媒体更新の完了条件を追記した。停止の反映時間と診断保存の完了時間を区別した。
- レポート詳細3.4へ画像・動画の非表示理由と表示例を追加し、AC-UP-015／017／018へ対応付けた。元テストの結果とレポートの生成状態を区別した。
- セルフレビューで、署名受領だけで媒体採用を成功にしないこと、観測可能なsize変更の検出だけで全媒体の保全を合格にしないこと、未確定runのprivate媒体を表示しないことを確認した。
- 独立集計: 全57要件（Must 55件、Should 2件）、AC 22件。定義の重複、Mustの対応漏れ、未定義要件・AC参照、変更3文書の末尾空白はいずれも0件。相対file参照22件の不存在0件。
- `npm run check:docs`: exit 0、`docs contract: pass`。`git diff --check`: exit 0。
- 今回の更新と検証は要件文書3件に限定した。開発用suite集約は後続という提案上の既定値を維持する。実装・性能・実機受入の合格や、全7件の実装承認をこの記録から主張しない。
