---
document_id: LAKDA-SPEC-UP-001
status: implementation-ready
version: 0.1.7
last_updated: 2026-09-11
requirements: ../../proposals/20260910-detailed-requirements.md
checklist: CHECKLIST-01-REPORTING.md
---

# SPEC-01 レポート生成・表示・検証

対応[checklist](CHECKLIST-01-REPORTING.md)。実装対象はREQ-UP-RPT-001〜021とREQ-UP-COM-001〜004。REQ-UP-RPT-022〜023とレポート履歴管理は、2026-09-11のユーザー指示により保留する。今回の仕上げは結果の概要・失敗理由・保存済み画像や動画の閲覧と安定性に絞る。[report詳細](../../proposals/20260910-report-detail.md)の画面、入力、state table、数値上限は本仕様の規範入力であり、ここで実装境界と未決だったI/Oを固定する。

## Objective

保存済みのrun／worker batch／sessionから、人間が操作して確認できるoffline HTMLを生成する。対象操作・元結果・manifestの意味は変更しない。

## Public I/O

### 表示言語

2026-09-11の追加指示により、HTMLの見出し・説明・操作ラベルを日本語／英語から選べるようにする。既定は`ja`。`run`／`replay`／`explore run`／`explore resume`／`report generate`の`--report-language ja|en`、または`lakda.report.json`の任意field `language`で指定し、CLI＞設定＞`ja`の順に決める。未知値・空値・重複指定は実行や生成前に拒否する。

選択言語は新規`report-data.json`の任意field `language`へ記録し、HTMLの`lang`、title、初期文面、viewerの表示に適用する。旧viewで未指定の場合は従来の日本語HTMLを保持し、旧bundleの検証を維持する。テスト由来のmessage、title、履歴、ID、コード、digestは原文のまま表示し、翻訳サービスや外部通信を使用しない。CLIの機械可読JSON、結果判定、元の保存記録の意味は言語で変更しない。

画面内の追加切替UIは設けず、出力時に選択する。日本語と英語の両方が必要な場合は、保存済み結果を別の出力先へ再生成する。

追加commandは `report generate` と `report verify`。引数と0／1／2終了codeはreport詳細に従う。command別allowlistでflagを検証し、単一指定flagの重複と相互排他的入力併用を拒否する。既存commandのflag処理は互換を保持する。

standalone generateのreceiptはstdoutへ1 objectを出し、書込可能なら出力directoryの親へ`<reportId>.receipt.json`として保存する。receiptの`output`はこの親からの相対参照である。入力と重なる保存先や未解決入力の場合は、入力への書込を避けてstdout receiptを維持する。verifyのstdoutは`valid`、`scope=report-bundle-files`、成功時のreport ID／manifest digest／file件数／bytes、失敗時のissueを返す。verifyのdeadlineは120秒とし、I/Oの終了を待ってから応答する。

CLI専用設定はcwdの `lakda.report.json`、明示指定は `--report-config <file>`。既定fileがない場合は既定値を使い、明示file欠落は入力errorとする。これは `lakda.config.json` と独立し、Charter/config署名payloadへ含めない。

`lakda/report-config/v1` は `schemaVersion`、`auto=html|off`、`outputRoot`、`profile=local|share`、`language=ja|en`、`timeoutMs`、任意の `trustStorePath` を持つ。未知fieldを拒否。language未指定は`ja`。timeoutは10,000〜600,000、既定120,000。outputRoot既定はcwdの `.lakda/reports`。設定fileの相対pathはそのfile基準、CLI pathはcwd基準。CLI明示＞設定＞既定の順に解決する。

設定解決はtarget接続前に行う。実行開始前のreport設定errorでtargetを動かさない。実行後の生成失敗は原結果stdout／exitを維持し、stderrとrun外receiptへ記録する。library APIは生成しない。

## Components and ownership

自動生成のstderr通知は`report`（生成receipt object）、`directory`（完成時のbundle directory、失敗時null）、`receiptPath`（保存できたreceipt file、未保存時null）、`sourcesPath`（保存できたprivate batch index、それ以外はnull）を持つJSONとする。通知の絶対pathはローカルCLI上の案内だけに使い、portable bundleには含めない。

