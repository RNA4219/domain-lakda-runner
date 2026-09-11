---
task_id: TASK.20260910-68
intent_id: INT-LAKDA-UP-001
specification: ../spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md
status: in_progress
owner: RNA4219
created_at: 2026-09-10
updated_at: 2026-09-11
---

# Task Seed: native identity実観測・照合

## Objective

対象仕様: [実装仕様](../spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)。

native identity実観測・照合を[仕様](../spec/verification-reports/README.md)と[要件](../proposals/20260910-detailed-requirements.md)に従って実施する。対象はSPEC-02。

## Scope

対象path:
- `tools/airtest-poco-bridge/**`
- `src/exploration/target-manifest.ts`
- `src/exploration/native-identity*.ts`
- `src/exploration/contracts.ts`
- `src/exploration/session.ts`
- `src/exploration/attestation-contracts.ts`
- `src/exploration/attestation-inventory.ts`
- `src/core/artifact-policy.ts`
- `src/core/hate.ts`
- `src/commands/exploration.ts`
- `src/adapters/external-bridges.ts`
- `src/adapters/loopback-json.ts`
- `src/reporting/native-evidence.ts`
- `src/reporting/session-snapshot.ts`
- `src/reporting/session-source.ts`
- `src/reporting/source-collection.ts`
- `src/reporting/source-verifier.ts`
- `src/reporting/generation.ts`
- `src/reporting/media-target.ts`
- `schemas/lakda-native-*.schema.json`
- `schemas/lakda-exploration-*.schema.json`
- `schemas/lakda-binary-attestation-request-v1.schema.json`
- `tests/native-identity*.spec.ts`
- `tests/python/test_native_identity*.py`
- `tests/python/test_capture*.py`
- `tests/binary-attestation.spec.ts`
- `tests/attestation-contracts.spec.ts`
- `tests/attestation-run.spec.ts`
- `tests/airtest-poco-bridge-contract.spec.ts`
- `tests/python/bridge_fixture.py`
- `tests/python/native_transport_fixture.py`
- `scripts/check-package-contents.mjs`
- `scripts/check-package-install.mjs`
- `tests/exploration.spec.ts`
- `tests/report-native-identity.spec.ts`
- `tests/helpers/native-evidence-fixture.ts`
- `examples/**`

上記path以外のsource変更が必要になれば先に本Seedを更新する。既存auth state・secret・historical証跡を変更しない。

## Dependencies

- [Task 62](TASK.20260910-62.md)

## Plan

次工程は撮影journal v2、独立verifier・保存／読取、署名済みexecutor／facadeへの接続。撮影先の生pathを記録せず要求全体のdigestを保持し、期限後cleanup、配送不明による連番の穴、保存失敗時の停止を試験で先に固定する。v1の記録を読み取り、v2を同じHATE／report検証へ接続する。CLIの連続撮影制限は別途受入まで維持する。

進行中の追加工程: native-capture HTTP v1の要求・応答を厳密検証し、撮影専用連番、開始連番に束縛した停止、期限後cleanup、直前応答の再送をPython本体とNode clientで接続する。先にfixture試験を追加し、実HTTP相互運用と配布検査を行う。署名済みfacadeとsession journalはこの通信契約に接続してから連続撮影のCLI制限解除を判断する。

連続撮影では、観測leaseとv2承認windowを検証したcapture guardをbridge内部へ渡す。各snapshot前後でleaseの登録状態・接続・期限を再確認し、接続済みADBのsnapshot APIから取得したbytesだけを保存する。録画は固定SDKのYosemite backendとADB参照を保持し、残りの承認・観測時間を切り下げた秒数をSDKのmax_timeへ渡す。背景監視で失効を検出したら新しい取得を止める。停止だけは期限後も許すが、元のADB・selector・recorder・transport世代を確認できなければ停止未確認とする。停止threadのtimeout・失敗を成功へ補完しない。この内部接続の後にversioned HTTP／Node受渡しとsession証跡を接続し、それらが完成するまでCLIの連続撮影拒否を解除しない。

最初に観測記録v1とbuild mapping v1、純粋な照合器を実装する。platformごとの取得元、observed／declared-only／unavailable、別objectの宣言値を固定し、bridge／capability digest・接続ID・challenge・取得期限・許可provider・mapping digestを照合する。appId／appBuild／deviceDigestはreal照合の必須観測とする。宣言値だけで照合を成功にしない。取得APIのprovider、bridge endpoint、target manifest v2、初回／resume／再接続への接続は後続の同Taskで実装し、契約検証だけを実機情報の取得完了としない。新schemaは既存v1署名payloadへ後付けしない。

