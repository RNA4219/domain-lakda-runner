---
document_id: LAKDA-CHK-UP-02
status: active
last_updated: 2026-09-11
specification: SPEC-02-NATIVE-EVIDENCE.md
---

# Checklist 02

[撮影実行・journal・レポートの追加検証](NATIVE-CAPTURE-JOURNAL-20260911.md)で、署名済みfacade、要求・結果・cleanupの保存と独立読取、撮影設定の照合、v1互換、大きいv2応答、CLI pause／resumeとHTML readyを確認した。全559件・Python175件、package 592 files／65 schemasがpass。CLI連続撮影・実SDK・実機を含む以下の全体条件は未完了を維持する。

- [ ] 撮影journal: 要求保存前後・応答後の承認確認、撮影と入力の連番、元撮影の停止、保存不能・開始不明・画像不明の区別、Charterの撮影設定と容量上限、v1／v2読取、HATE／HTMLとの照合を統合する。CLI連続撮影と実機の証跡を別途揃える。

[native撮影HTTP・Node接続](NATIVE-CAPTURE-HTTP-20260911.md)で全549件、Python173件、package 581 files／63 schemasを確認した。撮影専用連番、直前応答の再送、元撮影の停止、期限後cleanup、開始中SDKのlock待機上限を検証した。署名済みfacade・撮影journal・実機の全体条件は未完了として維持する。

- [ ] HTTP／Node撮影: 入力copy、要求digest、連番、開始識別子、modeと元guardを照合する。再送・新しい連番での再確認・旧captureへの停止・失効後cleanup・結果作成失敗を保存証跡まで接続して確認する。

[native撮影の内部guard・背景停止・close](NATIVE-CAPTURE-GUARD-20260911.md)で追加17件を含むPython160件、全546件、package 575 files／62 schemasを確認した。停止先の確認、timeout後の待機、開始応答不明、終了順序を人工SDKで検証した。HTTP／Nodeと撮影証跡の接続・実機受入は未完了であり、以下の全体条件は閉じない。

- [ ] native撮影の継続条件: lease取消・承認切れ・ADB／display／recorder／process／transportの変更を検出し、誤ったframeや停止先を採用しない。内部guardとHTTP／Nodeの接続を別々に確認する。
- [ ] native撮影の終了: 背景停止、timeout後の同じworkerの完了、明示的な再試行、開始応答不明、監視開始失敗、close時の順序と共通待機上限、証跡への失敗状態の保存を確認する。

[録画backend・MP4のローカル検証](NATIVE-VIDEO-BACKEND-20260911.md)で、停止先の保持、開始／停止未確認の非採用、MP4と既存WebMの出力、署名後のbytes変更を確認した。全546件・Python143件、package 573 files／62 schemasがpass。以下はSDK接続世代・実機を含む全体条件として未完了を維持する。

- [ ] 録画backend: 接続済みdeviceのMP4、部分APIの拒否、開始未確認時の非採用、False／Noneの停止未確認、共有API・device・method変更後も元backendを停止することを確認する。native接続世代と実機の確認を別記録する。
- [ ] MP4受渡し: inventory／MIME／署名／run・session HATE／video集計の整合、未検査の非昇格、同一sizeのbytes変更による失効、未知形式の拒否、既存WebMの互換性を確認する。

[CLI初回／draft／paused resumeの追加検証](NATIVE-IDENTITY-CLI-20260911.md)で、連続撮影offの署名済み操作・新しいjournal・pause時の署名付きfixture画像・期限後のJSON reportを確認した。最終全544件、package 573 files／62 schemasがpass。連続撮影の接続世代と実機受入は未完了であり、以下の全体ACは閉じない。