| module境界 | 責務 | 禁止する依存 |
|---|---|---|
| report config／command | command引数、設定、終了code、通知 | Executor、target操作 |
| shared run reader | schema、path、size／digest、run bindingの照合 | manifest再生成、元artifact修復 |
| report source loader | 単一／集合／batch／session snapshotの正規化 | 実行中sessionの読取継続、scan不明の成功扱い |
| view model builder | 許可field選択、redaction、counts、安定順 | raw JSON／raw HTMLの丸ごと転記 |
| media policy | local／share、分類、attestation、コピー可否 | 分類引下げ、capture再取得 |
| renderer | HTML／CSS／JS、filter、detail、timeline | network、eval、process起動 |
| bundle writer／verifier | bounded streaming、atomic publish、manifest | 入力dir書込、既存出力上書き |

catalogの既存検証をstreamingの共通readerへ分割する。textだけを指定上限まで保持し、mediaはdigest・size・pathのhandleとして扱う。source pathは検証して終わらず、コピー時にも同じdigest／sizeを検査する。symlink／junctionによるroot逸脱を全pathで拒否する。

共通readerのintegrity検証とmedia公開policyは独立させる。catalogは現在の「redaction完了、scan適格」という既定policyを維持する。local reportはbinaryに限るpending表示条件を専用policyとして適用し、schema・参照・bytes検査を省略しない。shareは検査済み媒体だけを採用する。

sessionの参照runは、保存済みrun manifest copyとeventのrun ID／相対directoryを根拠に解決する。まず明示source内のrun ID＋attempt＋manifest digestを照合し、ない場合だけ既存runtimeと同じCharter outputDir（相対指定は生成commandのcwd基準）の保存先を使う。移動済みarchiveは参照runも明示sourceへ含める。directory名からrun IDを推測したり、周辺directoryを走査して候補を選んだりしない。copyと実runのmanifest digest、実artifactを再照合する。

明示source件数と、sessionから展開した参照run件数を別に数える。source重複はIDとmanifest digestで判定するが、別pathにあるcopyも実bytesを検証する。同一IDで異なる内容は入力競合とする。failure／findingも所属sourceとIDで重複除去し、同じIDで異なる内容は拒否する。出力直前にはsource index、全入力manifest／artifact、sessionの更新lockを再確認する。

## Generation transaction

### 最終manifestがない単一runの診断

新規runはCollector作成時、targetへの初回接続より前に`run-start.json`（`lakda/run-start/v1`）を排他的に保存する。保存項目はrun ID／attempt、開始UTC、mode、seed、worker index、任意batch ID、producer version／revision、機密区分だけとする。URL、persona、端末識別値、環境変数、入力値、raw errorを含めない。開始記録の保存に失敗した場合はtargetへ進まない。完成runでは通常のartifact policy／HATEへ含め、metadataとの対応も検証する。

最終manifestの不存在を確認でき、開始記録のschema・日時・公開field・bytes照合が成立するときだけ、localで最小診断をdegradedとして生成する。開始記録だけでは実行中と異常終了を区別できないため、状態は「結果未確定」とし、合否・終了時刻・停止理由・実行action数・failure数を推定しない。未検証のmetadata、failure、trace、媒体を読み込まない。開始記録もない場合はrun IDをdirectory名から推測せず入力不足で拒否する。shareは未確定runを含む入力を拒否する。

既存manifestが不正、directory、壊れたlinkなどの場合は最小診断へ切り替えない。生成の最後に開始記録の同一bytes、run directoryの同一性、manifestの不存在を再検証し、更新があれば公開しない。開始記録のSHA-256は`startRecordSha256`へ保持し、HATE manifestのdigestとは区別する。viewの`incompleteRuns`と`counts.incompleteRuns`は診断がある場合だけ追加し、従来の`runs`とoutcome件数には含めない。restrictedはopaque sourceと取扱い理由だけを表示する。

### Worker batchの入力契約

batch再生成には`--sources`でprivateな`lakda/report-batch-sources/v1`を渡す。公開run／session集合の`lakda/report-sources/v1`とは別versionで、`batchId`、結果の`recordedAt`、保存root、機密区分、元のoutcome／exit、requested／completed worker件数、worker配列を持つ。worker indexは0始まりで欠番・重複を拒否し、件数と元batch outcomeの再集計が一致することを要求する。現行CLIのworker上限4を使う。