次にAndroid providerをoperator bridgeへ実装する。固定Airtest 1.3.5の接続済みADBで、対象packageのinstalled buildと端末propertyを読取り専用で取得する。コマンドは固定し、対象package名を検証する。取得前後の端末／build一致、共通の単調時計予算、SDKログからのraw識別情報除外をfixtureで検証する。SDK未対応・値の欠落・不整合はunavailableとし、operator宣言を観測値へ代入しない。公開endpointと署名済み実行経路への接続、Windows／iOS providerは同Taskに残す。

bridgeとの受渡しはnative-identity-open／native-identity-observeの2段階で行う。open時にHTTP接続先とcapability digestを照合し、server発行の一回用connectionIdへSDK接続を束縛する。30秒・32件の有界sessionを観測前に消費し、接続切替・capability差・期限外・再使用ではproviderを呼ばない。TypeScript側も同じchallengeとbinding、時刻、schema、容量を検証してから観測記録を返す。署名済みtarget v2と初回／resumeへの接続が完成するまでは、通信経路の検証だけでreal実行前の照合完了としない。

次の変更単位でnative専用target manifest v2を追加する。許可providerごとに1件のbuild mappingとcanonical digestを文書内へ埋め込み、端末digest、必須field、maxAgeMsを署名へ束縛する。v2では署名metadata（algorithm／keyId／承認期間／承認参照）もpayloadに残し、digestと署名bytesだけを除外する。v1のpayloadと読取は維持する。新v2の照合器を実装してもaction直前の実行制御と保存証跡が未接続なら、CLI preflightで接続前に拒否する。

既存HATE／report／acceptance readerへの段階導入も制御する。共通loaderでv2の署名・policyだけを検証する場合はnativeIdentityPolicy=validate-onlyを明示し、既定のreaderではv2を拒否する。CLI preflightは明示検証の後に未接続の実行制御を拒否する。署名文書が正しいだけで保存済みnative観測の照合まで完了した扱いにしない。

次にoperator bridgeのnative-action経路を実装する。観測に対応する有界leaseを保持し、要求のobservation digest・接続ID・challenge・連番を検証する。candidate再観測の前後とSDK操作直前で期限・SDK選択・接続・capabilityを再照合し、通常操作と復旧の両方を観測したdeviceへ束縛する。leaseごとの要求再使用と同時操作を拒否し、SDK呼出し開始後の失敗はactionAttemptedで区別する。新経路とNode側照合を検証した後も、署名済み実行接続とsession保存・読取が完成するまでCLI／既定readerの拒否は解除しない。

低水準APIの後は、署名済みpolicy・承認期限をSDK操作開始まで束縛する実行wrapper、実transportの接続世代、sessionへの観測・操作応答の保存とHATE／report照合を接続する。観測leaseの期限だけでoperator承認期限の継続適用まで完了したとしない。

承認期限の伝播ではnative-action v2と署名済み実行wrapperを追加する。bridge側のwindowは追加制約として扱い、operator署名検証はNode側で観測前と操作前後に行う。target実bytesのdigest、window、lease、連番を結び付け、期限境界・時計逆行・準備中失効・version変更・不正応答をfixtureで検証する。実transport世代とCLI／sessionへの接続は続けて同Taskで扱う。

続いてversionedなnative実行証跡をsession内へ保存する。観測、操作予定、操作終了の順に記録し、SDK呼出し前の保存失敗では操作0件とする。request本文・入力値は保存せず、request digestとlease／window／candidate照合参照を保存する。応答は同じ共通verifierで再照合し、署名済みtarget・session eventの参照・file digestへ束縛する。書込途中・記録未完了・応答不明は成功へ補完しない。証跡sinkを署名済みwrapperへ接続してから、CLI初回／resume、HATE／report readerへ段階的に接続し、完了までは既存v2拒否を維持する。

2026-09-11の相互運用診断では、正常なopen応答のissuedAtがNodeの受信時刻より5ms先で、challenge・platform・bindingは一致した。現在の2ms待機対象から外れて拒否されたため、待機対象を20ms以下・1回20msへ変更して再検証する。timestampや比較式を補正せず、待機後も未来、要求前、期限切れを拒否する。待機で共通予算を更新せず、HTTP／SDKの再試行は追加しない。

