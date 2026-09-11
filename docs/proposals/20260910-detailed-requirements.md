---
document_id: LAKDA-REQ-UP-001
status: review-ready
version: 0.1.6-draft
last_updated: 2026-09-11
checklist: 20260910-detailed-checklist.md
report_detail: 20260910-report-detail.md
---

# Lakda 改修要件定義：保守・実機連携・生成レポート

## 1. 目的と位置づけ

Lakdaの実行結果を人間が確認・説明できるレポートにし、その信頼性を支えるPython bridge、実機情報、媒体の検査・署名、受入記録、保守構造を整える。[初期草案](20260910-improvement-requirements.md)を詳細化した要件定義である。

調査基準は`0.5.0-rc.1`、revision `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`。`review-ready`は要件レビューに使える状態を意味し、実装済み・承認済み・リリース可能を意味しない。[保守性実装計画](../IMPLEMENTATION-PLAN-MAINTAINABILITY.md)と過去受入記録は履歴として保持する。

本書が7件の改修の要件入口、[レポート詳細](20260910-report-detail.md)がIMP-07の入出力・画面・異常時契約、[詳細チェックリスト](20260910-detailed-checklist.md)が要件から受入への対応表である。Mustは採用段階の完了に必須、Shouldは初期版の後に実装する候補を表す。

2026-09-11のユーザー指示により、今回の仕上げは「テスト終了後のHTMLで結果の概要・失敗理由・保存済み画像や動画を確認できること」に集中する。比較・開発用テストの集約・レポート履歴管理は保留し、自動的に後続実装へ進めない。既存7改修の記録と未完了状態は維持するが、追加機能や実機受入の完了を基本レポートの利用開始条件にしない。

完成形と初期範囲から確認する場合は[レビュー用要約](20260911-requirements-brief.md)を先に読む。そこで示した利用シナリオから本書の要件、レポート詳細、対応する受入条件へ辿れる。

要件は全57件（Must 55件、Should 2件）、受入条件は22件に整理する。最初に確認したい成果は、テスト終了後にHTMLを開き、結果と停止理由を把握し、気になる項目から操作履歴と保存済み証跡へ辿れることである。個々の技術要件はこの利用体験と既存契約の維持に結び付ける。詳細化だけで7件すべての実装採用や納期が確定したとは扱わない。

## 2. 利用者と利用場面

| 利用者 | やりたいこと | 完了したと判断できる状態 |
|---|---|---|
| テスト実行者 | 実行直後に何が起きたか確認する | 結果・停止理由・気になる項目から関連証跡へ辿れる |
| 開発者・調査担当者 | 失敗の発生順と再現参照を確認する | run ID、seed、revision、操作履歴、failure／findingの関係が分かる |
| QA・報告先 | 範囲、未確認事項、結果の根拠を見る | 実行結果、探索上の気づき、証跡検証、実環境受入が区別される |
| 実機operator | 端末・appと撮影媒体を結び付ける | 実観測・宣言・署名・digestの照合結果を確認できる |
| 保守担当者 | 変更による回帰を確認する | 責務別テストと固定revisionの受入記録が揃う |

## 3. 詳細化にあたって置く既定値

以下は提案上の既定値であり、ユーザーが個別に指定した条件ではない。変更時はこの表と対応要件・受入条件を同時に更新する。

| 決定ID | 既定値 | 理由 |
|---|---|---|
| DEC-UP-01 | 初期reportはLakdaの5 mode、worker batch、探索session | 保存済み契約を再利用できる。開発用`npm test`には既存Playwright HTML reporterがある |
| DEC-UP-02 | 対応CLI終了後に自動生成し、明示的に無効化可能 | 実行後すぐ結果を確認できる。ライブラリAPIへ暗黙の生成は追加しない |
| DEC-UP-03 | HTML＋同梱assetsをローカルで開く。ブラウザ自動起動なし | 外部サービスなしで確認でき、CIでも同じ生成経路を使える |
| DEC-UP-04 | `local`と`share`の2profile。自動生成の既定は`local` | 手元で未検査媒体を確認する用途と検査条件を満たす持ち運びを区別する |
| DEC-UP-05 | 前回比較・対話graph・AI要約・PDF・開発用suite集約・レポート履歴管理は保留 | 基本レポートの結果確認・失敗理由・画像や動画の閲覧を先に仕上げ、追加は必要時に改めて採用する |
| DEC-UP-06 | Legacy P6 workflowは実行対象から外し、履歴へ保存 | current checkoutと過去version検査が混在する導線をなくす |
| DEC-UP-07 | finalized runと元manifestを上書きしない | 履歴とSHA-256照合を維持する |
| DEC-UP-08 | 実機3laneの要件を維持し、ローカルreportは先に完成可能 | 実機準備待ちで通常Web結果の確認まで止めない |