completed workerはseed、run ID／attempt、root内相対directory、outcome／exit／terminationReason、確定済みHATEのSHA-256を持つ。readerは実HATEとmetadataのbatch ID／worker index／seed／run ID／attempt／outcome／exitを照合する。先にworkerが失敗した場合はstatus=errorとsanitized errorだけを保存し、runを推定しない。finalization失敗でHATEが成立しないcompleted workerは、元error結果とnull digestだけを記録する。存在する不正manifestの救済には使わず、localで最小worker診断をdegradedとして表示し、shareは入力拒否とする。

private indexはrun外の専用directoryへ排他的に保存し、生成直前にindex bytesも再照合する。入力に重なる保存先へは書かない。再生成時に別保存先へ移す場合はindexのrootを明示的に更新する。portable bundleにはprivate pathを含めず、batch sourceの`indexSha256`とworker summaryだけを持つ。`manifestSha256`へprivate indexのhashを代入しない。

自動生成ではreport出力rootの`sources-<UUID>/sources.json`へprivate indexを保存し、bundleは別の`report-<UUID>/`へ保存する。index作成・入力照合・bundle生成・receipt保存に共通deadlineを適用する。全workerがrun作成前に失敗した場合は、run保存rootの不存在やfile衝突を診断生成の妨げにせず、元のworker errorだけを表示する。runを新規作成せず、存在するfileも変更しない。

viewにはbatch入力時だけ`batches`を追加し、requested／completed、worker index／seed／元status／run keyを保持する。batchは明示source 1件、子runはrun件数で数える。worker行とrun行を二重にrun数へ加算しない。元worker errorまたはrun未成立はworker未完了数へ数え、run結果のpassed／failed等とは別表示にする。restricted batchはopaqueなsourceと理由だけを表示する。通常run／replay／batchのCLIがtargetを操作する前にreport設定を解決し、生成処理は結果stdoutの後に1回だけ実行する。

### 共通生成手順

1. 入力selector／設定／出力pathをpreflight。出力先が入力と同一・祖先・子孫なら拒否する。
2. private source indexを読み、source IDsとdigestで正規化する。
3. finalized snapshotを検証し、source manifest digestとsession event headを固定する。session readerは既存の書込関数 `buildExplorationReport` を呼ばない。
4. view modelを構築し、scan・件数・容量上限を検証する。
5. 出力root内の専用temporary directoryへrendererと許可mediaを生成する。
6. コピー後hash、source snapshotの更新有無、全output manifestを検査してatomic publish。
7. bundle外receiptへmanifest digestを書き、通知する。

全I/Oに共通AbortSignalとdeadlineを渡す。timeout後にwrite／copy／renameが続く単純なPromise.raceは禁止。中止はpending処理を終了させてからreceiptを返す。大きなfileのhash／copyはstreamingを使う。

同時生成はreport ID別temporary directoryと出力先占有で区別する。既存dirには書かない。receipt保存も失敗した場合はstderrへ最小情報を出す。完成していないHTMLを成功pathで返さない。

receiptも専用作業directoryへ書込みを完了してから、最終file名を排他的に公開する。途中のwrite失敗やabortでは不完全なJSONを最終名へ残さない。同一volume上のhard linkで上書きなしのfile公開を行い、対応しないfilesystemでは保存失敗として扱う。既存fileへの上書きfallbackは行わない。親／作業directoryの同一性を確認し、自分が作ったstageと予約だけを後処理する。

### 署名済み媒体の読取

既存v1 attestationの判定は、HATEでbytesを確認した`attestations/binary-artifacts.jsonl`と媒体snapshot、report設定のoperator trust storeから行う。run metadata／Charter内のtrust store pathや、未署名の許可key一覧をtrustの根拠にしない。reportはfile読取のある従来APIを再呼出しせず、同じpayload・署名・保持先判定を使うsnapshot検証関数へ渡す。元v1の署名形式を変更しない。

trust storeは128 KiB・1〜64 keyを条件として共通deadline内に読取り、key IDの重複・制御文字や不正な公開鍵を拒否する。既存の配列形式と`keys`形式を受理し、未知fieldを拒否する。keyはEd25519の公開鍵PEMだけを受理し、秘密鍵PEMを公開鍵へ暗黙変換しない。保存先はreport設定file基準とし、生成直前にも同一path／bytesを再照合する。元入力の容量上限に加算し、reportの出力やreceiptがこのfileを上書きする配置を拒否する。