- [ ] 初回・draftでは操作前の実観測を保存し、pausedでは過去journalのcompleteを接続前に要求する。新しい観測でreplayし、欠落・応答不明・改変・承認切れ・対象違いでは追加SDK操作0件とする。
- [ ] 相対trustを元targetの親から解決し、実行・媒体・JSON report・HATEが同じoperator fileを使う。HTMLの明示report trustは別契約として維持する。
- [ ] checkpointは最後の操作に続く観測で確定でき、最後の観測欠落を過去操作のfingerprintで補完しない。

前段の補助検証は[native runnerの操作接続と撮影停止](NATIVE-IDENTITY-RUNNER-20260911.md)。通常探索へbridgeを注入した操作・保存、期限後の撮影停止、最終native関連84件とpackage 570 files／62 schemasを確認した。同記録時点ではCLI初回／resumeと実機受入が残っていた。以下の過去の補助検証は各記録時点の範囲を表し、AC全体の完了とは扱わない。

[native証跡保存・読取の補助検証](NATIVE-IDENTITY-EVIDENCE-20260911.md)で全体527件・Python138件・package 561 files／62 schemasと、人工HTTP経由の5記録を確認した。保存期限切れでの停止、時計差の再検査、未完了／応答不明の保持を含む。内部sink／readerの検証であり、CLI／resume・HATE／reportとの統合と実機受入が残るため、以下のAC全体は未完了とする。

- [ ] native保存順序: 観測→予定→終了を保存し、保存失敗の位置ごとのSDK件数とactionAttemptedを確認する。予定／終了の片側欠落、重複・逆順、別session／target、secret／PII混入を拒否する。
- [ ] native保存照合: 要求全文を保存せず、保存した照合参照からreceipt、観測、承認期間、session eventとfile bytesを再検証する。CLI／resume・HATE／reportへの接続とv1互換を確認する。

[Android接続世代の補助検証](NATIVE-IDENTITY-TRANSPORT-20260910.md)でtransport関連22件、Python138件・全体511件、package 551 files／61 schemas、人工ADBを含むHTTP相互運用を確認した。以下2項目は人工TCP／SDKによるローカル検証が済んでいる。実ADB server／実機、CLI接続・session保存読取、Windows／iOSが残るため、全体AC-UP-008／022は未完了とする。以降の古い補助検証は各記録時点の範囲を表す。

- [ ] Android接続世代: 同一SDK object／selectorでのtransport ID変更、監視接続の切断後のID再使用、SDK準備中・開始後の切替を拒否し、旧leaseを復活させない。
- [ ] Android監視の資源・秘匿: loopback・SDK設定整合、未知service拒否、500msの共通I/O期限、frame／行数上限、監視1本の共有、closeとthread停止、raw selector・他端末一覧の非公開を確認する。

[承認期限とUTC時計の補助検証](NATIVE-IDENTITY-WINDOW-20260910.md)でPython116件・Node関連44件／全体511件・package 549 files／61 schemas・HTTP相互運用10回を確認した。以下の追加契約はlocalで検証済みだが、CLI接続・session保存読取・実transport世代・実機3laneが残るため、AC-UP-008／022の完了状態は変えない。

- [ ] Native action v2: 署名済みtarget実bytesのdigestと承認期間を要求・応答・leaseへ束縛し、v1との混用、期間変更、時計逆行、期限境界、準備中／SDK開始後の失効を区別して拒否する。
- [ ] 署名済み実行wrapper: 観測前と操作・復旧前後の署名／identity検査、固定した単調時計起点、入力snapshot、同時要求拒否、失敗後停止を確認する。CLI／sessionの未接続拒否を別途維持する。

対応[仕様](SPEC-02-NATIVE-EVIDENCE.md)。期待結果と必要証跡は[全体AC](../../proposals/20260910-detailed-checklist.md)を参照する。

実機identityの[観測契約・照合器](NATIVE-IDENTITY-CONTRACT-20260910.md)はnative 12件を含む全体468件、package 529 files／57 schemasをlocal検証した。実provider・target manifest v2・初回／resume／再接続への接続は残っており、AC-UP-008／022は未完了とする。