## 4. 対象範囲と段階

| 改修 | 内容 | 優先度案 | 段階 | 変更境界 |
|---|---|---|---|---|
| IMP-01 | Python実行テスト・依存固定 | 高：実機連携の基盤 | M1 | bridge、専用test、CI、運用文書 |
| IMP-02 | 媒体検査・外部署名受渡し | 高：実機媒体の受入前に必須 | M2 | capture finalization、attestation、operator I/O、schema |
| IMP-03 | 固定revision受入・Task状態整理 | 高：完了判断の根拠 | M1暫定、M3確定 | Acceptance、Task Seed、索引、profile |
| IMP-04 | Legacy P6履歴化 | 中：運用導線の整理 | M1 | 旧workflow、履歴、導線 |
| IMP-05 | 実機情報の独立取得・照合 | 中：実機受入前に必須 | M2 | native identity、preflight／resume、schema |
| IMP-06 | catalog・文書checker分割 | 中：report readerの前提 | M1 | read-only検証／比較、checker、契約test |
| IMP-07 | 生成レポート | 高：利用者に見える成果 | M1 | CLI後処理、report reader／view model／renderer、出力schema、受入 |

M1はローカル機能とfixture受入、M2はoperator連携と実機準備、M3は変更後SHAでの統合・実環境受入を表す。M1／M2からM3完了を推定しない。外部upload、クラウド公開、reportからの再実行、探索能力の追加は範囲外とする。

優先度は利用価値と不備の影響、実装順は依存関係で判断する。例えばIMP-07の前にIMP-06のreader分割を行える。M1のshareは検査条件を満たさない媒体を除外して成立でき、M2の新しい検査・署名受渡しを待たずに通常Webのレポートを検証できる。各段階の完了は対応するMustとACの実結果で判断し、画面が表示できたことだけで完了にしない。

### 4.1 段階ごとの成果物と完了条件

以下は既存要件の納品単位であり、Must／Shouldの追加や受入範囲の縮小ではない。

| 段階 | 確認する成果物 | 完了条件 | 次の段階へ残すもの |
|---|---|---|---|
| M1 | 再生成可能なHTMLレポート、生成・検証CLI、Python fixture試験と依存lock、互換性を保った責務分割、Legacy履歴、ローカル受入記録 | AC-UP-001〜002、006のM1部分、007、009〜021について期待結果・実結果・証跡を照合する。画像をすべて除外する実装だけでは媒体表示の受入を完了にしない | 新しい外部署名受渡し、実機identity、実環境での結果確認 |
| M2 | versioned検査request／response、受領・拒否記録、実観測と宣言を区別したidentity契約、operator手順 | AC-UP-003〜005、008を照合し、ローカル検証と実機で未確認の項目を明示する | 変更後SHAに固定した全体の統合受入、外部Gate |
| M3 | 対象SHAと環境を固定したAcceptance Record、lane別証跡、manual-bb・外部QEGへの参照 | AC-UP-006のM3部分、022と、変更の影響を受けた既存ACを照合する。必要laneが未取得なら全体完了にしない | 対象外とした後続Should、別revision・別環境の受入 |

M1の媒体受入では人工データとテスト用署名を用い、検証済みoutputの表示、未検査媒体のlocal表示・share除外、restrictedの除外をそれぞれ確認する。署名や実機が必要な範囲をfixture成功で代替しない。使用する鍵・対象・検証範囲は[SPEC-01](../spec/verification-reports/SPEC-01-REPORTING.md)に従う。

## 5. 共通要件