real sessionでは、HATEに固定されたtarget manifestをsessionのdigest、Charter／config、観測capability／bridgeと照合し、operator trust storeで署名検証したattestor key一覧を使う。既存の受入verifierと同じ開始eventの時刻で保存時点の条件を検証し、現在のtarget操作を許可したとは表現しない。adaptive runの共有媒体には、明示入力のsessionとそのrun参照を経由した対象の証明を必要とする。対象の証明がないrunを未署名metadataのkey一覧だけで検証済みにしない。

trust設定やproofがない媒体は従来どおり未検査として扱う。提示されたproofの署名・対応・policyを確認できない場合も検証済みへ昇格せず、warningを表示してdegradedにする。JSONLのschema不正・保持先重複はその検査記録全体を採用しない。HATE bytesの不一致は入力不正のままである。検証済みsanitized出力のraw sourceがHATEに残っている場合は入力を拒否し、rawをレポートで公開しない。v1の検証は署名された媒体bytesとpolicyの確認であり、M2のrequest／run bindingを持つv2証明の代用にはしない。

同じadaptive runを複数sessionが参照するときは、HATEのrun ID／attempt／manifest digestに対応する全参照のtarget条件を満たすことを要求する。restricted sessionなど検証できない参照を除いて許可条件を弱めない。参照がないadaptive runには検証済み媒体を付与しない。sanitizedの元媒体はsourcePathだけでなく、同じsource内のsize／SHA-256一致でも検出し、別名でのHATE保持を拒否する。sanitized出力自身はdigest一致だけを理由に元媒体と判断しない。

検証して同梱する媒体にはviewの任意field `proof`を付ける。attestationのschema version、decision、検査記録fileのSHA-256、署名対象digest、trust storeのSHA-256、key IDのSHA-256、policy digest、対応するtarget manifestのSHA-256集合を保持する。raw key ID、公開鍵PEM、ローカルpathは含めない。媒体詳細の折りたたみから確認でき、pending／excluded媒体には付けない。既存viewの読取互換を保持するため任意fieldとするが、新しい生成処理は検証済み媒体に必ず付ける。bundle verifyはこの表示記録のschema・状態整合を確認するもので、元の署名やtargetを再検証したと主張しない。

## Data and viewer

通常modeの既存`action-sequence.json`は計画であり、実行完了の証拠にしない。新規runは`action-execution.json`（`lakda/action-execution/v1`）へrun ID／attemptと、各試行のsequence、action ID／kind、開始／終了UTC、monotonic duration、completed／failedを記録する。completedは実行APIの完了でありruleの合格を意味しない。入力値・locator・URL・raw exceptionを追加しない。readerはrunと計画の実行済みprefixを照合し、新規履歴では試行だけをtimelineへ出す。未実行の計画は計画件数に残す。既存stdout／exitと選択・実行手順は維持する。adaptiveは既存の検証済みtraceを使う。

履歴のない旧runは計画を「計画」と明示し、実行件数はnull、生成状態はdegradedとする。UIでは計画action数と観測済みattempt数、実行件数未取得のrun数を分ける。未実行計画を操作履歴や成功件数へ昇格しない。このproducer側の不足補完はTask 65のreport対象境界に含める。

session概要はsession状態、technical outcome、受入状態、開始／終了、経過時間、記録されたactive duration、累積action数を別fieldで持つ。開始前abortでtechnical outcomeがない場合はnullとし、failedやpassedを補わない。sessionの累積action数を子runの操作件数へ加算しない。日時はtimezone付きの有効なISO日時だけを受け付け、表示projectionをUTCへ統一する。

versioned schemaはreport-config、report-sources、report-view、report-receipt、report-bundle-manifestを追加する。全て未知fieldを拒否し、schema catalog／packageに登録する。viewの`inputSourceIds`は明示入力の正規化済みID集合を持ち、参照展開後の`sources`と区別して`counts.sources`を検証する。private indexはportable bundleに含めない。

HTMLはscript非実行のJSON領域へ安全にescapeしたview modelを埋め込み、固定viewerがtextContentで描画する。入力値からinnerHTML・event attribute・URL schemeを構成しない。出力manifestは全fileを列挙し、HTML埋込projectionとJSON projectionを生成時に比較する。