次に保存済みnative証跡へ署名・trustの検査を接続する。記録した観測時刻における署名済みtargetの有効性を検査し、現在の期限切れだけで過去の正当な記録を無効化しない。readerはsession／events／target／Charterの実bytesのdigestを返し、HATE snapshotと再読取が同じ入力であることを照合できるようにする。呼出し側の停止signalも既定5秒の読取期限へ合成する。

HATE生成はnative v2の整合不良を空のattestor allowlistだけへ置き換えず拒否する。レポートは媒体の有無にかかわらずnative v2の署名・保存観測を検証し、operator指定のreport trustだけを使う。記録は整合するが応答不明／予定未完了の場合、完了済み操作や実機受入へ昇格せず診断状態を保持する。入力更新・孤立file・HATEからの記録欠落も検査し、CLI初回／resumeの拒否解除は実行接続が完成するまで別工程として維持する。

次にadaptive runnerへ渡すnative bridgeを作る。通常execute／recoverは必ず署名済みexecutorを経由し、session証跡sinkを必須にする。旧execute／recoverや低水準nativeActionをruntimeへ公開しない。観測・candidate取得・撮影開始の前後に保存観測と承認期限・bridge bindingを再照合し、失敗後の追加操作を止める。期限後も開始済みcaptureのstop／discardは可能にする。CLIへの導入では、再開前の保存証跡検査、実観測によるcapability補完、capture中の接続世代を検証してから既存v2拒否を解除する。

CLI導入では、検証済みtargetの保存とsessionへのdigest記録を先に行い、operator trustと保存済みnative journalを接続前に検査する。初回とdraftは操作前に新しい観測を保存し、paused resumeは過去journalの整合・完了を確認してから別journalへ新しい観測を保存する。設定・署名・必須観測・device／buildが不一致ならSDK操作0件とする。relative trustは元target manifestの親directoryを基準に解決し、コピーしたsessionの親へ読み替えない。既存report readerの暗黙trust選択は変えず、CLIから解決済みoperator pathを渡す。

連続撮影のSDK接続世代との統合は同Taskの後続に残す。今回のCLI接続ではvideoまたはsampled framesが有効なv2は接続前に理由付きで拒否し、設定を自動でoffにしない。この段階的制限を最終要件の縮小やCLI全体の完成と扱わず、初回／resumeの操作・保存の検証を先に成立させる。

連続撮影の接続に先立ち、固定Airtest 1.3.5のdevice.start_recording／stop_recordingへbackendを結ぶ。開始時のbackendと停止methodを固定し、途中で共有APIやdeviceが変更されても別backendを停止しない。SDKのAndroid録画はMP4なので、WebMへ拡張子だけ変更しない。既存reportはMP4を読めるため、core artifact判定・HATE・session・媒体受渡しのinventory／mediaTypeへMP4を接続してからdevice録画を有効にする。既存WebMとv1署名payloadの意味を維持し、未知形式をbinary検査済みへ昇格させない。これらの動作確認と、native lease／接続世代に沿った背景撮影の停止は別に検証する。

1. 対象仕様・checklistを読み、変更前の関連testと状態を確認する。
   Androidの接続世代は、operatorが起動済みのloopback ADBへread-onlyのtrack-devices-l／devices-lだけを送って取得する。同じSDK接続では1本の継続接続を共有し、transport ID変化・切断・不正frame・接続設定変更を検出すると旧session／leaseを拒否する。新しいopenでだけ新しい監視接続を取得する。人工ADB peerと実HTTPで再接続、server接続切断時のID再使用、SDK前後の切替、容量・timeout・closeを検証する。
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

- [撮影実行・journal・HTML接続](../spec/verification-reports/NATIVE-CAPTURE-JOURNAL-20260911.md): nativeCaptureを署名済みexecutor／facadeへ接続し、要求・終了をv2 journalに保存する。保存不能でも元の撮影へのcleanupを試み、保存readerも署名対象Charterの撮影設定を照合する。全559件・Python175件、package 592 files／65 schemasと隔離importがpass。CLI pause／resumeの2画像取得とHTML ready、移動後7 files／81,175 bytesのverifyを確認し、32 digestを記録した。CLI連続撮影の統合受入、他platform provider、実機・固定revision・外部受入を継続する。