| 要件ID | 強さ | 要件 |
|---|---|---|
| REQ-UP-COM-001 | Must | 既存modeの選択・操作・replay・capture保持、JSON stdout、終了codeを維持する。reportはCLI後処理で別directoryへ生成する。 |
| REQ-UP-COM-002 | Must | 成果物に対象source revision、入力digest、producer／schema version、実行資格を結び付ける。取得不能な値を推定で置換しない。 |
| REQ-UP-COM-003 | Must | fixture／mock／emulator／real、local Gate／外部受入／QEGを区別する。LakdaからQEG verdict・approval・waiverを生成しない。 |
| REQ-UP-COM-004 | Must | 仕様変更にはschema／CLI／テスト／文書／checklistの影響表を付ける。既存v1の必須fieldや署名payloadの意味を変える場合はversionを更新し、旧証跡を改変しない。 |

## 6. IMP-01：Python bridge実行検証

調査基準revisionでは[TypeScriptテスト](../../tests/airtest-poco-bridge-contract.spec.ts)にPythonソース文字列検査があり、実行確認とtransitive lockが改修対象となった。変更後の対応環境は[bridge文書](../../tools/airtest-poco-bridge/README.md)、個々の検証結果は[Task 62](../tasks/TASK.20260910-62.md)で管理する。本書の背景記述を現在の実装状態の判定には使わない。

| 要件ID | 強さ | 要件 |
|---|---|---|
| REQ-UP-BRG-001 | Must | Python bridge本体をimportし実メソッドを呼ぶ。device、画像取得、clock、録画backendをfixtureで置換し、外部端末・外部network・実秘密値なしで実行可能にする。 |
| REQ-UP-BRG-002 | Must | capture開始→停止／破棄、二重開始、未開始停止、mode不一致、0 frame、録画失敗、sampler停止timeout、maxFrames／maxBytes境界を実行検証する。停止未確認を成功としない。 |
| REQ-UP-BRG-003 | Must | source文字列一致を動作保証の唯一の根拠にしない。HTTP入出力の正常・不正JSON・content type・容量超過とstaging内artifact参照を、fixture loopback通信またはhandler実行で検証する。 |
| REQ-UP-BRG-004 | Must | Windows CIでPython構文検査と実行テストを必須化する。stdlib＋fixtureの初期基準は既存release workflowに合わせPython 3.13とし、実機用依存の対応宣言とは分離する。実行数・skip・失敗を記録し、Python不在による全skipを成功としない。 |
| REQ-UP-BRG-005 | Must | 実機用にはplatform／Python／architectureごとの検証済みmatrixと間接依存・配布物hashを含むlockを作る。clean venvのinstall、import、依存整合が通るまで対応済みとしない。top-level attestationは完全lockと表現しない。 |
| REQ-UP-BRG-006 | Must | 実行command、必要runtime、fixture資格、失敗時の確認方法を文書化する。CI結果と実機接続・実画像検査を別のAcceptance Recordへ記録する。 |

### 6.1 Python検証を完了とする条件

以下はREQ-UP-BRG-004〜006とAC-UP-002の具体化であり、要件数を増やすものではない。テスト結果を保存できたことと、検証が合格したことを区別する。

| 条件 | 必要な記録・期待結果 |
|---|---|
| 通常caseが成功 | 成功したcaseを記録する。全体合格には通常の成功caseが1件以上あり、失敗・error・想定外の成功がないことを要求する |
| 0件、全skip、全expected failure | 検証成立とせず、非0の終了codeと理由を残す。expected failureは「失敗を想定して実行した結果」であり、通常の成功件数へ含めない |
| setUpModule／setUpClass／tearDownModule／tearDownClassのerror | test本体の開始前・終了後でも所属を特定できるerror recordを残し、別caseの結果を上書きしない。実際に開始したcase数と結果record数を区別する |
| 通常成功とskip／expected failureの混在 | それぞれを別集計する。expected failureはJSONで識別し、JUnitでは理由付きskippedとして表す。全体合格でもskipを検証済みと扱わない |
| unexpected success、失敗したsubtest | unexpected successは全体不合格でJUnit failureとする。subtestの失敗を親caseに反映し、1case中の複数失敗を複数caseとして数えない。後続のskipで既存の失敗・errorを消さない |

書込み可能な出力先では、上記の試験結果についてJSONとJUnitの件数・所属・結果を照合できるようにする。Python自体を起動できない場合や保存失敗はwrapperの診断と非0終了で明示し、存在しない結果fileを保存済みと通知しない。未計測の時間を成功caseの値から流用しない。

