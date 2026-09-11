---
document_id: LAKDA-PROPOSAL-20260910-001
status: draft
last_updated: 2026-09-10
checklist: 20260910-improvement-checklist.md
---

# 改修要求の草案：保守・実機連携・テスト結果レポート

詳細化後の参照先は[改修要件定義](20260910-detailed-requirements.md)、[レポート詳細](20260910-report-detail.md)、[詳細受入チェックリスト](20260910-detailed-checklist.md)。本ファイルは初期候補と検討経緯として保持し、実装向けの条件は詳細版を参照する。

2026-09-10の改修調査と追加要望をまとめた検討用草案。調査対象は`0.5.0-rc.1`、revision `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`。既存6件は調査からの提案であり、追加レポートも候補として受領した段階である。全項目の実装着手、優先順位、出力形式が確定したことを意味しない。

対応する[要求・受入チェックリスト](20260910-improvement-checklist.md)を添付する。既存の[保守性実装計画](../IMPLEMENTATION-PLAN-MAINTAINABILITY.md)はlocal_completeの履歴として保持し、この草案で状態を変更しない。

## 1. 改修候補一覧

| ID | 候補 | 優先度案 | 要求・完了の方向 |
|---|---|---|---|
| IMP-01 | Python bridgeの実行テストと依存環境固定 | 高 | ソース文字列検査に加え、実Pythonでcapture開始・停止・timeout・容量制限を検証する。端末接続を伴わないテストをCIへ追加し、対応環境ごとに間接依存を含む再現可能な環境を固定する。実機受入とは区別する。 |
| IMP-02 | 実機画像・動画の証跡化連携 | 高 | operator管理の外部scanner／attestorから、検査・必要なマスク処理・署名付き記録を受け取る手順と完了確認を整える。署名欠落や不一致時の拒否を維持する。 |
| IMP-03 | 現行revisionの受入記録とタスク状態の整理 | 高 | 固定SHAでローカル検証を再実行し、command・終了code・artifact digestをAcceptance Recordへ記録する。Task 59／60のローカル完了状態と外部受入待ちを分離する。 |
| IMP-04 | Legacy P6 workflowの整理 | 中 | 履歴revisionで実行する構成へ固定するか、実行対象から外して履歴文書として保存する。現行checkoutを過去versionとして検査する矛盾を解消する。 |
| IMP-05 | 実機情報の独立取得・照合 | 中 | 対応platformで取得可能なapp revision・端末識別情報を実機から取得し、operator宣言と照合する。取得不能を観測済みと扱わず、公開証跡へraw識別値を含めない。 |
| IMP-06 | catalog・文書checkerの責務分割 | 中 | run読取り／検証／比較と、Markdown／schema／profile／Birdseye検査を独立検証できる単位へ分け、既存CLI・JSON契約を維持する。 |
| IMP-07 | テスト実行後の対話的な生成レポート | 新規・優先度未確定 | ClaudeのArtifactのように、実行結果を視覚的に把握し、項目を選んで詳細と証跡へ辿れる成果物を生成する。以下に初期案を示す。 |

## 2. 追加要望として受領した内容

テスト実行後の生成レポートが欲しい。ClaudeのArtifactのような、結果を見ながら操作できる成果物を改修候補へ追加する。

具体的な画面構成、保存形式、自動表示の有無はこれから詰める。以下のHTML、表示項目、段階分けは実装検討のための提案である。

## 3. レポート初期案

### 対象と生成タイミング

- RPT-01: 初期対象はLakdaによる通常run／replayと探索sessionの実行結果とする。`npm test`など開発用テストsuiteの集約も含めるかは未確定とする。
- RPT-02: 対応実行の終了後に、成功・失敗・部分完了・実行errorを含むレポートを生成できるようにする。保存済み結果からの再生成も用意する。CLI名称や自動生成の設定方法は詳細設計で決める。
- RPT-03: 原テストのoutcomeとレポート生成の成否を別々に記録する。生成失敗や入力不足を原テストの成功へ置き換えず、終了code／stdoutの既存契約との統合方法を明示する。

### 画面と操作

