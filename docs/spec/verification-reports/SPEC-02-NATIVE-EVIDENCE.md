---
document_id: LAKDA-SPEC-UP-002
status: implementation-ready
version: 0.1.26
last_updated: 2026-09-11
requirements: ../../proposals/20260910-detailed-requirements.md
checklist: CHECKLIST-02-NATIVE-EVIDENCE.md
---

# SPEC-02 Python bridge・実機identity・媒体証跡

対応[checklist](CHECKLIST-02-NATIVE-EVIDENCE.md)。REQ-UP-BRG、ATT、IDNを担当する。

## Objective

Pythonを実行してbridgeの動作を保証し、operator管理の実観測と検査・署名を、対象revisionと媒体bytesへ結び付ける。

## Recording backend and media formats

REQ-UP-BRG-002、ATT-001〜004、IDN-003と既存の媒体表示要件を次の条件へ具体化する。57要件・22 ACの追加や縮小ではない。

| 条件 | 必要な動作 |
|---|---|
| Androidの録画API | 固定Airtest 1.3.5の接続済みdeviceのstart_recording／stop_recordingを使用する。両方が呼出し可能な場合だけvideo capabilityを返す。片方だけあるdeviceを共有APIへ暗黙に切り替えない |
| 開始と停止の対応 | 開始時に選んだ開始methodと停止methodを保持する。共有API、device、停止methodの参照が後で変更されても、開始済み録画の停止先を切り替えない |
| 開始確認 | device側の開始結果が指定した出力pathと一致する場合だけ録画を登録する。SDKが既存録画の存在でNoneを返す場合、その録画を採用・停止しない |
| 停止確認 | device側の停止がTrueを返した場合だけ停止済みとする。False、None、例外ではactive状態と媒体を保持し、artifactRefsを公開しない。開始時に保持した停止methodで再度確認できる |
| 形式と受渡し | device録画はartifacts/video/0001.mp4、mediaTypeはvideo/mp4とする。MP4のbytesへWebMの拡張子を付けない。inventory、検査request、run／sessionのbinary判定、video集計、HATE kindを一致させる |
| 検査状態 | 未検査MP4はlocalではpending／not_applicable、署名必須経路では不合格とする。信頼された署名とsize／SHA-256の一致を確認した媒体だけを検査済みとする。未知拡張子を検査済み動画へ変換しない |

既存の共有APIを注入する経路は、deviceが録画methodをどちらも持たない場合だけ互換用に維持する。この経路はWebMと従来のNone戻り値を維持し、停止methodの固定を適用する。実AirtestのAndroid接続確認をこのfixture互換経路で代替しない。