依存環境の完了条件は、hash付きlockによるclean install、lockが要求する全packageの導入versionとの一致、指定moduleのimport成功をそれぞれ確認することとする。lockのdigestを記録しただけ、またはimportが成功しただけでは依存整合の合格にしない。欠落・version差・同名distributionの曖昧さ・lockの解釈失敗を理由付きで記録する。packageに同梱されたvendored distributionと環境へ導入したdistributionを区別し、一覧の上書きで差分を消さない。

配布物hashの検証はinstall時の証跡、導入versionとの一致は環境照合の証跡として分ける。versionが一致することから導入後の全file bytesの完全性や実機動作まで確認済みとは表現しない。既存のimport-only記録はその検証範囲の履歴として保持する。

## 7. IMP-02：検査・署名を媒体finalizationへ接続

現行の[binary attestation検証](../../src/exploration/binary-attestation.ts)を基礎とする。scannerや署名processはoperatorが管理し、Lakdaは起動しない。

| 要件ID | 強さ | 要件 |
|---|---|---|
| REQ-UP-ATT-001 | Must | capture停止・bytes確定後、HATE登録前に検査要求を確定する。要求はrequest ID、run／session ID、target manifest digest、source相対path・size・SHA-256、媒体種別、policy version、期限を持つ。 |
| REQ-UP-ATT-002 | Must | operator指定のrun専用staging内でversioned request／responseをatomic受渡しする。partial write、別run、別policy、重複競合、期限後応答を拒否する。外部process起動やscannerの自動選択を追加しない。 |
| REQ-UP-ATT-003 | Must | 応答のrequest bindingと媒体digestを署名対象に含め、targetで許可したattestor keyとtrust storeで検証する。この追加bindingを表す新契約を用意し、既存v1は読取互換を保持する。旧署名を新契約へ昇格しない。 |
| REQ-UP-ATT-004 | Must | secret／PII結果、tool名・version・policy digest、redaction rule、source／output size・SHA-256を照合する。マスク済みoutput採用時はそのbytesを参照し、raw sourceを公開証跡へ登録しない。 |
| REQ-UP-ATT-005 | Must | 待機上限を初期既定30秒、範囲1〜300秒とする。満了・停止要求・検査不合格・署名欠落は媒体を隔離し明示的に失敗とする。停止要求は1秒以内に待機へ反映し、target操作を追加しない。 |
| REQ-UP-ATT-006 | Must | finalized runへの後付け書込みを禁止する。期限後応答は元runを更新せず、元digestを参照する新しい派生bundleで扱う。同一requestを二重処理しない。 |
| REQ-UP-ATT-007 | Must | capture不備と検査待ち／不合格を別reason codeで記録する。受領recordを秘密値除去後にHATEへ結び付ける。署名の真正性と画像内容の検査を区別し、実画像negative corpusと人間の確認を実機受入へ含める。 |

### 7.1 停止・保存途中の失敗を含む完了条件

REQ-UP-ATT-001〜007とAC-UP-003〜005は、正常な署名応答の受領に加え、次の条件を満たして完了とする。停止した場所によって、媒体の保持状態と公開可能な記録を区別する。

| 発生する状況 | 必要な動作・確認結果 |
|---|---|
| 撮影の停止を確認できない | 検査要求と媒体公開へ進まない。元媒体を保持し、撮影の停止失敗を記録する |
| 媒体一覧・hash計算中に期限切れ | 一覧確定前の要求を公開しない。一覧作成から隔離・応答待機・採用まで共通の期限を使い、媒体ごとに待機時間を取り直さない |
| 隔離開始前・複数媒体の隔離途中に停止または保存失敗 | 完了済みのprivateコピーと未移動の元媒体を保持する。隔離未完了を検査不合格だけで説明せず、未確定runを成功したHATEへ進めない |
| 署名応答の受領後、媒体のコピー・再照合で停止 | 応答署名の検証と媒体採用を別に記録する。署名が正しくても採用済みとせず、元媒体・privateコピー・既存出力を上書きしない |
| 停止・期限切れの診断記録を保存する | 元の停止状態を保持したまま、期限付きで診断だけを保存する。この時間で新しい媒体採用やtarget操作を行わない。保存できなければ未確定と理由を残す |
| 期限後の応答、または同じrequestの再投入 | 元run・manifestを変更せず、二重採用しない。後日の利用は元digestを参照する別の派生bundleとして検証する |
| 元媒体が読み取り中・コピー後に更新される | 古いコピーを根拠に新しい元媒体を削除しない。size・更新時刻の一致だけでbytesの不変性を保証したと扱わず、停止確認と媒体保全の根拠を揃える |