概要・結果一覧・詳細・状態filterでは、既知の状態を表示言語に応じて表す。`failed`は「実行失敗」／`Execution failed`、`failure`は「失敗項目」／`Failure item`とし、同じ種類・状態のbadgeは重複させない。filterの値と保存JSONは元のcodeを維持する。keywordは元codeと表示名の両方に一致し、未定義の状態は原文を表示する。

失敗手順への移動と前／次の操作では、選択した手順を履歴一覧内へスクロールする。100件のページ境界でも選択行を表示し、選択内容の見出しへfocusを移す。狭幅では選択内容へ画面を移し、履歴一覧内の選択位置も追従させる。

概要・一覧・detail・timeline・media・coverage・根拠panelを持つ。filterと安定順、キーボードfocus、timezone、欠落理由、件数の意味をreport詳細どおり実装する。CSPは外部通信と任意scriptを許可せず、必要な同梱viewerだけを許可する。画像／動画は遅延読込とする。

2026-09-11のUI調整では白基調とし、合否件数と実行数・失敗項目・警告・検出事項を優先する。補足の操作件数・時間・session数・除外媒体数は概要内の開閉領域にまとめる。結果未確定runと未完了workerの存在は折りたたまず示し、欠落や受入未判定を隠さない。結果一覧は保存メッセージを最大2行で表示し、全文は詳細で確認する。詳細ではメッセージを全幅で先に表示し、長い内容をスクロールしても閉じる操作へ到達できるようにする。開閉領域を展開した状態は表示timezoneの変更でも維持する。

### 項目と媒体の参照解決

AR-01〜03: timelineの任意`step`は操作種別・対象説明・元status・所要時間・判定messageを持つ。元labelは保持し、旧viewのstep欠落は未取得として扱う。保存済みexecution／oracleから投影し、candidateの操作・対象は同じIDの記録が一意に対応する場合だけ使う。入力値・request payload・locator object全体は表示へ渡さず、選択した説明fieldへ既存の文字列redactionを適用する。`executed`は操作済み、`pass`は判定合格として区別し、candidateやconfirmedを失敗へ変換しない。workerの実行未完了・確定済みrunなし・run未確定は技術情報の開閉にかかわらず初期表示する。

手順に対応する媒体を表示できず、実行全体には媒体がある場合は、選択手順を維持した「実行全体の証跡を見る」を表示する。利用者が選ぶまでは手順の媒体へ自動混入させず、切替後も「この手順との対応は未確認」と明示する。前／次の手順へ移ると手順別表示へ戻し、動画は停止する。同じ詳細内で全体証跡を開き直す際は再生位置を保持し、自動再生しない。

詳細はPCで手順一覧と選択内容・対応媒体を並べ、狭幅では縦にする。記録された失敗statusの手順へ移動でき、前／次の手順で100件のページ境界を越えられる。媒体のない手順も選択でき、無関係画像を補わない。解除で元の手順へfocusを戻す。ID・revision等は開閉する技術情報へ移し、メッセージと判定・画像を優先する。媒体カードの未検査・欠落表示は見える状態で維持し、詳細な所属・検査記録は参照できるようにする。

UIR-01〜03の対応: 320 CSS px以下では、動画の標準controlsに加えて明示した再生・一時停止と再生位置のrange操作を表示する。位置操作は時刻範囲を取得できた場合だけ有効とし、読込前・不明時は無効、decode失敗時は両操作を無効にする。利用者が再生するまでは`preload=none`とautoplayなしを維持する。履歴選択・非表示・closeに伴う停止と位置保持は補助操作の表示にも反映する。

生成状態が資料不足等の場合は上部へ理由を案内し、「実行の警告」件数と区別する。上部は最初の理由の短い表示とし、全件の原文・codeは根拠欄に残して移動ボタンで参照できる。known codeの短い案内は日英で切り替えるが、保存messageや集計を変更しない。詳細の「画像・動画へ」は媒体または選択した手順の見出しへfocusを移す。PCでは履歴と媒体を並べ、狭幅では履歴・媒体の順に縦へ配置する。coverageは「技術情報・実行記録」で参照する。機密区分・所属・未検査や欠落の情報を省略せず、利用可能な媒体の補足は「媒体の詳細」で開く。

この節はREQ-UP-RPT-010／018／020、AC-UP-015／020の具体化である。対応付けの実装・実結果はTask 64／65へ、署名済みsource→outputの接続はTask 67へ記録する。表示対象をrecordへ関連付ける前に、既存のsource読取・schema・binding検証と媒体policyを適用する。

