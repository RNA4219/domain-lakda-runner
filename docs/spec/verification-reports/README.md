---
document_id: LAKDA-SPEC-UP-INDEX-001
status: active
last_updated: 2026-09-11
---

# 実行検証・生成レポート仕様

利用フローの確認: [CLI実行からレポート・画像・動画を確認するまで](USER-FLOW-20260911.md)。既存参照アプリの正常／失敗と過去保存runを使い、失敗手順から全体証跡へ辿りにくい点を修正した。全579件、Chrome／Edgeの40ケース、配布物検査がpass。Windowsの深い保存パスの表示制約と、普段の実targetが未指定である範囲も記録した。

Airtest基準レビューへの対応: [手順・失敗・画像を追うUI調整](AIRTEST-ADJUSTMENT-20260911.md)。AR-01〜03の操作・対象・判定の表示、失敗手順と前後への移動、PCの左右配置と狭幅の縦配置を実装した。日英の画面を保存し、全577件、Chrome／Edgeの8条件40ケース、offline配布物検査がpass。[改修前のレビュー](AIRTEST-REVIEW-20260911.md)は経緯として残す。

UIレビュー指摘の対応: [動画操作・資料不足の案内・媒体への導線](UI-REVIEW-FIXES-20260911.md)。UIR-01〜03と検証中に見つけた画像縮小時の枠超過を修正した。日英の関連21件、全571件、Chrome／Edgeの媒体40ケースがpass。単独再実行前のtimeoutも記録した。

UIの再レビュー: [生成物・保存画面・操作記録の照合](UI-REVIEW-20260911.md)。200%時の動画操作、資料不足と警告の説明、媒体までの到達しやすさにP2を3件記録した時点の記録。修正後の確認範囲は上記の対応記録を参照する。

UI調整: [基本レポートの配色・一覧・詳細](UI-ADJUSTMENT-20260911.md)。白基調と概要の開閉、保存メッセージの一覧表示、詳細の固定した閉じる操作を日英で確認した。最終全566件とChrome／Edgeの媒体40ケースがpass。

表示言語の追加: [日本語・英語のレポート出力](REPORT-LANGUAGE-20260911.md)。CLIと設定で言語を選び、既定値は日本語とする。自動生成・再生成、元メッセージの保持、旧bundle互換を確認した。全564件とpackage 592 files／65 schemasがpass。

基本レポートの仕上げ: [概要・失敗理由・画像と動画の確認](BASIC-REPORT-20260911.md)。比較・開発用テスト集約・レポート履歴管理を保留とし、狭い画面の余白を修正した。修正後の全559件、Chrome／Edgeの媒体40ケース、移動後のbundle verifyがpass。人工入力の表示サンプルと確認記録を保存した。

撮影の保存・runner接続: [撮影実行・journal・HTMLレポート](NATIVE-CAPTURE-JOURNAL-20260911.md)。署名済みnativeCapture、v2 journal、保存Charterの撮影設定照合、失敗後cleanupを接続した。全559件、Python175件、package 592 files／65 schemasがpass。CLI pause／resumeの2画像取得とHTML ready、移動後のbundle verifyを確認した。CLI連続撮影と実機・固定revision受入は継続中。以下の記録は各検証時点の範囲を示す。

撮影の通信接続: [native-capture HTTP・Node相互運用](NATIVE-CAPTURE-HTTP-20260911.md)。撮影専用連番と開始識別子、直前応答の再送、元guardの停止・期限後cleanupを実装した。全549件、Python173件、package 581 files／63 schemas、実HTTP fixtureがpass。署名済みfacadeと撮影journal・独立照合、実機受入は継続中。

前段の内部接続: [観測guard・背景停止・close](NATIVE-CAPTURE-GUARD-20260911.md)。leaseと承認に沿う画像取得・録画監視、停止timeout後の同じworkerの待機、終了順序、開始応答不明と監視開始失敗の保持を実装した。追加17件を含むPython160件、全546件、package 575 files／62 schemasがpass。同記録時点ではHTTP／Node受渡しと撮影証跡の保存・照合、実機受入は継続中だった。