停止反映1秒以内は、通常のローカルI/Oで新しい停止が受理されてから次の処理を中断するまでを測る。応答待機だけでなく、一覧のhash計算、コピー、再読取、採用、診断保存を対象にする。既に受理した停止の診断を保存し終えるまでの時間は、別の有界な終了処理として記録する。OSやstorage自体が応答しない時間の強制終了保証とは分け、測定環境・媒体量・停止位置・反映時刻を記録する。処理単位と診断保存の期限は[SPEC-02](../spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)に従う。

受入では、観測可能なsize変更の検出と、同じsize・時刻でも内容が変わる場合の保全を別々に確認する。前者の成功だけで媒体の不変性を完了にしない。これらは既存の媒体保全・停止要件の具体化であり、新しい探索機能や原媒体の自動削除を追加するものではない。

## 8. IMP-03：固定revision受入とタスク状態

| 要件ID | 強さ | 要件 |
|---|---|---|
| REQ-UP-EVD-001 | Must | 検証recordに40桁subject SHA、worktree状態、runtime／lock識別、command、開始・終了日時、終了code、件数、artifact相対参照・SHA-256を記録する。dirty検証は補助証跡とする。 |
| REQ-UP-EVD-002 | Must | local Gateは既存requiredChecksに変更領域のPython／report契約・UI検証を加える。profile／package／schema、型・lint・build・既存回帰・fixture・packageを同じsubjectへ結び付ける。docs-only変更にruntime全試験を要求しない。 |
| REQ-UP-EVD-003 | Must | Task 59／60は実装完了条件とローカル証跡を確認して状態を更新する。外部未達はlane、必要入力、責任者、blocker、関連recordを別欄で保持する。merge済みだけでdoneにしない。 |
| REQ-UP-EVD-004 | Must | P7／P11、PC Web／mobile Web／Windows／Android／iOS、実Qwen、manual-bb、外部QEGを既存scopeに沿って受入する。未取得は`pending_external`とし、参照stagingだけで実機3laneを代替しない。 |
| REQ-UP-EVD-005 | Must | historical Acceptance／QEGを上書きせず、新recordから旧record・変更差分へリンクする。M1記録後にsourceが変わればM3で新SHAをfreezeし、必要Gateを再実行する。 |

## 9. IMP-04：Legacy P6履歴化

| 要件ID | 強さ | 要件 |
|---|---|---|
| REQ-UP-LEG-001 | Must | `.github/workflows/release-p6-rc.yml`を実行可能workflowから除外し、内容と元revisionを履歴文書から参照可能にする。過去artifact、tag、release、QEGは保持する。 |
| REQ-UP-LEG-002 | Must | 現行release入口をcurrent profileと`release-evidence.yml`へ統一する。旧P6はHistoricalと明示し、現行versionの手順にしない。 |
| REQ-UP-LEG-003 | Must | live workflowに過去RC版番号をcurrent成果物として検査・記録する残存がないことを検査する。履歴中の正当な旧版番号は許容する。 |

## 10. IMP-05：実機identityの実観測

| 要件ID | 強さ | 要件 |
|---|---|---|
| REQ-UP-IDN-001 | Must | operator宣言とdevice／OS観測値を別fieldに保持し、fieldごとにsource種別、取得時刻、provider version、取得状態を記録する。CLI引数のechoを観測としない。 |
| REQ-UP-IDN-002 | Must | Windowsは対象appと接続先process／実行fileの対応、Android／iOSはapp ID・installed buildと接続deviceの対応を確認する。versionと承認build digestの対応はversioned mappingで明示する。APIと対応versionはplatform仕様で固定する。 |
| REQ-UP-IDN-003 | Must | 初回action前とresume前に署名済みtarget manifest、宣言、実観測を照合する。別app・別端末・revision不一致・期限外では操作0件で停止する。観測有効期間は初期既定60秒、範囲1〜300秒とし、再接続で失効させる。 |
| REQ-UP-IDN-004 | Must | 実観測できないfieldは`unavailable`／`declared-only`とする。必須field欠落のreal受入は`pending_external`とし、fixture値で補わない。新identity契約はversion化し、既存capabilityの意味を暗黙変更しない。 |
| REQ-UP-IDN-005 | Must | raw serial、個人情報を含むalias、端末の任意情報を公開JSON・ログ・reportに残さない。digest生成規則を共通化し、Windows／Android／iOSを別々に受入検証する。 |