| 入力 | 解決に使える根拠 | 制限 |
|---|---|---|
| adaptive traceのexecution／oracle／candidate-denied | 既存validatorで確認した`executionResult.evidenceRefs`／`result.evidenceRefs`／`oracleResult.evidenceRefs`の完全参照 | 対象のschema種別も確認する。任意のnested fieldを探索しない |
| 既存schemaで認めたIDだけの証跡参照 | 同じsourceの一意なHATE `artifact_id`、または同じsourceで検証済みの完全参照から作ったID対応表 | ID→pathを命名規則から再構成しない。同じIDに複数候補があれば対応未確認 |
| session finding | `finding.oracleRefs`に対応する保存済みoracleと、その`evidenceRefs`。検索対象はsession自身と検証済みrun参照に限定 | 対応oracleのない別run、同じreportにあるだけのrunへ広げない。複数runの候補が残れば対応未確認 |
| session eventのfinding参照 | 既存のfinding IDに明示参照されたeventから、そのfindingの検証済み対応へ辿る | eventの隣接順からfindingを推定しない |
| 通常runのfailure／実行記録 | 保存契約に明示参照が存在する場合だけ採用 | 現行の最小実行記録に媒体参照を捏造せず、run単位の表示を維持 |

完全参照は`artifactId`、portableな`path`、`size`、`sha256`を使い、同じsourceのHATE artifactとsnapshotへ照合する。digest表記の既存prefix差だけを正規化し、pathのbasename一致、substring、時刻の近さ、画像bytesの類似性を使わない。参照先が存在してpath／size／digestが食い違う場合は入力不整合とする。参照先が保持されていない場合は対応未確認としてwarningを付ける。参照元・媒体の機密区分を引き下げない。

元媒体がsanitized出力へ置き換わった場合は、検証済みattestationのsourcePath／sourceSize／sourceSha256と完全参照を照合する。先に署名、採用したoutput bytes、適用されるtarget条件、v2ではrequest／receipt／run／session／policyも確認し、その検証で得た対応だけを参照索引へ渡す。旧v1は既存の検証範囲にとどめ、新しいv2証明へ昇格しない。trust欠落、署名不一致、対象不一致ではこの対応を使わない。

同じsource内で一致する出力が1件なら、その既存媒体IDへ関連付ける。既知のsourcePathに対してsize／digestが違えば入力不整合、一致候補が複数なら対応未確認とする。複数候補が同じ元媒体を示す場合、対応元の高い機密区分を候補すべてへ伝え、曖昧さを理由に区分を引き下げない。元の完全参照がredaction failed／security failと明示する場合は既存の拒否規則を維持する。

IDだけの参照は、同じsource内の検証済み完全参照からできるID対応表を使う。元pathから旧HATE IDを組み立てたり、署名のないmetadata採用記録だけで画像を置換したりしない。source→outputは一段の対応とし、別runの画像や連鎖的な置換を探索しない。直接保存された媒体への完全参照と、通常の非媒体参照は既存どおり検証する。

保存済み`adaptive/oracle-results.jsonl`を対応表に使う場合も、HATE snapshot内のbytesをstrict UTF-8で読み、全行の既存oracle schema・公開条件を検証する。read limitと共通deadlineの対象に含め、元directoryを追加走査しない。traceとJSONLの同じoracle ID／証跡IDが競合する場合は候補を一意とみなさない。検証済みの非媒体参照は表示対象外とし、証跡欠落とは区別する。

adapterの証跡IDとHATEのIDは別体系になり得る。現在のPlaywright bookmarkはdigestを含むadapter IDをtraceへ保存し、HATE exporterはpathに基づくIDを生成する。IDだけが保存され、完全参照への対応表も残っていない旧記録は、文字列を解析して補完しない。この場合、bookmark自体とrunの媒体は表示できるが、個別対応は確認できない。新しいproducer記録が必要ならTask Seedへ先に対象を追加し、旧archiveを変更しない。

viewにはraw参照を出さず、既存の安定したreport媒体IDを`record.evidenceIds`へ、record IDを`media.recordIds`へ相互に設定する。同じ媒体を複数recordが参照しても媒体・コピー・容量を重複計上しない。別runの媒体はbytesが同じでも別所属として保持する。関連が1件以上ある媒体は`scope=record`、ない媒体は既存の`scope=run`とする。後者のsession媒体はsource全体への所属を意味する。