録画基盤の追加検証: [Android録画backend・MP4](NATIVE-VIDEO-BACKEND-20260911.md)。接続済みdeviceの録画APIと開始時の停止methodを固定し、MP4のinventory／MIME／binary判定／HATEを接続した。最終全546件、Python143件、package 573 files／62 schemasがpass。nativeの連続撮影とSDK接続世代の統合、実機受入は継続中。

CLIの追加検証: [CLI初回・再開・保存レポート](NATIVE-IDENTITY-CLI-20260911.md)。連続撮影offの初回・draft・paused resume、相対trust、操作後のcheckpointと期限後のJSON reportを検証した。CLI結合5件、最終全544件、package 573 files／62 schemasと隔離importがpass。連続撮影のSDK接続世代との統合、他platform provider、実機受入は継続中。

前段のrunner検証: [操作接続と撮影停止](NATIVE-IDENTITY-RUNNER-20260911.md)。全体539件の後に探索接続1件を追加し、最終native関連84件、package 570 files／62 schemasと隔離importを確認した。通常探索へbridgeを注入して操作・保存と従来操作0件を検証した。同記録時点ではCLIへの接続は未完了だった。

前段のreport検証: [保存時の署名とHATE／report接続](NATIVE-IDENTITY-REPORT-20260911.md)。全体534件、package 567 files／62 schemas、隔離importをlocalで確認した。媒体なしでもoperator trustと保存観測を検証し、結果不明はdegraded、記録不正・欠落・孤立fileは拒否する。

前段の保存検証: [session証跡の保存・独立読取・時計差と保存期限](NATIVE-IDENTITY-EVIDENCE-20260911.md)。全体527件、Python138件、package 561 files／62 schemas、人工HTTP経由の5記録と操作／復旧をlocalで確認した。配布へのPython cache混入も拒否する。これらは同記録時点の証跡である。

前回のnative追加検証: [Android接続世代・観測／操作guard・監視の停止](NATIVE-IDENTITY-TRANSPORT-20260910.md)。transport関連22件、Python138件・全体511件、package 551 files／61 schemas、人工ADBを含むHTTP相互運用をlocalで確認した。同記録時点のCLI／session保存読取、他platform provider・実ADB／実機受入は未完了だった。

native操作の追加検証: [承認期限の伝播・署名済みwrapper・UTC時計](NATIVE-IDENTITY-WINDOW-20260910.md)。Python116件・全体511件、package 549 files／61 schemas、HTTP相互運用10回をlocalで確認した。実transport世代・CLI／session接続・実機受入は継続中。

要求正本は[改修要件](../../proposals/20260910-detailed-requirements.md)。初期版から実環境受入までの7件を維持する。各仕様は対応checklistを1件持ち、全体の受入期待値は[詳細AC](../../proposals/20260910-detailed-checklist.md)を参照する。

| 仕様 | 担当 | checklist | Task |
|---|---|---|---|
| [SPEC-01](SPEC-01-REPORTING.md) | IMP-07、COM | [CHK-01](CHECKLIST-01-REPORTING.md) | 64、65 |
| [SPEC-02](SPEC-02-NATIVE-EVIDENCE.md) | IMP-01、02、05 | [CHK-02](CHECKLIST-02-NATIVE-EVIDENCE.md) | 62、67、68 |
| [SPEC-03](SPEC-03-GOVERNANCE.md) | IMP-03、04、06 | [CHK-03](CHECKLIST-03-GOVERNANCE.md) | 63、66、69 |

[Task索引](../../tasks/README.md)、[セルフレビュー](SELF-REVIEW-20260910.md)。実装開始はユーザーの本タスク指示に基づく。local自動試験の完了を実機受入・外部QEG完了としない。