request v1へvideo/mp4を追加するが、既存field・canonical署名payload・WebMの意味を変更しない。旧readerは未知MIMEを拒否でき、新しいMP4を旧WebMと読み替えない。動画欠落の診断参照はartifacts/video/*.{webm,mp4}とし、未採用MP4の受領記録も欠落理由として照合する。形式名と署名の検証はcodecの再生や映像内容の検査とは別である。

上記のmethod固定だけでは、device内部のADB接続世代、native lease・承認期限、背景撮影の停止を保証しない。それらの統合完了までnative target v2のCLIは連続撮影を接続前に拒否する。Windows／iOS providerと実機受入も別に確認する。

## Capture authorization and lifecycle

native capture guardは、登録済みの観測leaseとv2承認windowを照合する内部APIとする。操作連番は消費しないが、既に結び付いたwindowの変更やv1からの暗黙昇格を許さない。guardは各確認の前後でleaseが引き続き登録されていることも確認し、操作失敗で取り消したleaseを背景撮影だけが使い続けない。ここでのwindowは追加制約であり、operator署名の検証はNode側の責務である。

| 場面 | 必要な動作 |
|---|---|
| 単発画像・sampled frames | 観測したADBのsnapshot APIを保持し、共有のscreen proxyを使用しない。deviceのADB参照、selector、display選択、transport世代、lease・承認期限を取得前後で確認する。PNGのbytesだけを保存し、hash計算後も確認してからframe数へ加える。不正な取得は正常frameとして数えない |
| native録画の開始 | 固定SDKのYosemite recorderとADB、開始・停止methodを保持する。観測・承認の残り時間を切り下げた整数秒をmax_timeへ渡し、1秒未満では開始しない。出力pathとrecording process参照を確認して所有を確定する |
| 開始の応答不明 | SDK呼出し後の例外、不正な戻り値、process参照欠落では状態を保持して開始未確認とする。追加の開始を拒否し、所有を推測して停止しない。既存録画を示すSDKのNone戻り値とは区別する |
| 背景監視 | 各確認終了から次の確認までの待機を100msとし、接続・recorder・process・lease・承認の変化で新しい取得を止める。確認とSDK自体の処理時間を含む厳密な100ms以内の停止保証とはしない |
| 停止処理 | 元のADB・selector・display・recorder・processとtransport世代が一致する場合だけ、保持した停止methodを呼ぶ。この終了処理はlease失効・承認期限後・共有device参照変更後も可能とする。接続を確認できなければ停止未確認とし、別deviceへ停止を送らない |
| 停止待機 | native録画はworkerで停止する。要求のstopTimeoutMs内に終了確認が取れなければactiveと媒体を保持する。後続stopは進行中workerを待ち、完了済みの停止を再送しない。終了した失敗workerの再試行は明示的なstop要求に限る |
| 監視の開始失敗 | 開始済み録画を状態に保持する。後続stopでworkerを作成できれば元backendを停止できるが、監視できなかった媒体を正常なcaptureへ昇格しない |
| bridge終了 | 新しいnative観測・操作・撮影を拒否するclosing状態に入り、共通500msの待機枠で所有する撮影を停止してからtransportを閉じる。停止未確認ならclose失敗を返し、元の終了処理を再確認できるようtransportを保持する |

bridge終了の共通待機枠には、録画開始が保持するrecording lockの取得も含める。SDK開始待ちでlockを取得できない場合は、その場で停止完了とせず、closing状態と元transportを保持して後から再確認する。

監視失敗の後は、停止そのものが確認できてもcapture成功にしない。artifactRefsを返さず、元媒体と失敗理由を保持する。旧capture-controlはguard付きのactive captureを停止できない。SDKのmax_timeは補助上限であり、SDK／OSの停止不能や開始中の応答停止を強制終了できる保証ではない。

撮影要求・停止結果とsession証跡の照合が完成するまでnative v2のCLIは連続撮影を接続前に拒否する。HTTPからwindowだけを渡せたことをoperator承認・実機受入の完了としない。

### Native capture HTTP v1

operator loopbackの`native-capture`へ、`lakda/native-capture-request/v1`を送る。必須fieldは`operation`（screenshot／start／stop／discard）、`lease`、`approvalWindow`、`ordinal`、`captureOrdinal`、`payload`。leaseとwindowの形はnative action v2と同じで、署名済みNode callerからの伝播が必要である。payloadはrunId・stagingDirと、連続撮影ではmode・撮影上限・停止待機時間を含む。未知fieldを拒否する。要求は64 KiB以内、応答は4 MiB以内とし、超過した媒体一覧を黙って切り捨てない。

| 条件 | 契約 |
|---|---|
| 連番 | 観測leaseごとに1から始める撮影専用ordinal。native actionの連番と独立し、screenshot／startは直前+1だけを受理する。stop／discardは配送不明の要求を飛ばせるよう、直前より大きい番号を許す。開始識別子と元guardの照合は省略しない |
| 単発・開始 | screenshot／startのcaptureOrdinalはordinalと一致する。開始前に登録lease・window・接続を検証する。screenshotは保存済みguardのADB snapshotを使う |
| 停止対象 | stop／discardは開始時のcaptureOrdinal、lease、window、endpoint、runId、stagingDir、modeに一致するguardだけを使う。期限切れやclosing後でも元撮影のcleanupを試せるが、新しい撮影は許さない |
| 再送 | 直前と同じordinal・要求digestなら保存した応答を返す。内容の違う同番号、古い番号、screenshot／startの飛び番号はSDK呼出しなしで拒否する。新しいordinalで停止を再確認するときも元guardを使う |
| 直列化 | native actionと撮影要求は同じ非待機lockを使う。実行中要求の再送はbusyを返す。応答待ちtimeoutを理由に自動再送しない |
| 結果不明 | 要求の連番をdispatch前に消費する。開始が不明な撮影のguardを保持し、後続stopで所有を推測しない。例外のraw messageを応答へ載せない |
| 応答 | `lakda/native-capture-result/v1`にoperation、ordinal、captureOrdinal、要求全体のSHA-256、completedAt、resultを保存する。要求の絶対staging pathは応答へechoしない。失敗応答にartifactRefsを含めない |
| 保持上限 | 登録済みleaseとcleanup未完了のleaseについて最大32件の状態を保持し、各leaseの直前応答だけを保存する。leaseが失効しcleanupも不要なら状態を破棄できる。再取得時は新観測・新連番で始める |

単発撮影は継続中captureの停止識別子を置き換えない。停止確認済みの古いcaptureへの新要求は拒否し、その後の別captureへ転用しない。SDKを呼ぶ前の要求形式エラーと、呼出し後の失敗応答は区別する。resultは既存capture結果と媒体参照を検証し、媒体bytesの採用・公開は従来の検査・署名経路に委ねる。

直前応答の再送は元のcompletedAtと内容を維持し、現在の接続・撮影継続を保証しない。sampled framesの成功stopでは、元guardが所有し停止時に検証した一覧を応答へ含める。一覧の受渡しや応答作成に失敗した場合は成功を取り消し、停止確認済みならstopped=trueだけを維持する。Node clientは最初の非同期処理より前に入力をcopyする。

このHTTP契約のlocal実装検証と、署名済みfacade・session journalへの接続は別に記録する。後者の完成までCLIの連続撮影制限を維持する。

## Python test architecture

`tests/python/`にstdlib unittestで実行できるsuiteを置く。importlibから本体server.pyを読み、Airtest／Poco importを伴うruntime loadだけをpatchする。capture_control、sampler、path検証、HTTP handlerは本物を使う。

fixtureは許可root内TemporaryDirectory、偽device／recorder、thread barrier、制御可能clockを用いる。sleepを長く置いてタイミングを期待せず、event／barrierで開始・書込・停止を同期する。HTTP fixtureは127.0.0.1のOS割当portにのみbindし、終了時にserver・threadを閉じる。

必須caseは開始→停止／破棄、二重開始、mode違い、0 frame、backend start／stop失敗、sampler途中失敗、stop timeout、frame／byte境界、path逸脱、requestの形式・容量・origin。途中に正常frameが存在しても、その後のcapture例外を成功扱いにしない。stop失敗時はactive状態を保持し、未停止媒体を公開しない。

実行wrapperは明示Python pathを優先し、Python不在／0test／全skipを失敗にする。Windows CIはsetup-pythonで3.13を固定する。unit fixtureの通過からAirtestの依存互換や実機対応を主張しない。

結果記録と合格条件は[全体要件6.1](../../proposals/20260910-detailed-requirements.md#61-python検証を完了とする条件)に従う。通常成功、skip、expected failure、unexpected successを区別し、全体合格には通常成功が1件以上必要である。module／classの初期化・後始末で通知されたerrorは、そのfixture自身のrecordにし、直前caseの結果や計測時間を流用しない。case内のsubtestは親caseの結果へ反映し、失敗・errorを後続skipで取り消さない。

JSONでは実行開始case数と結果record数を区別する。JUnitのtestcaseと集計値は結果recordに対応させ、expected failureは理由付きskipped、unexpected successはfailureへ写像する。JSONには元の状態を残す。保存先が書込み可能な場合は試験の不合格時にも両形式を出力し、出力不能・Python起動不能はwrapperの診断と非0終了で示す。

## Dependency lock

runtime matrixはplatform、architecture、Python patch、Airtest／Poco、lock SHA、clean install／import結果を持つ。実際のresolver出力をhash付きで固定し、手書きの架空lockを作らない。未解決platformはpending_external、理由、必要環境を記録する。operatorのinstall手順だけを提供し、Lakdaからinstallしない。

依存検証は指定lockの必要packageを導入済みdistributionのversionと照合し、全件一致と必要moduleのimport成功を満たす場合だけ合格にする。欠落・不一致・曖昧な同名distribution・lock解釈失敗を区別して記録する。importに伴って検索可能になるvendored distributionを、環境へ導入したpackageと混同しない。検証対象・照合前提・除外するtoolingがある場合は明示し、未知の差分を黙って許容しない。

hash付きinstallの配布物検査、導入versionの照合、module importは別の検証結果として扱う。既存の`package-import-only`証跡を環境照合済みへ書き換えず、新しい証跡でscopeとlock digestを記録する。version照合は導入後fileのbytes検証やdevice受入を意味しない。

照合対象は各platformで解決済みの、1 MiB以下のUTF-8 lockとする。packageの完全固定`name==version`と1件以上のSHA-256 hash、継続行、空行、行頭commentを解釈し、marker・URL・別file参照・editable・不完全な継続行など未対応構文は解釈失敗とする。package名は大文字小文字と`.`／`_`／`-`を正規化し、重複pinを拒否する。versionはlock記載値と完全一致で比較する。

distributionは当該interpreterのpurelib／platlibから列挙する。未固定のinstallerとして`pip`だけを除外可能とし、除外したversionも記録する。その他の追加packageと同名重複は不合格とする。import先もそのsite-packages配下であることを確認する。新しい証跡は`lakda/bridge-dependency-verification/v2`、scopeは`locked-versions-and-package-import`とし、照合結果・import結果・除外を分けて保存する。既存出力fileへの上書きは拒否する。

## Capture lifecycle

状態はidle→recording→stopping→stopped／failed。modeとrun IDをactive sessionに固定する。sample count／bytes／exceptionはlock内で更新し、joinはlock外で実行する。start／stop／discardの要求を同じrun内で直列化し、旧stopが新capture状態を消さないようgenerationを照合する。

capture backendの例外はtypeと固定reasonだけを記録し、raw exception messageでdevice情報を漏らさない。stopが失敗した媒体はactive／failedとして残し、operatorの明示discard／再停止以外で削除しない。sampled framesをvideoへ暗黙変換しない。

## Attestation handoff

request schemaは `lakda/binary-attestation-request/v1`。request ID、run ID、任意session ID、target manifest SHA、source path／size／SHA、kind、policy digest、nonce、createdAt／expiresAtを必須契約として定義する。responseは `lakda/binary-artifact-attestation/v2` とし、request ID／digest／nonce、source／output、scan、tool policy、署名を保持する。

署名payloadはsignatureを除いた既存canonical JSON規則でUTF-8化する。非有限数、未知field、非canonical bindingを拒否する。v1の読取互換を維持するが、新handoff完了にはv2を要求する。

`attestations/requests/<id>.json`と`attestations/responses/<id>.json`をrun専用private stagingでatomic受渡しする。承認済みrootの外・symlink／junction逸脱を拒否。応答のrequest digest、run／target、nonce、期限、許可key、source／output bytesを確認する。原sourceはpublic出力へ残さず、outputだけをHATEへ登録する。

待機は既定30秒、1〜300秒。stop要求は1秒以内に反映する。期限後応答はsealed runを更新せず、元digestを参照する派生bundleにだけ使える。新schema／共通検証／coordinatorはTask 67内で変更し、実署名keyをfixtureに入れない。

### 受渡し契約の具体化

requestは`requestId`、`runId`、任意の`sessionId`、`targetManifestSha256`、`sourcePath`／`sourceSize`／`sourceSha256`、予定した`outputPath`、`mediaType`、`policyDigest`、`nonce`、`createdAt`／`expiresAt`を持つ。`requestId`／`nonce`は新規UUID v4とし、run／session IDは既存の識別子を引き継ぐ。日時はmillisecondを含むUTC ISO表現を使う。source／outputはrun基準の正規化済み相対pathで、outputは`artifacts/attested/<requestId>.<元媒体の拡張子>`に固定する。同一run内の要求は共通の期限を持ち、媒体数に比例して待機上限を延長しない。

response v2はrequest全体とそのcanonical SHA-256、元媒体のpath／size／SHA-256、判定、tool／policy、scan結果、`completedAt`、署名を持つ。sanitized判定には予定したoutputのpath／size／SHA-256が必要で、no-sensitive-content／rejected判定にoutputを付けない。署名payloadはsignatureだけを除いたresponse全体である。受理には保存したrequestとの全field一致、sourceとpolicyの一致、許可されたEd25519公開鍵による署名、`createdAt <= completedAt <= 受領時刻 < expiresAt`を要求する。secret／PIIのfailまたはrejectedは検査不合格として記録し、媒体を採用しない。

request／responseはそれぞれ64 KiB以下。未知field、非有限数、範囲外size、非正規日時、絶対path・親移動・Windows別名path、未知key・重複key、不正base64を拒否する。入力JSONを検証する純粋な契約層と、bytes・filesystem・停止を扱う受渡し層を分ける。契約層だけの検証から実媒体の検査・受渡し成功は主張しない。

private stagingは公開runの外に置き、`sources/<sourcePath>`、`outputs/<outputPath>`、`attestations/requests/<id>.json`、`attestations/responses/<id>.json`を使う。保存したrequestと隔離媒体をoperatorが読む。Lakdaからscannerや署名processを起動しない。受渡しの設定は任意のCharter capture設定として追加し、そのCharter digestを既存署名済みtarget manifestへ束縛する。設定なしの旧runは従来契約として保持し、新しいhandoff成功へ昇格しない。

任意設定は`capture.binaryAttestation`とし、`stagingRoot`（空でない文字列、最大4096文字）、`policyDigest`（SHA-256）、任意の`timeoutMs`（整数1000〜300000、既定30000）を持つ。未知fieldを拒否し、この設定を持つCharterはreal laneに限定する。stagingの実path・公開runとの分離・trust・許可keyは接続前に検証する。設定をschemaで読めることと、通常runの受渡しが接続済みであることは別の実装段階として記録する。

### ファイル受領と記録

request／responseのfile bytesは、再帰的にobject keyを整列した既存canonical JSONにLFを1個付けたUTF-8とする。BOM・pretty print・余分な改行・重複JSON keyを含む非canonical fileは受理しない。署名payloadと`requestSha256`はLFを含まないcanonical JSON、受領recordの`responseSha256`はLFを含む実file bytesのSHA-256である。operatorは同じdirectoryの一時fileを完全に書き終えてから、既存の応答を上書きしないatomic操作で最終名へ公開する。最終名でpartial writeを始めない。

受領は`attestations/claims/<id>.json`を上書き不可で作成できた処理だけが行う。同一requestの並行受領、再受領、保存後に変更されたrequestを拒否する。claim取得後にprocessが停止した場合も同じrequestを暗黙再開しない。残ったprivate fileを保持し、復旧時は旧証跡を参照する明示的な新処理を必要とする。

受領recordは`lakda/binary-attestation-receipt/v1`、保存先は`attestations/receipts/<id>.json`とする。request ID／digest、run ID、target manifest digest、status、reason、応答file digest、受領日時、完了日時を保持する。statusは`response-verified`、`rejected`、`timeout`、`cancelled`、`error`。`response-verified`は保存した要求と応答署名の一致を表し、媒体bytesの採用や画像内容の検査成功を単独では証明しない。応答を読めなかった場合は応答digestと受領日時をnullにし、推定値を埋めない。成功以外には固定reason codeを必須とする。

待機期限は作成時の残り時間から単調時計にも固定し、wall clockが戻っても延長しない。応答読取後と署名検証後にも停止・期限を再確認する。受領層は公開runの`exports/artifact-manifest.json`が存在する場合に新しい処理を拒否し、媒体採用・finalizationとの呼出し順序は同じrunのcoordinatorが直列化する。受領recordはprivate stagingへ保存し、媒体採用側が公開可能な最終記録を確定してからHATEへ結び付ける。

### 媒体の隔離と採用

capture停止後のsourceを、requestのsize／SHA-256に照合しながらprivate stagingの`sources/`へ上書き不可でコピーする。コピーの完了と元fileの再照合後、run内の元fileをprivate `originals/<requestId>/<sourcePath>`へrenameして保持する。元fileをunlinkしない。移管後の原本もrequestのsize／SHA-256へ照合してからstage完了とする。失敗時は元fileまたは移管済み原本と既存コピーを保持し、隔離できなかったrawが残るrunをHATE公開へ進めない。媒体ごとの読書きはstreamingとし、設定された正のbyte上限と停止を適用する。全run容量の合計検査はcoordinator／Artifact Policyで行う。

`originals/`は検査入力`sources/`と別のprivate保管領域であり、HATE・HTML bundle・公開receiptへ取り込まない。request directoryは上書き不可の新規作成とし、既存directoryは空でも再利用しない。移管前後に正規pathとdirectory identityを検証する。[Node.jsのrename](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath)は既存fileを置換し得るため、既存保管先をrenameの宛先にしない。停止・期限切れ・再照合不合格で移管済み原本を削除しない。OSから移管失敗（別volume、使用中、アクセス不可等）が返れば`media-preservation-unavailable`として止め、コピー＋元file削除へ切り替えない。この失敗時の保全を、別volumeでの正常handoff対応とは表現しない。

sanitizedでは`outputs/<request.outputPath>`のsize／SHA-256を署名済みoutputに照合し、runの同じoutputPathへ採用する。no-sensitive-contentでは隔離したsourceをその署名済みsourcePathへ戻し、元bytesの検査済み保持として扱う。no-sensitive-contentのために未署名outputを生成しない。どちらも隔離source自体を再照合し、保存したrequest・response・receiptのbinding、署名、停止・期限を採用直前に確認する。

採用先は上書き不可とし、同じrequestの採用試行をprivate claimで一度に限定する。採用失敗、停止、期限切れでprivate sourceを消さない。directoryの正規pathとidentityを確認してコピー・削除を行い、symlink／junctionの別名を追わない。コピー中にsourceが変わった場合、予定した公開名へfileを確定しない。coordinatorは採用結果のpath／size／SHA-256をArtifact Policyへ渡し、媒体bytesの最終照合と受領記録を揃えてからHATE exportを行う。

元fileを取り除く直前にも、digest確認前後のfile identity、size、更新時刻を照合する。確認中に更新された元fileを、古いコピーが存在することだけを理由に削除しない。採用コピーの最後の停止・期限確認に失敗した場合は、その処理が新規作成したと確認できる採用先だけを取り除き、隔離元と既存採用先を保持する。capture停止とfinalizationの直列化は、この確認とは別の呼出し側前提である。

媒体のread／writeは最大64 KiB単位とし、各readの前後、部分writeの前後、最終identity／digest照合の前後で停止・期限を確認する。inventoryのhash計算、コピー先の再読取、隔離前の元file再照合、採用前のprivate source確認にも同じcheckを伝え、巨大fileを読み終えてから停止を確認する経路を残さない。進行中のOSのfile I/O自体は強制終了せず、その完了直後に停止を確認して次のI/O・削除・公開を開始しない。通常のローカルI/O下で停止反映1秒以内を計測し、OSやstorageの停止中まで保証したと主張しない。

exchangeの`stage`は隔離完了後に要求を発行し、`retain`は受領と媒体採用を接続する。採用結果は`adopted`／`failed`／`not-attempted`と固定reasonで返す。応答が`response-verified`でも、後続の媒体照合・停止・期限により採用が失敗し得る。呼出し側は応答statusだけでrun成功・媒体保持を判定しない。

### HATEと保存済みv2の照合

通常runでは開始前に設定・trust・許可keyと公開run外のprivate directoryを確認する。captureを開始した状態と、停止を確認した状態をcollectorへ保持する。停止確認ができない場合はvideo retention、媒体隔離、公開finalizationを進めず、元bytesを保持してartifact failureを記録する。既存modeでhandoff設定がない場合の公開I/Oは変更しない。

private stagingはconfigured run／sessionの公開保存root内へ置かない。保存先のancestorにHATE manifestまたはrun-start recordが存在する場合も、過去・未確定run内として拒否する。設定はpreflight開始時にcopyし、実run bindingは検証済み設定から作る。runの受渡し前と記録公開前には、operator trust fileのpath／size／digestが開始時と同じことを確認する。

capture停止と既存video retentionの後、保持対象の媒体一覧をsize／SHA-256とともに確定する。媒体は共通createdAt／expiresAtのrequestへ束縛し、全件のstage完了後に受領・採用を待つ。応答のない先頭媒体によって後続の応答を期限切れにしない。全処理の終了後に公開記録とrun metadataの採用件数・受領status・固定reasonを確定し、同じbindingでArtifact Policy／HATEへ進む。隔離や記録公開が途中で失敗した場合は、HATEへ進まずprivateと未確定runのbytesを保持する。

受渡しのwall clock開始時刻と単調時計期限は、媒体一覧のhash計算前に一度だけ固定する。inventory・全媒体stage・応答待機・採用で共通予算を消費し、exchange作成時に予算を取り直さない。wall clockの後退で期限を延長せず、開始時刻より前へ戻った場合はtime-invalidとする。requestのcreatedAtはこの開始時刻とし、期限内に一覧を確定できなければ要求を公開せず元bytesを保持する。

採用が終わった後の診断証跡確定は、exportRetained開始時に同じtimeoutMsを上限とする独立した終了処理とする。timeout／cancelledのreceiptを保存する必要があるため、採用期限切れや既に記録した停止を理由に診断処理を即座に破棄しない。終了処理中もbytes再照合と単調時計の期限を確認する。開始時に停止が未記録なら、その後に検知した停止で次のread／write境界から中断する。既に停止したrunでは、その停止を保持して診断だけを有界に確定する。終了処理の期限は媒体採用や新しいresponseの受領に利用しない。中断時は既存の媒体・private記録を保持し、未確定のHATEを成功扱いにしない。この既定制御は受渡しAPIの直接呼出しにも適用し、呼出し側の任意callbackだけに依存しない。

非同期の停止checkを終えた後にも、読取元のidentity・容量・更新時刻を再照合する。check中の差替えやこれらの情報に表れる更新を再確認する。checkを指定しない既存readerでは従来の照合とsignalを維持する。公開recordは64 KiB以下のwrite単位でcheckを適用し、atomicな確定前の中断では自分が作った一時fileだけを除去する。既に確定したrecordを含めた終了処理が後で失敗した場合は、未確定runとその記録を保持し、HATE成功へ進めない。

未解決IO-01: 同じinode・容量・更新時刻のまま内容を書き換える並行writerは、上記情報の再照合だけでは検出し切れない。停止済みcaptureとoperatorによるatomicなoutput確定が前提であり、readerの照合を排他lockの保証として扱わない。ローカル試験でこの制約を確認しており、コピー後の元file除去を含む媒体不変性の受入は、private保持・排他またはfile移管の方式を検討して追加検証するまで未完了とする。停止制御のtest合格でこの要件を完了扱いにしない。

探索loopで既に消費したpause／killもcollectorへ引き継ぐ。待機中の制御fileは有界に読み、pause／killだけを停止として処理し、bookmarkによる新しいtarget操作を追加しない。新たに受領した停止はrun metadataにも記録し、session側からcommandを確認できるようにする。停止・期限・採用不合格は媒体の検証成功へ昇格しない。

採用したv2 responseは`attestations/binary-artifacts.jsonl`、対応する受領recordは`attestations/receipts/<requestId>.json`へ公開可能なbytesとして保存する。private source、未採用output、private claimをHATEへ列挙しない。署名対象の文字列をredactionで変更すると署名が無効になるため、公開可能性を確認できない署名recordを改変して成功扱いにしない。

保存済みv2の検証には、そのrunの`runId`、任意`sessionId`、`targetManifestSha256`、`policyDigest`と、明示的に許可したattestor keyを要求する。受領recordのrequest ID／digest／run／target、応答file digest、受領・完了日時をrequestと照合する。署名と完了日時は保存された受領時刻を基準に確認し、現在時刻が期限を過ぎていることだけで保存済み証跡を無効にしない。受領recordはrunnerの記録であり、attestorによる受領時刻の署名とは扱わない。

保持媒体のpath／size／SHA-256も再照合する。v1は従来契約として読めるが、v2のbindingや受領recordが欠ける場合にv1扱いへ戻さない。異なるversionを含む場合も保持先が重複した記録は無効にする。Artifact PolicyとHATEの再exportは同じrun bindingを使用し、reportは署名済みtargetと参照元run／sessionからそのbindingを確認する。

reportは署名済みCharterの`capture.binaryAttestation.policyDigest`、検証済みtarget manifestのdigestと許可key、参照元session ID、実際に媒体を保持するHATEのrun IDを照合する。参照する複数sessionがある場合は全件一致を要求する。新設定を持つtargetにv1署名を流用しない。v2の受領recordも同じHATE manifestへ登録されたsnapshotから読み、64 KiB、canonical UTF-8、classification、scan条件を確認する。manifestにないfileを補完入力として読まない。生成した媒体proofにはv2であること、request digestと受領recordのfile digestを残す。

### 媒体を採用できなかった実行の確定記録

各stage済みrequestの最終結果を`lakda/binary-attestation-result/v1`、`attestations/results/<requestId>.json`として保存する。request全体、canonical request digest、対応するreceipt fileのdigest、adoption（adopted／failed／not-attempted）、固定reason、採用先のpath／size／SHA-256（未採用はnull）を持つ。canonical UTF-8＋LF、64 KiB以下、未知field拒否とする。これはrunnerの採用記録であり、attestorの署名・検査成功を示す記録ではない。

新しいrunのmetadata.binaryAttestationには要求数・採用数と各requestのID／source／受領status／adoption／reason／任意の採用pathを保存する。再exportとreportはこの一覧と全result／receiptを照合し、成功媒体の記録を含め1件でも消えていれば拒否する。記録順の違いは許容するが、件数・ID・状態の競合を許容しない。この一覧を持たない旧v2証跡は従来の読取契約として扱い、新runの一覧を推定しない。

not-attemptedは成功以外のreceiptと同じreason、failedはresponse-verified後の採用失敗reason、adoptedはresponse-verifiedと検証済み媒体を要求する。request／receiptのID・digest・run／session／target／policyを照合し、同じsourceを複数requestに割り当てない。公開直前に未採用sourceのprivate bytesを再照合し、公開runに元source・予定outputまたは同じ元bytesが残る場合は拒否する。

必須媒体の期待値と実際の欠落は変更せず、検証済み未採用記録が説明する欠落を別に列挙する。HATEはoutcome=errorかつ全profile欠落がこの記録で説明され、ほかの検査も合格した場合だけ診断証跡を確定できる。未記録のcapture欠落、HAR／DOM欠落、停止未確認、隔離途中の失敗をこの条件で免除しない。採用失敗をpassed／failed／partialの通常結果へ置換しない。

reportはHATEへ列挙された最終結果とreceiptのsnapshotだけを読み、同じbindingと不整合拒否規則で検証する。未採用媒体のsourceと固定reasonを「媒体を保持できなかった理由」として表示する。区分とredactionを継承し、private保存先・隔離bytesを含めない。shareでも診断記録を検査済み媒体と表示しない。

## Native identity

`lakda/native-identity-observation/v1`を追加する。platform、bridge binding、app ID、buildの取得値、device digest、observedAt／expiresAt、provider名／version、field別status／sourceを保持する。operator宣言は別objectとし、source=operator-declarationを実観測へ昇格しない。

Windows process／実行file、Android／iOS installed app／device情報はoperator側providerで読み取る。利用API・version・build mappingをprovider単位に固定し、取得不能fieldはdeclared-only／unavailableにする。既存bridgeのCLI宣言と互換なlegacy modeを保持する。新real laneは署名済み条件をbridge接続前に検証し、その後に取得する必須観測が欠落していればaction前に拒否する。

observationは初期action前・resume前・再接続後に取得する。既定60秒、1〜300秒。target manifestに許可されたprovider・required fields・build mapping digestを新versionで束縛する。旧target manifestを新証跡へ流用しない。

### Native observation v1の具体契約

観測は`lakda/native-identity-observation/v1`、最大16 KiBとする。`observationId`と`challenge`はUUID、`platform`はwindows／android／ios。`bridgeBinding`はbridgeDigest・capabilityDigest・connectionIdを持つ。接続IDは接続ごと、challengeは観測要求ごとに新しくし、宣言値や保存済み能力snapshotから補わない。`provider`はname・version、`observedAt`と`expiresAt`はミリ秒付きUTC。全体と各objectで未知fieldを拒否する。

`fields`はappId・appBuild・deviceDigest・platformVersionの4項目を必ず持つ。各項目はstatus・source・valueを持ち、observedでは値を必須にする。declared-onlyではsource=operator-declaration、unavailableではsource=unavailableとし、どちらもvalue=nullにする。宣言値は別の`declared` objectのappId・appRevision・deviceDigest・platformVersionへ置き、未指定はnull。declared-onlyには対応する宣言値が必要である。appBuildの宣言先はappRevisionだが、宣言を実観測build値へ読み替えない。

| platform | appIdの取得元 | appBuildの取得元 | deviceDigestの元情報 | platformVersionの取得元 |
|---|---|---|---|---|
| windows | windows-process-image | windows-executable-sha256 | windows-machine-guid | windows-version |
| android | android-package-manager | android-version-code | android-serialno | android-release |
| ios | ios-installation-proxy | ios-bundle-version | ios-udid | ios-product-version |

この表はproviderの出力契約であり、API実装・接続先の取得・実機動作が完了したことを示さない。platformと異なる取得元は拒否する。appIdは実行fileのbasenameまたは取得済みapp ID、appBuildはWindowsの実行file SHA-256、Androidのversion code、iOSのbundle versionを記録する。パスやraw serialを値へ混ぜない。providerのname／versionは承認された組合せへ照合する。

device digestは`lakda/native-device-digest/v1`のcanonical JSON（schemaVersion、platform、source、identifier）をUTF-8へ変換したSHA-256に`sha256:`を付ける。identifierはproviderが取得した空でない文字列を変形せず用い、前後空白・制御文字・不正Unicodeを拒否する。raw identifierを観測recordや例外へ出力しない。旧CLIのserialDigestと同一の算出規則であるとは推定しない。

`lakda/native-build-mapping/v1`はmappingId、platform、provider、appId、entriesを持つ。entryはobservedBuildとtargetRevisionで、1〜512件、observedBuildの重複は拒否、全体は64 KiB以下。mapping digestは全objectのcanonical JSONに対するSHA-256であり、整形・改行を含むファイルbytesのdigestとは区別する。別app・別platform・別providerのmappingを流用しない。

照合器は検証済みtargetから渡すplatform、appId、targetRevision、deviceDigest、bridgeBinding、許可provider、mapping digestと、今回のchallenge・requestedAt・now・単調時計の経過時間を入力にする。appId／appBuild／deviceDigestは必須observedとし、任意でplatformVersionも要求できる。宣言値があれば実観測またはbuild mappingの結果と照合し、不一致を拒否する。mappingに観測buildが1件だけ存在し、承認targetRevisionへ対応するときに限って受理する。

`requestedAt <= observedAt <= now < expiresAt`、有効期間1〜300秒、設定maxAgeMs（既定60000、1000〜300000）以下を要求する。単調時計の経過時間はmaxAgeMsと`expiresAt - requestedAt`の小さい方より短くなければならない。wall clockとmaxAgeMsは整数、単調時計の経過時間は有限かつ非負とし、performance.nowに対応する小数を許容する。未来の観測、期限の境界と期限後を拒否する。再接続後はconnectionId不一致で旧記録を拒否する。構造・値・bindingの照合成功を、署名承認やproviderが実際にOS／deviceを読んだことの独立証明とは扱わない。provider実装とreal受入は別に必要である。

実行fileのbasename／app IDにはdrive指定、slash、backslash、制御文字、不正Unicodeを許容しない。mappingのappIdとoperator宣言のappIdにも同じ条件を適用する。device digestには固定の人工identifierに対するgolden値を置き、providerの追加時に他言語の実装と照合する。

### Android providerの取得契約

公開前の通信契約は次節のexchange v1に従う。取得providerだけがある段階と、HTTP受渡し、署名済み実行前照合の完成を区別する。

初期providerはname=`lakda-airtest-android`、version=`1.0.0-airtest-1.3.5`とし、接続済みAirtest 1.3.5のdevice.adbだけを使う。operatorのapp IDは照会対象の指定であり、観測値ではない。ASCIIのpackage名を検証してから、固定の`getprop ro.serialno`、`getprop ro.build.version.release`、`dumpsys package <appId>`をADB経由で実行する。package出力内の一意なPackage headerとversionCodeを読み、対象appとの一致を確認する。これはインストール済みappの照合であり、foreground windowの証明とはしない。

端末propertyとpackage情報を再取得し、最初の値と一致するときに観測値を返す。ADB object／接続selectorの変化も検査する。SDK版不一致、未接続、取得失敗、曖昧な応答、不正値はunavailableにし、宣言値で補わない。取得全体の既定予算は5000 ms、指定範囲1000〜15000 ms。各SDK commandに残時間を渡し、取得後にも単調時計の期限を検査する。SDKが返した各応答は1 MiB以下を要求するが、SDK内部のbuffer割当までこの上限で制御したとは扱わない。

SDKのADB command loggingは観測を呼んだthread内で抑制し、他threadのloggingは維持する。SDK例外本文、raw serial、package dumpを公開結果・例外へ転記しない。observation組立てとchallenge／接続IDの受渡しは次節のexchange v1で扱う。署名済みtargetとの照合、初回／resumeへの接続は後述の専用実行経路で行う。platformごとのproviderと実機受入を同じ完了として扱わない。

### Native identity exchange v1

operator bridgeはPOST native-identity-openとnative-identity-observeを追加する。既存capability payloadは変更しない。open要求はschemaVersion=`lakda/native-identity-open/v1`、challenge、bridgeBinding（bridgeDigest／capabilityDigest）、maxAgeMs（1000〜300000）を持つ。serverは実HTTP接続先のloopback host／port／base pathと現在のcapabilityからdigestを計算し、要求と照合する。

open応答は`lakda/native-identity-session/v1`、server発行のconnectionId、同じchallenge、platform、bridgeBinding、issuedAt／expiresAtを持つ。sessionは30秒、未消費は最大32件。SDK device／runtime／ADB object／接続selectorとbindingへ束縛する。observe要求は`lakda/native-identity-request/v1`、connectionId、challengeのみ。一致するsessionをprovider呼出し前に消費し、失敗・接続切替・期限切れでも同じIDを再使用しない。消費後のretryは新しいopenから行い、自動retryは追加しない。

observe応答は既存observation v1とし、server発行のobservationId、今回のconnectionId／challenge、取得開始時刻とmaxAgeMsによる期限を含める。operator宣言を別objectへ固定し、取得不能fieldに宣言があればdeclared-only、なければunavailableとする。providerから返った未知fieldや不正値を公開しない。要求／sessionは4 KiB、observationは16 KiB以内。native HTTP操作はquery／fragmentのないpathと実server portに一致するlocalhost／127.0.0.1のHostだけを受け付ける。

TypeScriptは新challengeを生成し、同じ全体15秒の通信期限でopenとobserveを行う。streamを読みながら容量を検査し、schema・binding・challenge・接続ID・時刻を照合する。観測自体がunavailableでも通信結果として返せるが、必須観測の照合は既存verifierで拒否する。受渡しの完了を署名済みtargetの承認やaction許可にしない。署名済みtarget v2と初回／resumeへの接続は別の必須工程として維持する。

### 署名済みnative target manifest v2

schemaVersionは`lakda/exploration-target-manifest/v2`、platformはwindows／android／ios、adapterIdはairtest-poco、executionModeはrealに限定する。v1の署名payloadと保存済み文書の読取を維持する。v2のtarget.identityはkind=nativeとappIdを必須とし、任意のappRevision／deviceAliasDigest／serialDigestはlegacy宣言との照合専用で実観測の代わりにしない。Webのorigin／path／revisionProbeはv2へ含めない。

必須のnativeIdentity objectはdeviceDigest、allowedProviders、requiredFields、maxAgeMs、buildMappingsを持つ。maxAgeMsは1000〜300000で省略不可。requiredFieldsは重複のない3〜4項目で、appId／appBuild／deviceDigestを必須、platformVersionだけを任意追加とする。allowedProvidersは重複のないname／versionの組合せ1〜16件。buildMappingsも1〜16件とし、各entryはmappingとmappingDigestのみを持つ。mappingは既存build mapping v1を完全に埋め込み、digestはcanonical JSONで照合する。外部mapping pathは受け取らない。

許可providerとmappingのproviderを一対一で対応させる。各mappingはtargetと同じplatform／appIdであり、承認targetRevisionへ対応するbuildを少なくとも1件持つ。観測providerに一致するmappingを選択し、既存verifierで実際のbuildの対応先を照合する。他revision向けentryの存在は許容するが、そのbuildの観測を今回のtargetRevisionとして受け入れない。各mappingの既存64 KiB上限に加え、v2文書全体は256 KiB以下とする。

v2の署名payloadは文書のコピーからsignature.signedPayloadDigestとsignature.valueBase64だけを除外したcanonical JSONとする。algorithm、keyId、validFrom、validUntil、approvalEvidenceRefも署名対象となる。承認期間はミリ秒付きUTCでfrom < until、from <= 検証時刻 < untilを要求する。trust storeの同一keyIdが複数あれば曖昧として拒否する。v1のpayload規則は変更せず、v1へnativeIdentityを後付けした文書を拒否する。

署名検証済みv2と今回のacquisitionから、署名済みdevice／provider／mapping／必須field／期限を観測照合へ渡す。通信で得たchallenge・connectionId・時刻を署名済みpolicyの代わりにしない。CLIは後述の専用経路で観測・操作制御・保存を接続する。未対応の連続撮影を含む設定は接続前に拒否する。既存v1の読取成功を新identity受入完了とは扱わない。

共通target loaderのv2受理にはnativeIdentityPolicy=validate-onlyを明示する。省略時はv1読取を維持し、v2を拒否する。これは文書検証の指定であり、実行許可や保存済み観測証跡の検証済み表示を許可する指定ではない。HATE／reportは専用readerで保存観測も照合し、CLIは専用runtimeへ接続する。acceptance等の未接続readerの既定拒否は維持する。

### 観測に束縛したnative操作

operator bridgeはPOST native-actionを追加する。要求はschemaVersion=lakda/native-action-request/v1、operation=execute／recover、lease、ordinal、payloadを持つ。leaseはobservationId・observationDigest・connectionId・challengeのみ、ordinalは1から始まる連続整数とする。payloadはexecuteならcandidate／context、recoverならfailure／context。要求は64 KiB以下で未知の外側fieldを拒否する。通常のexecute／recoverの公開契約へ新fieldを後付けしない。

bridgeは必須3項目がobservedである記録に限り、そのcanonical digestとSDK接続marker、capability、宣言、Poco参照を非公開leaseへ保存する。未失効leaseは最大32件、期限は観測開始時刻と共通の単調時計開始からmaxAgeMsとする。期限切れentryは次の登録時に除去する。満杯なら登録を拒否し、古い有効leaseを追い出さない。観測providerの完了後に容量拒否となる場合もある。

native-actionはbridge単位で同時操作を拒否する。要求の連番をSDK操作前に消費し、同じ要求を再実行しない。期限、接続marker、capability、宣言、Airtestの現在選択device、Poco参照を確認する。candidateの再観測・準備にも時間がかかるため、SDK呼出し直前にもう一度確認する。tap／backは観測したdeviceの固定methodを呼び、Poco操作はdevice・ADB・agentが同じ対象へ束縛されていることも確認する。復旧操作も同じ検査を通す。

応答はlakda/native-action-result/v1、operation、lease、ordinal、checkedAt、actionAttempted、resultを持つ。resultの既存execution／recovery契約は維持する。actionAttemptedは実SDK操作の呼出し開始を表し、成功や物理的効果の証明ではない。SDK呼出し後にも照合し、開始後の例外・期限切れ・接続差は実行成功とせず、actionAttempted=trueを残す。SDK内部の任意時点でのatomicな停止や操作取消しを保証するものではない。失敗したleaseは破棄し、新しい観測なしに継続しない。

Node側は既存の署名済みpolicyとacquisitionを検証してからこの経路へ接続する。応答のschema・operation・lease・ordinal・時刻と既存resultを照合し、通信失敗を自動retryしない。serverの確認応答はoperator署名の代わりではなく、sessionへ保存する対象・観測・操作の対応証跡になる。session保存とHATE／report側照合を必須とし、未接続の汎用readerではv2を拒否する。

現在の低水準native-action APIは署名済みpolicyの自動適用やsession証跡の保存を代行しない。明示的な文書検証・観測照合と組み合わせる。要求はNode facadeの最初のawait前にsnapshotへ固定する。SDK object／selectorを変えない内部再接続の検出には実transportの接続世代が必要であり、その取得実装と実機検証が完了するまで再接続要件を完了扱いにしない。

### 承認期限の操作直前への伝播

署名済みtargetを使う実行wrapperは、target文書の実bytes、Charter、config digest、operator trust keyを最初のawait前に複製し、v2署名とbindingを観測前に検証する。観測取得の直前から単調時計を保持し、openの時間も含む保守的な経過時間で毎操作・復旧の前後にidentityと承認期限を照合する。期限の起点を操作ごとに更新しない。要求の同時実行、失敗後の継続、自動retryは認めない。

native-action v2はv1と別schemaとし、approvalWindow（targetManifestSha256、validFrom、validUntil）を必須にする。sha256は署名payloadではなく検証したtarget文書の実bytesのdigestとする。要求と応答に同じwindowを保持し、bridgeはlease最初の要求でversionとwindowを固定する。途中のv1への変更、target差替え、期限の変更はleaseを破棄して拒否する。既存v1要求にwindowを追加して受け入れない。

bridgeはwindowの正規UTC時刻とfrom < untilを検査し、最初の受理時に残り時間から単調時計の期限を固定する。各guardでfrom <= wall clock < until、単調時計の期限未到達、同leaseの前回検査からwall clockが逆行していないことを確認する。candidate準備中の失効はSDK呼出し前に拒否する。SDK開始後の失効はactionAttempted=trueの失敗として残し、取消し成功とはしない。

windowはNode側で検証した承認期間を制限として伝えるもので、bridge単体がoperator署名を検証する機能ではない。低水準APIだけの成功を署名済み実行や受入完了とは扱わない。CLIは署名済みexecutorと必須sinkを通し、未対応設定の接続前拒否と未接続readerの既定拒否を維持する。

native protocolのWindows UTC時計はGetSystemTimePreciseAsFileTimeを使い、FILETIMEから整数演算でミリ秒へ変換する。利用不能なら粗い時計へfallbackせず拒否する。他platformはtime.time_nsの整数変換を使う。期限の単調時計をUTC時計で置換しない。Python 3.12のtime.timeの分解能が約15.6msである環境では、観測時刻がNodeの要求時刻より古く見えることがあるため、この用途では使わない。

Nodeはsession issuedAt、observation observedAt、action checkedAtが現在のUTC時計より先なら、差が20ms以下の場合だけ同じAbortSignalの下で20msの待機を一度行い、実時刻を読み直す。timestampを補正せず、待機後も未来・要求前・期限切れなら拒否する。待機とevent loopの遅延も既存の共通15秒・観測maxAge・承認期限へ含める。20msを超える未来のtimestampは待機せず拒否し、HTTPやSDK操作を再実行しない。これは待機の上限設定であり、異なる時計の一致を保証する許容誤差ではない。2msだった旧条件では、正常HTTP応答の発行時刻がNode受信時刻より5ms先に見える相互運用失敗を確認した。

### Android transportの接続世代

Androidのnative sessionは、SDK object／selectorに加えて、ADB transport IDと継続中のADB接続へ束縛する。operatorが起動済みのADB serverへhost:track-devices-lを送り、その接続を保持する。各照合ではhost:devices-lでも選択端末の現在状態とtransport IDを確認する。device状態の一意なselectorと正の64 bit transport IDを要求する。切断・offline・重複selector・ID変更・取得不能・不正frameは旧接続の失効として扱い、設定値から成功を補わない。

接続先は固定Airtest 1.3.5のADB objectから読み取ったhost／port／adb_path／cmd_optionsへ一致させる。hostは127.0.0.1、localhost、::1だけを許可し、localhostはIPv4 loopbackへ接続する。SDKの既定形式と一致しないcommand options、およびADB_SERVER_SOCKET・ANDROID_ADB_SERVER_ADDRESS・ANDROID_ADB_SERVER_PORTが定義された環境は、SDKと照合先の不一致を避けるため拒否する。これらの値やraw selector、他端末の一覧を公開しない。ADBの起動・終了・再接続commandやdevice commandはこの取得処理から送らない。

同じSDK接続のopenは1本の監視接続を共有する。監視は有界frameを読む1 threadとし、受信内容全体を蓄積しない。SDK選択変更や監視の切断では旧監視を閉じ、古いsession／leaseは同じSDK object・同じtransport IDが後で現れても再使用しない。失効を検出した要求内で接続を自動retryせず、後続の新しいopenで再取得する。監視の保持期間は最後のopenからsession期間と観測maxAgeの合計以内を基本とし、保持期間の更新で既存の承認・観測期限を延長しない。bridge終了時は監視を閉じ、thread停止を確認する。

idle期限はbackground監視だけでなく照合の前後と保持期間更新でも検査し、期限後の更新による復活を許容しない。監視cacheのlock取得は500msで打ち切り、session登録のlockを保持したままnetworkを待たない。32件のsession上限は監視取得前と登録直前に検査する。監視停止を確認できない場合は置換せず拒否する。

ADBのOKAYと4桁hexのlengthを厳密に読み、1 frameは65,535 bytes以下、端末行は256件以下とする。handshake・query・受信開始済みframeは共通の単調時計500ms以内とし、細切れ受信ごとに期限を更新しない。未知serviceへのfallback、再接続・再送は行わない。操作／復旧はSDK直前と返却後にも監視と現在のtransportを確認する。SDK内部の任意時点でのatomicな停止や物理操作の取消しを保証するものではなく、SDK開始後の接続差はactionAttempted=trueの失敗として残す。

この接続世代はbridge内の非公開stateと既存connectionIdへ束縛する。新しい公開raw端末識別子を追加しない。Windows／iOS providerと実機、連続撮影の接続世代の検証は残り、AC-UP-008／022の未完了を維持する。CLI接続のfixture成功をそれらの受入へ転用しない。

### native実行証跡の保存順序

native実行の保存は、署名済みtargetの実bytesのdigest・session ID・Charter digest・config digestへ束縛する。観測の取得後に観測記録を保存し、各操作では操作予定を保存してからSDKへ送信し、検証済み応答または応答未取得の終了記録を保存する。記録は新しいversioned契約とし、旧v1観測やtargetの署名payloadを変更しない。

操作予定には要求全文を保存しない。request SHA-256、operation、ordinal、lease、承認window、executeのcandidate IDとsource fingerprintだけを保持する。selector・input値・command・raw failure本文は含めない。終了記録には開始時刻、終了確認時刻、検証済みreceiptまたはnull、actionAttempted=true／false／unknown、送信・応答・操作後の期限検査までのexecutionStatus=completed／failedを保存する。receiptの成功とexecutionStatus=failedは両立する。例えばSDK開始後に承認期限が失効した場合、receiptを保持して失敗を記録する。executionStatusはその記録自体の保存完了や呼出し元への成功返却を証明せず、終了記録の保存で後から失敗しても既存記録を書き換えない。

観測・予定の保存後に承認・観測期限を再検査する。観測または予定の保存失敗では新しいSDK操作へ進まない。送信前検査の失敗はactionAttempted=false、送信後に検証済みreceiptが得られない場合はunknownとする。終了記録の保存失敗では再送せず停止し、呼出し元へ実行開始の有無と得られたreceiptを保持したerrorを返す。sinkへの通知は各phaseにつき1回とし、失敗した保存を成功として扱わない。

証跡の公開にはschema・容量・secret／PII検査を適用する。公開できない文字列を含むreceiptを黙って書き換えて同じdigestと呼ばない。記録不能なら操作を停止し、保存済みの予定が未完了であることを検出可能にする。session内のimmutableなJSONと既存checkpoint eventのversioned参照で順序を結び付ける。referenceだけでfile bytesを検証した扱いにせず、readerがsession binding、digest、観測の期限・provider・mapping、予定とreceiptのlease／window／ordinalを再照合する。

未完了の予定、重複・飛越し・逆順、別session／targetの記録、schema／digest不一致は再開・証跡受入の不足として扱う。記録のない旧target v1からnative観測済みを推定しない。CLI・再開とHATE／reportは同じ保存証跡readerを通し、不足を暗黙の再取得・fork・再実行で補完しない。

### native journalの入出力と検証範囲

保存契約は`lakda/native-execution-evidence/v1`とし、binding、journalId、sequence、evidenceを持つclosed schemaで検証する。phaseはobservation／action-requested／action-finished。保存先はsession直下の`native-identity/<journal UUID>/<6桁連番>.json`とし、連番は1から連続する。checkpointの`nativeEvidenceRef`は`lakda/native-evidence-ref/v1`のversion、path、size、SHA-256、journalId、sequenceだけを持つ。余分なfieldやfile名との不一致を拒否する。

1記録128 KiB、session内の記録合計32 MiB・20,001件、journal最大256個を上限とする。操作予定を保存する前に終了記録1件分の件数・最大bytesを予約する。新journalは過去の記録が整合し、未完了・応答不明がない場合だけ作成できる。過去journalへの戻り、observation ID・connection ID・challengeの再使用を拒否する。

writer／readerは呼出し開始時にsession rootとtargetを複製し、渡された個別file pathは正規のsession pathから再構成する。root・親directory・fileのsymlink／junction、path逸脱、確認したfile identityの差替えを拒否する。読取は32 KiB以下のchunkで行い、読取途中の増大にも上限を適用する。公開は同じdirectoryの排他的な一時fileへ書き、file sync後に上書きしないhard linkで確定する。hard linkを使えない保存先では拒否する。

file確定、bytes再読取、checkpoint追記はこの順に実行するが、1つのfilesystem transactionではない。失敗時は確定済みfileや確認不能な一時fileを消さず、readerが未参照file・途中file・空journalを不足として拒否する。読取中はsession／events／target／Charterを最初と最後で照合し、変化したsnapshotを受理しない。自動修復、孤立fileの自動削除、未知操作の成功への補完は行わない。

reader全体と各recordのI/Oに5秒のAbortSignalを設け、checkpoint追記の前後にも検査する。追記中に期限が切れた場合、追記済みbytesは保持してerrorを返し、次のSDK操作へ進まない。実行中のfilesystem syscall、sessionの追記処理、任意の外部sink callbackを強制中断できることや、OS停止下でも5秒以内に戻ることは保証しない。directory／eventの電源断耐久性も別の検証項目である。

`readSessionNativeEvidence`は保存済みbindingとphaseの整合を検査する内部APIで、target署名・trust keyの検証は呼出し側の責務。`complete=true`は観測が存在し、予定に対応する終了と操作開始の有無が確認できる状態を表す。観測だけで操作0件の場合や確認済みの操作失敗も含み、操作成功、現在のlease有効性、wrapperの成功返却、実機受入を意味しない。保存時刻からの再照合は記録の一貫性を確認するもので、独立した単調時計の実測証明ではない。

### 保存済みnative証跡の署名検証

保存済み証跡の読取では、session／events／target／Charterの4つの実bytesに対するSHA-256を順序付きで束縛し、HATEが保持するsnapshotと照合する。呼出し元の停止signalを読取全体の5秒signalへ合成する。targetはclosed schemaと実bytesのdigestを検査し、最初の保存観測の取得完了時刻におけるEd25519署名・承認期間・Charter／config bindingを確認する。現在の期限切れだけで過去の有効な記録を拒否しない。

署名と保存記録の検証をまとめたreaderは、呼出し元が明示した鍵一覧、または明示したoperator鍵fileだけを使用する。保存済みCharterから暗黙に鍵fileを選ばない。鍵fileは128 KiB、1〜64件、一意のkey ID、Ed25519公開鍵を要求する。呼出し開始時に入力を複製し、鍵fileの使用前後の実bytesを照合する。観測なしでは署名済み観測として受理せず、整合した未完了予定・応答不明はcomplete=falseを保持する。これは実機受入や操作成功を示さない。

HATE／reportへの接続では、署名文書だけを検証してnative観測済みと扱わない。HATEの記録漏れ・孤立file・入力更新を拒否し、reportでは媒体なしの場合も同じ照合を要求する。HTML reportのtrustはoperator指定のreport設定から渡す。CLIのsession JSON reportには実行時と同じ基準で解決したoperator trust pathを渡す。既定loaderのv2拒否は維持する。

### adaptive runnerへのnative bridge接続

native v2でadaptive runnerへ渡すbridgeは、通常execute／recoverを署名済みexecutorへ変換し、各操作をsessionの観測・予定・終了へ保存する。証跡sinkなしでは作成しない。runtimeへ旧execute／recoverまたは低水準nativeActionを迂回路として公開しない。元のbridge methodは作成時に束縛し、呼出し元のobject変更で経路を差し替えない。

観測、candidate取得、証跡撮影、capture開始には承認・観測期限とbridge bindingの前後検査を適用する。同時操作と失敗後の追加操作は拒否し、要求を自動再送しない。captureのstop／discardはcleanupとして期限後も呼べるが、新しい撮影や入力を許可しない。保存済み観測の期限検査だけでSDKの現在の接続世代が検証できたと扱わない。連続撮影のCLI対応には撮影中のSDK接続・停止確認との統合を必要とする。

capture開始を試みた後の前後検査失敗や応答不能では、同じrun／保存先へstopを一度送り、acceptedかつstoppedを確認する。停止の拒否・例外・不明はnative-bridge-capture-stop-unconfirmedとして返す。保存済みfileを消したり、撮影が止まったと推定したりしない。開始要求自体を送っていなければcleanup要求も送らない。

### CLI初回・draft・paused resumeへの接続

native v2の初回は、署名検証済みtargetのコピーとsessionへのdigest記録を行い、保存bytes・署名・Charter／config・operator trust・native inventoryを接続前に照合する。その後capabilityを取得して既存bindingを照合し、必須sink付きbridgeから新しい実観測を保存して探索へ渡す。旧capability内の申告fieldを観測値へ読み替えず、独立した観測記録を保持する。

draft resumeは、既存target・capability・configの照合を維持し、native記録がまだなければ最初の観測を保存する。paused resumeは過去journalが存在しcompleteであることを接続前に要求する。未完了の予定・応答不明・欠落・改変は拒否する。再開では新しいchallenge／connectionId／observationを別journalへ保存してから既存replay prefixとcheckpointの再照合を行う。targetの差替え、承認の自動更新、旧観測の再利用、暗黙forkは行わない。

相対trustStorePathは元targetManifestPathの親directoryを基準に解決する。session内へコピーしたtargetの親を基準にしない。CLIの実行、媒体検証、JSON reportとHATEにはこのoperator pathを渡す。保存済みJSON reportの生成時は最初の観測時点の署名を照合し、現在の承認期限切れだけでは過去記録を拒否しない。HTML reportは引き続きreport設定の明示trustを使う。

checkpointの最後のfingerprintは、最後の操作応答にpostFingerprintがあればそれを使い、なければその操作に続くpost-action観測から取得する。過去の別操作のfingerprintで最後の観測欠落を補完しない。trace／replay-traceのdigestと既存resume検証は維持する。

現在のCLI接続はvideo=offかつsampledFrames.enabled=falseを対象とする。連続撮影を含むnative v2は接続前に未対応理由を返し、設定を自動でoffにしない。finding／non-passの単発画像もnative-captureとv2 journalへ接続し、媒体署名の検証を維持する。連続撮影のCLI統合と実SDKによる媒体の同一接続確認、Windows／iOS provider、実機受入は後続に残る。この段階的制限を最終要件の縮小やAC-UP-008／022の完了と扱わない。

## Plan

### 撮影を含むnative journal v2と実行側への接続

新しい保存記録は`lakda/native-execution-evidence/v2`と`lakda/native-evidence-ref/v2`を使い、v1の記録・参照は旧上限のまま読み取る。v2は観測・操作要求・操作終了に加え、`capture-requested`と`capture-finished`を同じjournalとcheckpoint列へ保存する。journal内でv1／v2を混在させない。v2の1記録は4 MiB＋16 KiB、journal全体は既存32 MiB・20,001記録・256journal上限を維持し、要求保存時に対応する終了記録の余地を確保する。

撮影要求の保存には、実際の要求全体のSHA-256、要求時刻、operation・lease・window・ordinal・captureOrdinal・runId・mode・撮影上限とstaging pathのSHA-256を使う。絶対staging pathを保存記録へ載せない。終了にはdispatch開始時刻（未送信ならnull）、終了時刻、完了／失敗、検証済み応答またはnullを保存する。要求を書けない場合は新しい撮影を送らず、終了を書けない場合は次の撮影・入力を止める。

独立readerは、同じ署名済みtarget・観測・承認window、時刻順、撮影専用連番、要求digest、元の開始識別子・保存先digest・run・mode、応答と媒体参照を照合する。開始中／停止未確認、未対応の要求、配送不明の単発画像があればcompleteとしない。開始応答が失われても同じ開始識別子への停止が確認できれば撮影終了を確認できるが、保存されていない画像の成功を補完しない。

開始・画像取得には要求保存の前後と応答後に署名・観測期限を検査する。stop／discardは元の撮影に限り、期限切れ・入力停止後も許可する。保存不能でも必要な停止は試み、証跡を保存できなかった状態を成功へ変えない。配送不明により未消費の連番があっても、停止がその番号の穴で妨げられないようにする。開始拒否で自身のactive状態が存在しないことを確認できる場合はstopped=true、開始不明で状態を保持する場合はstopped=falseを返す。

署名済みexecutor／facadeはキャッシュしたnativeCaptureだけを使い、旧capture endpointへfallbackしない。開始後の応答・検証・保存の失敗では、元の撮影へ停止を一度試み、停止未確認を別の失敗として返す。撮影中の入力は許すが、要求処理の同時実行は拒否する。署名したCharterの撮影mode・上限を超える要求は送らない。HATE／reportはv2の保存記録も独立検証し、実機受入とCLI連続撮影の制限解除はその接続確認後に判断する。

readerも署名対象digestと一致する保存Charterの撮影設定を照合する。videoはretain設定の場合だけ開始可能、sampled framesはenabledかつoperator-bridgeの場合だけ開始可能とする。sampledのintervalは設定値以上、maxFrames・maxBytes・stopTimeoutは設定値以下を要求する。videoの停止待機は既存既定5,000ms以下とし、新しい任意の長時間待機を許可しない。旧v1の操作記録には新しい撮影fieldを要求しない。

応答の到着が期限後になった場合も、要求・送信開始が有効なら失敗として記録できる。executionStatus=failedの応答を承認内に完了した撮影へ読み替えず、次の開始・画像取得・入力は停止する。元の録画を止めた記録が揃えばjournalの終了を確認できるが、媒体の検査・公開許可とは別である。accepted=trueの開始応答にstopped=trueが同居する矛盾は拒否し、元の停止先を失わない。画像取得の失敗時に既存録画があれば同じ停止処理を一度試みる。停止を実行できても保存に失敗したjournalは未完了のままにする。

Task 62の実行testと必要fix→Task 67のhandoff／Task 68のidentity→Task 69のreal受入。

## Patch

bridge／capture、追加schema、対応検証だけを変更する。operator-managed境界、既存mode、QEG責務を維持する。

## Tests

AC-UP-001〜005、008、022。fixture契約と実機3laneを別記録する。実機APIの動作はfixtureから証明しない。

## Commands

Python実行wrapper、関連Playwright契約test、typecheck、check、pack:check。realは承認target／trust／corpusが揃ったlaneでだけoperatorが実行する。

## Notes

lock未取得、scanner未提供、実機未提供を成功扱いにしない。外部条件待ちでもlocal test／実装は進められる。