後続の[Android SDK provider](NATIVE-ANDROID-PROVIDER-20260910.md)はPython全63件・TypeScript側468件、package 530 files／57 schemasを確認した。実SDK呼出しのfixture probeと3ケースのdigest相互運用もpass。Android内部取得までの補助証跡であり、公開・実行経路、他platform provider、実機受入が残るためACの完了状態は変えない。

続く[HTTP受渡し](NATIVE-IDENTITY-EXCHANGE-20260910.md)はPython83件・TypeScript側476件、package 535 files／58 schemasを確認した。接続IDの一回利用、期限・接続差・HTTP上限とPython HTTP → Node → verifierのfixtureを検証した。署名済みtarget v2、action前／resume／再接続の実行制御、観測証跡の保存・読取、他platformと実機受入が残るためAC-UP-008／022は未完了とする。

後続の[native target v2](NATIVE-IDENTITY-TARGET-20260910.md)は関連26件・全体489件、package 539 files／59 schemasを確認した。署名metadataとpolicyの束縛、provider別mapping、人工観測との照合、CLI初回／draft resumeの接続0、既定readerのv2拒否を確認した。実行制御と保存証跡の接続・実機受入は残るためACの完了状態は変えない。

続く[native-action](NATIVE-IDENTITY-ACTIONS-20260910.md)はPython101件・全体497件と、最後の小修正後の関連9件・型・Lint、package 544 files／60 schemasを確認した。明示deviceの操作／復旧、観測leaseの期限・連番・SDK選択、開始後失敗のactionAttempted、HTTP相互運用が対象。承認期限のSDK開始までの適用、実transport世代、CLI／session保存・読取と実機受入が残るためAC-UP-008／022は未完了とする。

媒体受渡しからレポートの項目別参照への接続は[検査済み画像への対応付け](ATTESTATION-MEDIA-LINKS-20260910.md)でlocal検証した。関連30件・全体439件がpass。

後続の[原本の非公開保全・停止制御](ATTESTATION-ORIGINALS-20260910.md)で、原本保全7件を含む関連56件・全体456件、package 521 files／55 schemasを確認した。最終stat後の更新・差替え、移管失敗と停止で原本が残る。通常I/Oの停止・期限伝播も検証したが、別volumeの成功、IO-01全体、隔離途中の完全な隔離、派生bundle、実機identityと固定SHA受入は未完了である。