local補助検証: [最大件数・Chrome／Edge表示の実測](PERFORMANCE-20260910.md)。

追加のlocal補助検証: [媒体40ケース・画像拡大と最終再測定](MEDIA-ACCEPTANCE-20260910.md)。

Python bridgeのlocal補助検証: [結果記録・依存lock照合・配布物検証](PYTHON-VALIDATION-20260910.md)。

媒体受渡しのlocal補助検証: [要求／応答契約・private file受領](ATTESTATION-EXCHANGE-20260910.md)。

後続の媒体検証: [source隔離・署名済みbytesの採用・exchange接続](ATTESTATION-MEDIA-20260910.md)。

保存済み証跡の検証: [受領記録の公開・HATE／report v2・旧媒体の拒否回帰](ATTESTATION-EVIDENCE-REPORT-20260910.md)。

通常runからの接続検証: [capture停止・要求と採用・operator制御・保存先検証](ATTESTATION-RUN-20260910.md)。9件の接続test、全体417件、配布物508 files／54 schemasを確認した。同記録時点の失敗時HATE確定は、次の検証で後続対応した。

失敗時の記録: [媒体の未採用理由・診断HATE・HTML表示](ATTESTATION-RESULT-20260910.md)。関連46件、全体430件、配布物518 files／55 schemasを確認し、ローカル表示サンプルを保存した。

項目別の媒体参照: [検査済み画像と履歴・findingの対応付け](ATTESTATION-MEDIA-LINKS-20260910.md)。関連30件、全体439件、配布物521 files／55 schemasを確認した。

原本の保全と停止: [原本の非公開移管・媒体I/Oの停止制御](ATTESTATION-ORIGINALS-20260910.md)。関連56件、全体456件、配布物521 files／55 schemasがpass。原本のunlinkを除去し、最終確認後の更新・差替えや移管失敗でbytesを保持する。別volumeでの成功、IO-01全体、隔離途中の完全な隔離、派生bundle、実機identity、固定SHAの受入は継続中。

実機identityの契約: [観測記録・build mapping・照合器](NATIVE-IDENTITY-CONTRACT-20260910.md)。native 12件を含む全体468件、配布物529 files／57 schemasがpass。宣言による代用、接続・provider・buildの不一致と期限を検証した。実情報を取得するprovider、初回／resumeへの接続、実機受入は未完了である。

Android情報の取得: [SDK provider・接続切替・private logging](NATIVE-ANDROID-PROVIDER-20260910.md)。Python全63件（追加15件）、TypeScript側468件、配布物530 files／57 schemasがpass。Androidのbridge内部取得を実装した。公開endpoint・署名済み実行経路への接続、Windows／iOS provider、実機受入は残る。

観測の受渡し: [Python HTTP・一回用session・Node client](NATIVE-IDENTITY-EXCHANGE-20260910.md)。Python83件、TypeScript側476件、配布物535 files／58 schemasがpass。人工SDK応答でHTTPから照合器まで接続し、24 digestを記録した。署名済みtarget v2、action前／resume／再接続の実行制御、証跡の保存・読取、他platform providerと実機受入は未完了である。

署名済み条件: [native target v2・policy・段階導入の読取制御](NATIVE-IDENTITY-TARGET-20260910.md)。関連26件、全体489件、配布物539 files／59 schemasがpass。v2の署名検証と人工観測の照合、CLI接続0と既定readerの拒否を確認し、14 digestを記録した。action前／resume／再接続の実行制御、保存証跡、他platform providerと実機受入は残る。

観測へ束縛した操作: [native-action・SDK選択・重複拒否・操作試行の記録](NATIVE-IDENTITY-ACTIONS-20260910.md)。Python101件・全体497件、最後の例外秘匿修正後の関連9件・型・Lint、配布物544 files／60 schemasがpass。最終buildのHTTP相互運用と29 digestを保存した。operator承認期限の継続適用、transport接続世代、CLI／session証跡への接続と実機受入は未完了である。