- RPT-04: 概要に結果、実行日時、所要時間、mode、対象platform、run／session ID、対象revisionを表示する。実環境受入状態はテスト結果と別に表示する。
- RPT-05: 結果一覧に失敗、finding、停止理由を表示し、状態・platform・キーワードで絞り込み、選んだ項目の詳細を開けるようにする。findingは探索上の気づきとして表示し、未確認の不具合を確定扱いにしない。
- RPT-06: 操作履歴を時系列で辿り、関連する保存済みscreenshot・video・sampled framesを確認できるようにする。trace ZIPは別viewerで開くための案内を付ける。証跡が未取得、保持対象外、利用不可の場合は理由を表示する。
- RPT-07: 探索では状態数・遷移数・coverage・未探索項目を表示する。coverageの分母と対象範囲を示し、対応しないmodeの値を0や100%で埋めない。
- RPT-08: 状態を色だけで区別せず、文字ラベルとキーボード操作を備える。0件、長いメッセージ、多数の結果でも主要操作が使えるようにする。

### 保存・共有・根拠

- RPT-09: 初期形式はローカルで開けるHTMLを提案する。HTMLと必要な画像・動画をまとめたフォルダを持ち運べる構成にし、CSS／JavaScriptを含め外部CDNやサービスへの接続を必要としない。大きな動画も含む単一HTML化は必須にしない。
- RPT-10: 既存JSON、events、failure report、HATE manifestを読み、元データと対応する派生成果物として構成する。元run／session artifactとmanifestを変更しない。表示する証跡は参照先・bytes・digestを確認し、確認失敗を見せかけの正常値で埋めない。
- RPT-11: ログ、finding、名前、URLなどの入力値を実行可能なHTML／JavaScriptとして扱わない。共有用の出力には検査済みの表示データと許可された証跡だけを含め、raw DOM・認証状態・秘密値を混入させない。画像・動画には既存のclassification／attestation方針を適用する。
- RPT-12: fixture／mock／emulator／realの区別、証跡欠落、`pending_external`を画面に保持する。Lakdaのrun結果やレポート生成成功からQEG verdictを生成しない。

### 後続候補・未確定事項

- RPT-13: 前回runとの比較画面と状態遷移graphの対話表示は、初期レポートの後続候補とする。比較データには既存の`runs compare`を利用する案がある。
- RPT-14: AIによる文章要約は任意の後続候補とする。初期表示は保存済み結果を根拠に構成する。AI要約を加える場合も観測事実・推測を区別し、outcomeやGateを変更しない。
- レポートを生成後にブラウザで自動的に開くか、保存先だけを通知するか。
- HTMLに加えてPDF、単一HTML、共有ZIPのどれを必須にするか。
- 一回のrun、複数run、開発用テストsuiteのどこまでを初期リリースに含めるか。
- IMP-01〜07の採否、着手順、実装Task Seedへの分割。

## 4. 現状の再利用先と調査根拠

- [run詳細・比較型](../../src/runs/types.ts): metadata、outcome、terminationReason、graph／coverage、比較結果。
- [探索report型](../../src/exploration/contracts.ts)と[生成処理](../../src/exploration/session.ts): findings、blockers、capture、実行資格、受入状態。
- [Lead report処理](../../src/commands/scouting.ts): JSON出力と、Lead ID・priority・statusを並べる簡易HTMLが既存実装にある。
- [run catalog仕様](../spec/maintainability/SPEC-04-RUN-CATALOG-GRAPH-COMPARISON.md): 読取専用・比較可能性・元証跡再検証の契約。
- [bridge README](../../tools/airtest-poco-bridge/README.md)と[bridge契約テスト](../../tests/airtest-poco-bridge-contract.spec.ts): Python実行確認、依存固定、identity、binary attestationの現在の境界。
- [Legacy P6 workflowの保存内容・来歴](../release-gate/history/README.md)、[Task 59](../tasks/TASK.20260802-59.md)、[Task 60](../tasks/TASK.20260802-60.md): 既存改修候補と受入記録の根拠。workflowは詳細化後の改修で履歴へ退避した。

## 5. 今回の作業範囲

要求草案、チェックリスト、文書索引だけを追加・更新する。runtime、CI、依存関係、既存証跡は変更しない。検証は`npm run check:docs`と`git diff --check`で行う。