row／timelineには任意の`evidenceNotes`を追加し、`unavailable`（対応未確認）と`not-media`（検証済みだが表示対象の媒体ではない）を重複なしで保持できる。該当理由がない場合はfieldを省略し、旧viewとの読取互換を維持する。`unavailable`があるsourceには`evidence-unavailable`のwarningを必須とする。restrictedの対応は媒体IDにもrecord単位の注記にもせず、source単位の一般的な制限理由に留める。完全参照がHATEより高い機密区分を宣言するときは、媒体選択前に高い方の区分を適用する。参照のdigestは任意の`sha256:` prefix付き小文字64桁、容量は非負のsafe integerを要求する。

bundle verifyは参照の存在・重複だけでなく、両方向の一致と所属も確認する。同じsource／run内の関連、または検証済みsessionの`runKeys`を経由したfinding／eventへの関連だけを許す。無関係なrunへの関連、片側だけの関連、restrictedの内容や関連を開示するviewを拒否する。媒体の対応付けは署名proofの代替にならず、pending／share除外等の判定を変更しない。

viewerはレポート詳細3.3の選択・解除・focus復帰に従う。run／workerの媒体一覧は`scope=record`の媒体も含める。finding／failureでは当該項目への対応とrun全体を区別し、履歴選択時はsequenceとlabelを残す。session全体では子runの所属を表示する。除外された媒体も公開可能な対応と除外理由を確認できるが、restricted媒体には対応recordを付与しない。動画の再生位置は、保存済みの明示対応がない限り変えない。

同じ詳細内で表示対象や媒体pageを切り替えても、同じ動画elementを再利用して再生位置を保持する。媒体を非表示にするときと詳細を閉じるときは一時停止し、再表示時に自動再生しない。詳細を新しく開く際の選択・動画elementはその詳細で初期化する。

### native v2の保存観測とレポート

native v2のsessionは、媒体の有無・textOnly・local／shareにかかわらず、保存観測と署名済みtargetを[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)のreaderで検証する。report設定のoperator trustだけを渡し、保存Charterのtrust pathへfallbackしない。target署名は最初の保存観測時点で検証し、HATEに保持したsession／events／target／Charterの実bytesと、全native記録のpath／size／digestを照合する。HATEにないnative記録や孤立fileも拒否する。

整合した未完了予定・応答不明は診断可能な入力として受理し、native-evidence-incompleteのwarningと「native操作の結果未確定」を表示して生成状態をdegradedにする。元sessionの技術結果は保存値として保持し、native操作の完了や実機受入を推定しない。署名不正・trust欠落・観測欠落・参照不一致は入力errorとしてbundleを公開しない。restrictedの内容は既存の非表示規則を維持する。公開直前にもnative inventoryとsource digestを再検査する。

## Plan

pause／resumeの前提修正として、新規runの観測traceはoperator-control／operator-bookmark／各errorを全件保持し、再生用projectionからだけこれら4種を除く。レポートは観測traceのoperator記録を厳格なfield／値検証後に表示する。0 actionのresumeは空の再生fileを入力にせず、capability／fingerprint照合を維持する。既存保存fileは変更せず、replay入力validatorの許可範囲も変更しない。

Task 63の共通reader→Task 64のdata／bundle／schema→Task 65のviewer／CLI／自動生成の順で進める。wire契約をtests-firstで固定し、小さい変更ごとに型と関連testを確認する。

## Patch

pause／resumeの画面同一性検証は操作前後で同じpersonaを使う。Playwright execute後のobserve（target close後の戻り先も含む）にも、execute contextのpersonaRefを渡す。hash算法や照合条件は変更せず、旧観測artifactの書換え・暗黙migrationは行わない。旧runのpersona欠落で新観測と一致しない場合は従来どおり不一致として扱う。

既存CLIのstdout／exit、runの保持規則、5 mode、HATE、QEG境界はcharacterisation対象。CLI後処理追加以外のruntime選択には触れない。新schemaは既存v1へ混ぜない。

## Tests

AC-UP-011〜021。正常5 mode、batch worker失敗、session pause／resume、offline portable表示、媒体policy、秘密値・特殊文字、hash／path／schema、容量・timeout、package installを含む。UIは実browserで確認する。

## Commands

### 性能・browser受入の測定契約