- [native-capture HTTP・Node相互運用](../spec/verification-reports/NATIVE-CAPTURE-HTTP-20260911.md): 撮影専用連番、元guardに束縛した停止、直前要求の再送、停止後の応答失敗、開始中SDKのlock待機を検証した。全549件、Python173件、package 581 files／63 schemasと実HTTP fixtureがpass。32 digestを保存。次は署名済みfacadeのcaptureEvidence／captureControlと撮影journal・独立readerへ接続する。全体7改修・57要件・22受入条件と、実機・外部受入の残項目を維持する。

- [native撮影guard・背景停止・close](../spec/verification-reports/NATIVE-CAPTURE-GUARD-20260911.md): Python bridge内部へ観測lease・v2 windowの確認と背景停止を接続した。開始応答不明、監視開始失敗、停止timeoutとcloseの順序を検証し、Python160件、全546件、package 575 files／62 schemasがpass。26 digestを保存。versioned HTTP／Node受渡し、撮影要求・停止結果・媒体とsession証跡の照合を次に接続する。CLIの連続撮影制限と実機受入の未完了を維持する。

- [Android録画backend・MP4](../spec/verification-reports/NATIVE-VIDEO-BACKEND-20260911.md): device APIと開始時の停止methodを使い、MP4をinventory／MIME／binary判定／HATEへ接続。先行失敗と旧source文字列検査の修正を保存し、最終全546件、Python143件、package 573 files／62 schemasがpass。27 digestを記録。native連続撮影の接続世代と実機受入は継続中。

- [native CLI初回・再開・保存レポート](../spec/verification-reports/NATIVE-IDENTITY-CLI-20260911.md): 連続撮影offの初回・draft・paused resumeを署名済み操作と必須sinkへ接続した。相対trust、最後の操作後観測によるcheckpoint、期限後のJSON reportを修正。CLI結合5件、最終全544件、package 573 files／62 schemasと隔離importがpass。2 journal／8記録とprefixを含む人工SDK3件を確認した。連続撮影とSDK接続世代の統合、他platform provider、実機受入は残る。

- [native runnerへの操作接続](../spec/verification-reports/NATIVE-IDENTITY-RUNNER-20260911.md): 必須sink付きbridgeから署名済みexecute／recoverへ接続し、従来操作0件を確認した。開始応答中に承認が失効した撮影のstop不足を先行試験で検出して修正。全体539件の後に探索接続1件を追加し、最終native関連84件・型・Lint、package 570 files／62 schemasと隔離importがpass。CLI初回／resumeは未接続で、既存の接続前拒否を維持する。

- [native証跡のHATE／report接続](../spec/verification-reports/NATIVE-IDENTITY-REPORT-20260911.md): 保存観測時点の署名、明示trust、全native参照と4入力の実bytesを照合した。HATEでの改変受理とtextOnlyの無検証readyを先行試験で検出し修正。全体534件、package 567 files／62 schemasと隔離importがpass。操作不明はdegraded、孤立fileの追加は最終読取で拒否する。実行CLIと実機受入は未完了。

- [native証跡保存・読取のローカル検証](../spec/verification-reports/NATIVE-IDENTITY-EVIDENCE-20260911.md): 観測→予定→終了をsessionへ保存し、immutable fileとcheckpoint参照、target binding、時刻、lease／window／ordinalを再照合した。全体527件、Python138件、最終package 561 files／62 schemasがpass。時計差の拒否とcheckpoint追記中の期限切れを先行試験で確認して修正し、診断なしの相互運用で5記録の保存読取・人工操作2回・監視停止を確認した。46 digestを記録した。CLI／resume・HATE／reportへの既定接続、他platform providerと実機受入は残る。

- [Android接続世代のローカル検証](../spec/verification-reports/NATIVE-IDENTITY-TRANSPORT-20260910.md): transport関連22件、Python全138件・全体511件、package 551 files／61 schemasがpass。人工ADBの実TCPから観測・SDK前後のguard、再接続時の旧lease拒否、監視1本と終了確認まで接続した。最終buildのHTTP相互運用は監視1本・query 17回、人工操作／復旧2回・共有API操作0、thread停止を確認。30 digestを保存した。CLI／sessionの保存読取、他platform provider・実ADB／実機受入は継続中。