## 11. IMP-06：責務分割

| 要件ID | 強さ | 要件 |
|---|---|---|
| REQ-UP-MOD-001 | Must | catalogを入力読取・参照検証、run要約、graph／coverage検証、比較へ分離し、公開関数を互換facadeとして維持する。reportは検証境界を再利用し、弱い専用readerを複製しない。 |
| REQ-UP-MOD-002 | Must | check-docsをMarkdown、schema参照、profile、仕様／checklist対応、Birdseyeへ分離する。各検査は入力と診断結果を明示し、単体実行可能にする。 |
| REQ-UP-MOD-003 | Must | 比較JSONの順序・bytes、list上限・順序、公開export、終了code、正常／異常判定を分割前後で照合する。report追加などの新挙動は分割と別変更にする。 |
| REQ-UP-MOD-004 | Must | 新要件から受入IDとchecklistを辿れる検査を追加する。broken link、孤立要件、未知schema、未検証artifactが通る回帰を許容しない。 |

## 12. IMP-07と実装順

Must要件`REQ-UP-RPT-001`〜`REQ-UP-RPT-021`、後続Should要件`REQ-UP-RPT-022`〜`REQ-UP-RPT-023`は[レポート詳細](20260910-report-detail.md)で一意に定義する。runの成否、report生成状態、媒体検証、実環境受入は別軸として扱う。

履歴・findingと媒体の対応は、保存済みの明示参照が検証できた場合に限って表示する。媒体が存在すること、対応が記録されていること、共有条件を満たすことを個別に確認できるようにする。詳細画面の操作順と対応不明時の振る舞いは、レポート詳細の「3.2 項目と媒体の対応」「3.3 詳細画面の操作」に固定する。これは既存の履歴・媒体・操作性要件の具体化であり、57要件・22 ACの範囲を変更しない。

| 作業単位 | 目的 | 前提 | 主な受入 |
|---|---|---|---|
| W01 | 要件・公開schema／CLI契約をTask Seedへ展開 | 本書 | 互換性表、要件／受入対応 |
| W02 | Python fixtureテスト・CI | W01 | AC-UP-001〜002 |
| W03 | catalog／checker分割 | W01 | AC-UP-009〜010 |
| W04 | report入力検証・view model・生成I/O | W03 | AC-UP-011〜013、017、019、021 |
| W05 | report画面・媒体・offline／共有 | W04 | AC-UP-014〜018、020 |
| W06 | Legacy履歴化・M1受入記録 | 履歴化はW01、M1記録はW02・W05 | AC-UP-006〜007 |
| W07 | 媒体検査・署名受渡し | W02 | AC-UP-003〜005 |
| W08 | platform別identity | W02 | AC-UP-008 |
| W09 | 実機／固定SHA統合受入 | W06〜08、外部入力 | AC-UP-006、AC-UP-022 |

W07／W08はW04／W05から独立して進められる設計とする。これは依存関係の定義であり、今回の実装開始やsub-agent起動を指示するものではない。

## 13. 外部入力と残る判断

| 項目 | 確定する時点 | 未取得時 |
|---|---|---|
| 承認済みtarget・app・device corpus | W07／W08 real検証前 | fixtureは進め、real laneは`pending_external` |
| 実機用Python／Airtestの検証済みmatrix | W02 dependency受入時 | unit testだけでOS／Python対応を宣言しない |
| scanner／attestor、trust、mask／retention policy | W07接続前 | real binaryをHATE／shareへ登録しない |
| identity取得API・build mapping | W08仕様化時 | `declared-only`を維持 |
| 性能基準機のCPU・RAM・storage・browser build | W05性能受入前 | 時間目標は提案値。未計測をpassにしない |
| 次期version、日程、担当者 | 実装Task／release準備 | 現行versionを変更しない |

## 14. 今回の検証範囲

要件詳細化の検証は`npm run check:docs`、`git diff --check`、要件ID・受入ID・checklist対応と相対参照を対象とする。実装・性能・実機受入の結果は本書から主張しない。仕様化後の実装状況は[仕様索引](../spec/verification-reports/README.md)とそこから参照するTaskのEvidenceへ記録する。