専用の`npm run acceptance:reports`で、媒体なしの人工保存入力から実際のCLIで生成する。100 run・action execution合計10,000件・failure合計1,000件の均等配置と1 run集中配置を別corpusにする。failure messageは各2,048文字（日本語・改行・空白のない長文を含む）とし、入力と生成viewの実byte数を記録する。最大件数の測定は容量上限の境界試験とは別に扱う。

各corpusで独立したCLI processの起動から終了までをmonotonic clockで5回測定する。schema読込み、入力照合、bundle生成、receipt保存を含み、corpus作成・buildと後続の独立`report verify`は含まない。全sample・終了code・生成状態・入力digestを保存し、5回すべて10秒以下を要求する。遅いsampleや失敗を除いて再集計しない。processはcold startだがOS cacheは消去しないためdisk cold-cache性能とは表現しない。

Chrome／Edgeは専用の一時profileを用い、browserが返す正確なversionを記録する。1366×768／390×844のviewportとbrowser zoom 100%／200%の全組合せを各corpusで確認する。200%はbrowserのpage zoomを使用し、devicePixelRatio・layout幅・visualViewport.scaleも保存して倍率を検証する。CSS zoomやpinch拡大だけで代替しない。各組合せ5 navigationの開始から操作可能な一覧描画と2 animation frameの完了までをbrowserのperformance clockで測り、全sampleが3秒以下であることを要求する。browser起動時間と媒体decode時間は含めない。

各組合せでkeyword filterの100回の変更（全件・部分一致・0件を決定的に循環）を測定する。入力event dispatch直前から期待件数のDOM反映と2 animation frame後までを対象とし、全sampleを保存する。nearest-rankのp95が300ms以下であることを要求し、warmup sampleも除外しない。主な操作のラベル、Tab／Enter／Escape、一覧pageとfocus復帰、詳細履歴のpage、timezone切替、長文と0件時の表示、水平overflowを確認する。offline設定とrequest監視をnavigation前に有効にし、外部HTTP requestは0件を要求する。媒体の表示・選択・再生位置は別の媒体fixtureの受入と区別して記録する。

結果には実行日時、source revisionとdirty状態、Node／OS／CPU／memory、browser version、viewport／実測zoom、全測定値、失敗理由を含める。成果物は既存bundleを上書きしない固有directoryへ保存する。browser未導入・zoom未反映・不完全な測定をpassにしない。

媒体の専用受入も同じChrome／Edge・2 viewport・2 zoomの8条件で実行する。画像P／Qと関連finding、未所属参照・複数runの曖昧参照、local／shareの除外を実際の保存入力から生成する。再生可能な人工WebMと2つの履歴参照では、手動seek後の時刻保持、表示切替／詳細close時の停止、再表示時の自動再生なしを確認する。sampled frameのsequence順、画像の拡大／縮小、decode失敗時の理由と保存link、traceの手順表示も確認する。元入力／移動後bundleをverifyし、各媒体のdigestと生成状態を残す。テスト中にscannerや実targetを起動せず、未検査fixtureを署名済み媒体と表現しない。媒体fixtureの作成とdecode時間は最大corpusの性能測定へ混ぜない。

画像の拡大はCSS classの切替だけを合格条件にしない。原寸以上の幅で表示し、画像枠のoverflow内で移動する。拡大時は名前付きregionへfocusを移し、矢印キーで横／縦に移動できる。縮小では画像全体を枠内の幅・高さに収め、scroll位置を先頭へ戻してbuttonをfocusする。195 CSS pxでも画像の実表示幅が増え、dialog／document自体の横overflowを生じないことを確認する。PCの200%に相当する683×384 CSS pxでも縮小画像の縦方向が枠を超えないことを検査する。

画面の証跡にはbrowser surfaceのviewport captureを併せる。200%拡大で全ページ画像が極端に縦長になる場合でも、選択中の媒体・解除button・focusが見える画像を残す。各caseの完了／失敗を個別記録し、途中失敗したcaseの未実施操作をpassとして扱わない。

`npm run check`、`npm run test:contracts`、`npm run pack:check`、実装時に追加する専用report契約／UI test。最終の記録にcommandと実結果を残す。

## Notes

初期版の完了条件を比較graphやAI要約で置き換えない。逆に未実装Shouldを実装済みとしない。mediaのpendingとsource integrityは別判定である。