- [承認期限・UTC時計のローカル検証](../spec/verification-reports/NATIVE-IDENTITY-WINDOW-20260910.md): Python全116件、Node関連44件・全体511件、package 549 files／61 schemasがpass。署名済みwrapper、v2 window、SDK直前の期限、入力snapshot、開始不明時の停止、Windows精密時計を検証した。最終sourceのHTTP相互運用は10回すべてpass。28 digestを保存した。CLI／sessionへの接続と実transport世代・実機受入は継続中。

- [native操作のローカル検証](../spec/verification-reports/NATIVE-IDENTITY-ACTIONS-20260910.md): Python全101件（追加18件）、全体497件がpass。最後の例外秘匿修正後は関連9件・型・Lint、package 544 files／60 schemas、最終buildのPython HTTP → Node相互運用を確認した。人工SDKの操作／復旧2回、共有API呼出し0で、29 digestを保存した。

- [native target v2のローカル検証](../spec/verification-reports/NATIVE-IDENTITY-TARGET-20260910.md): 関連26件・全体489件、package 539 files／59 schemasがpass。人工鍵によるEd25519署名とpolicy・観測照合、初回／draft resumeの接続0、未接続readerのv2拒否を確認した。14件のdigestを記録した。

- [HTTP受渡しのローカル検証](../spec/verification-reports/NATIVE-IDENTITY-EXCHANGE-20260910.md): Python全83件（exchange 15件・HTTP 5件を含む）、TypeScript側476件、package 535 files／58 schemasがpass。Python HTTP handler → Android provider → Node client → 観測照合器のfixtureも5 query／1 provider callで一致した。24件のdigestを保存した。

- [Android providerのローカル検証](../spec/verification-reports/NATIVE-ANDROID-PROVIDER-20260910.md): Python全63件（新規15件）、TypeScript側全468件、package 530 files／57 schemasがpass。実SDKを使う5 queryのfixture probeと、Python／TypeScript digestの3ケース一致を確認した。配布helperの必須化後にもLint／packを実行し、20件のdigestを保存した。

- [観測契約・照合器のローカル検証](../spec/verification-reports/NATIVE-IDENTITY-CONTRACT-20260910.md): native 12件とschema catalog 1件を含む `npm run check` 全468件、offline `npm run pack:check` 529 files／57 schemasがexit 0。source・schema・test・仕様・logの12 digestを保存した。
- 対象HEADは `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`、dirty差分込み。Node 24.11.0／npm 11.6.1による補助検証で、宣言runtimeと固定SHAの受入ではない。

## Notes

local実装／fixture検証と実環境受入を分離する。実target・operator／trust・scanner／実機不足で外部受入が未実施でも、未完了を隠さない。

現在は観測記録の照合、Android SDK取得とHTTP受渡し、target v2の署名・policy検証、観測へ束縛したnative-action、署名済みwrapper、Android transportの接続世代、session証跡sinkと独立reader、HATE／report、runner用bridge、連続撮影offのCLI初回・draft・paused resumeまで接続した。CLIでの操作・保存・再開、相対trust、期限後のJSON reportをfixtureで確認した。

Python bridge内部には、観測lease・v2 windowによる画像取得・録画のguard、元backendの背景停止、停止timeout後の確認、close時の順序を追加した。SDK開始の応答不明と監視開始失敗も状態を保持する。native-capture HTTP v1とNode clientへ接続し、撮影専用連番・開始連番に束縛した停止・直前応答の再送を実装した。署名済みfacadeと撮影のv2 journal保存・独立照合、保存Charterの撮影設定照合、CLIの単発画像とHTML生成まで接続済みである。最新のlocal検証は[撮影journal記録](../spec/verification-reports/NATIVE-CAPTURE-JOURNAL-20260911.md)を参照する。連続撮影の通常run・停止・再開・媒体採用までのCLI統合受入は残るため、連続撮影を含むv2設定のCLI拒否を維持する。Windows／iOS providerと実機3laneも残る。

runner bridgeのbinding検査だけではSDK接続世代の実観測を示さず、内部guardの人工SDK試験だけでも実機受入を示さない。ログ検証は当該threadのADB loggerに限り、起動・他SDK操作の全ログの秘匿を示さない。既存CLI宣言が実観測に変わったとは扱わず、statusはin_progressを維持する。