- [x] 対象要件、module、I/O、既存互換境界を仕様へ固定した。
- [x] セルフレビューの設計指摘を反映した。
- [ ] AC-UP-001を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-002を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-002の試験結果境界（fixture error、0件、skip、expected failure、unexpected success、subtest）でJSON／JUnitと全体結果を照合した。
- [ ] AC-UP-002のlockと導入versionの一致・欠落・不一致・曖昧さを検証し、import-only記録とのscope差を明示した。
- [ ] AC-UP-003を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-004を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] AC-UP-005を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] 大型媒体のinventory・隔離・採用・再照合へ停止／期限を伝え、通常I/O時の停止1秒以内、元bytes保持、共通予算と独立した有界の診断終了処理を対象revisionで検証した。
- [ ] IO-01の同一inode・容量・更新時刻での並行上書きについて、元file除去とprivate保持を含む方式を確定・検証した。停止制御や差替え検出の合格だけで媒体不変性を完了扱いにしない。
- [ ] 保存済みv2のrun／session／target／policy／receiptをHATEとreportで照合し、通常runからの受渡しと失敗時の記録まで対象revisionで確認した。
- [ ] 未採用resultと全要求一覧の対応、errorを保ったHATE確定、未記録欠落の拒否、reportでの理由・区分の表示を対象revisionで検証した。
- [ ] AC-UP-008を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] native journalの参照・順序・再使用・容量・差替えを照合し、未完了／応答不明／孤立fileを成功へ補完しない。checkpoint追記中の期限切れで予定保存後のSDK0件と、終了保存後のreceipt保持を確認した。
- [ ] 保存時の承認期間・明示trust・4入力の実bytesを検証し、期限切れの過去記録と不明な操作結果を区別する。媒体なしのreportとHATEも同じnative照合を通し、記録漏れ・孤立file・途中更新を拒否する。
- [ ] runnerのexecute／recoverが署名済みexecutorと必須sinkだけを使い、旧操作0件、失敗後の追加操作0件、期限後のcapture停止を確認する。CLI初回／resume・撮影の接続世代も検証してからv2実行を有効化する。
- [ ] 1〜20ms先のtimestampを同じ予算内で一度待ち、待機後も未来／要求前／期限切れなら拒否した。診断を外したPython／Node相互運用と保存読取の実結果を記録した。
- [ ] native observation／build mapping v1を検証し、必須観測の宣言値による代用、別bridge／接続／challenge、provider版差、時刻・単調時計の期限、mapping差替え・曖昧さ、raw識別情報を拒否した。実provider・初回／resumeへの接続と実機受入は契約検証と別に記録した。
- [ ] native target v2の署名metadata・policy・provider別mappingを検証し、action前／resume／再接続と保存証跡の読取へ接続した。文書検証のvalidate-onlyと、未接続時のCLI／既定reader拒否を実行許可の完成と混同しない。
- [ ] native-actionの観測lease・連番・明示SDK操作先・actionAttemptedを検証し、operator承認期限、同一objectの内部再接続世代、保存証跡まで接続した。低水準APIのfixture成功だけでこの項目を閉じない。
- [ ] AC-UP-022を対象revisionで検証し、実結果とartifact digestを記録した。
- [ ] 対応Taskの実装完了を検証し、未実施外部項目を明示した。

AC-UP-002のlocal補助証跡は[Python検証記録](PYTHON-VALIDATION-20260910.md)に保存した。fixture error／expected failure等のPython48件、既存venvの43 package一致・7 imports、配布物の検証を含む。固定SHA・GitHub CI・他host matrix・実機の未達を残し、上記のAC全体を完了扱いにしない。

AC-UP-003〜005の要求／応答契約とprivate file受領は[受渡しローカル検証](ATTESTATION-EXCHANGE-20260910.md)に保存した。新契約・受領20件、全体379件、配布物484 files／54 schemasを確認した。実媒体の隔離・採用、通常runとHATE／reportへの接続は残っており、上記ACを完了扱いにしない。

その後、[媒体の隔離・採用](ATTESTATION-MEDIA-20260910.md)をexchangeへ接続し、関連33件・全体392件・package 490 files／54 schemasを確認した。通常run／HATE／report v2への接続と実機受入は残る。

後続の[受領記録の公開・保存済みv2検証](ATTESTATION-EVIDENCE-REPORT-20260910.md)では、HATE／report readerへの接続、関連21件、全体408件、package 496 files／54 schemasを確認した。通常runからの受渡し、失敗時の最終記録、派生bundleと実機受入は残るため、上記AC全体は未完了のままにする。

続く[通常runの受渡し検証](ATTESTATION-RUN-20260910.md)では、capture停止後の受渡し、共通期限、operator制御、trustとprivate保存先を9件のfixtureで確認した。全体417件、package 508 files／54 schemasはpass、source／logの16 digestを照合済み。必須媒体が採用されない場合のHATE確定と詳細report、大型媒体I/O中の停止上限、期限後の派生bundle、実機受入は残る。上記ACの完了条件は変更しない。

後続の[未採用理由・診断HATE・HTML表示](ATTESTATION-RESULT-20260910.md)で、timeout／検査不合格／採用失敗の結果保存と理由表示を接続した。関連46件、全体430件、package 518 files／55 schemasがpass。30件のsource／log／表示サンプルdigestを記録した。隔離途中の終了や大型媒体の停止、期限後の派生bundle、実機・固定SHAの受入が残るため、上記AC全体は未完了とする。
