---
status: manual_bb_pending
owner: RNA4219
last_reviewed_at: 2026-11-25
---

# 画面・API の実行カバレッジ: ローカル受入

対象は [SPEC-10](../spec/e2e-platform/SPEC-10-RUNTIME-SURFACE-COVERAGE.md) と [AC-S01〜12](../spec/e2e-platform/CHECKLIST-10-RUNTIME-SURFACE-COVERAGE.md)。PR は [#25](https://github.com/RNA4219/domain-lakda-runner/pull/25)。既存の変更がある main worktree は操作せず、origin/main `d722c68` から専用 worktree を作成した。機能 commit `8d47ef6` と API document navigation の補足を検証した。

実装・手元の検証・GitHub 操作のホスト名を `hostname` と Windows のコンピューター情報で照合し、`DESKTOP-HCPVLHM` と確認した。クラウド作業環境へリポジトリ・成果物・テストデータをコピーしていない。Node 24.11.0 / npm 11.6.1 / Windows / Chromium / Python 3.11.9。既存 GitHub Actions は通常の PR チェックとして別途照合する。

| 検証 | 実結果 |
|---|---|
| `npm run check` | docs、typecheck、lint、build と全637テスト通過、4.2分 |
| 最後の補足後の surface/console/CLI 契約テスト | 14/14 通過、19秒 |
| `npm run pack:check` | 666ファイルの内容検査、隔離インストールと公開 CLI/import の検証を通過 |
| `npm run acceptance:fixture` | overall=true。critical golden 30/30、manifest 215/215、secretPlaintextFound=0、unsafeExecutions=0、fallbackCount=0 |
| `npm run test:bridge:python` | 175/175 通過、skip=0 |
| 最後の変更後の typecheck/lint/docs | 通過。既存文書の review 期限警告のみ |
| `git diff --check` | 通過 |

最後の14件は source/CLI の補足後に実行した。全637件の後で追加した document-navigation ケースも含む。fixture の生の run・録画・画面画像は Git に追加せず、この PC 内の `.lakda/` と `test-results/` に保持する。テストデータは localhost の架空製品のみ。

## 重要な確認結果

- platform の起動からブラウザーの実行ボタン、同じ回の一覧、テスト証跡まで確認した。実行後に所有者が許可を狭めると、一覧・関係・証跡・集計・JSON が更新された。一般ケース・図・動画への直接 URL は 404。
- 402画面・1002 API の一覧を50件ずつ表示し、利用頻度、チャネル、分類、検索と部分図40箱/80線の上限・省略を PC と390px幅で確認した。
- query、body、認証ヘッダー、動的パスと未知 URL に異なる sentinel を入れ、新しい観測と公開出力に保持しないことを確認した。
- 同じ API を呼ぶ複数画面、iframe、SPA、API への直接 document navigation を区別し、親画面や遷移前の画面へ関係を推測しない。
- Service Worker を有効のまま、Worker 内完結と実 upstream fetch を確認した。upstream の実呼び出しは1回、集計も API 1件。どちらも unknown とし、real の親画面関係を作らない。
- キャッシュヒットでも serverAddr が残ることを確認した。回帰テストでは実 upstream 1回の後に同じ API を2回キャッシュから読み、全て unknown。CDP の非キャッシュ観測を一意に照合できる通常通信だけを real とする。
- 旧結果は unmeasured、失敗結果でも実観測は到達、途中の記録欠落は未計測、manifest・attempt 改変は照合拒否。最新回を前回の成功で補わない。

初回の全体検証では追加したヘルプ行に対して既存の完全一致契約テストが失敗したため、契約を更新して637件を再実行した。初回の GitHub Python job では、既存の capture identity/idempotency fixture が空の artifactRefs を参照して IndexError となった。手元の175件と該当手順250回では再現しなかった。時計に依存しないことを意図する当該 fixture だけに有効時刻を固定し、accepted と件数を先に検証する診断も追加した。時刻失効・逆行の専用テストと本体 guard は変更せず、修正後175件通過。最終 PR head の CI が通ることをマージ条件とする。

## 制約

Worker 所有の通信は独立した cache provenance を照合できず、upstream を呼ぶ場合も unknown。既存のローカル診断 artifact の保存 policy は保持するが、公開経路へ配信しない。対象製品の実環境、native/mobile の新しい観測 adapter、ソース抽出、本番頻度自動収集は検証範囲外。実環境受入・QEG verdict・本番配備・認証や権限設定の変更は行っていない。

## 3090 PC 引き継ぎの正式受入

旧タスクは再開せず、DESKTOP-HCPVLHM の指定 worktree でレビューした。未コミット9ファイルは `.lakda/pr25-takeover-20261125/baseline/` に元bytesとSHA-256を保持してから変更を進めた。上記の旧検証は補助証跡として保持し、新しい formal manual-bb の合格とは扱わない。

Windows CI の実通信分類に対して、独立したCDPセッションの応答通知を最大250ms待つよう修正した。照合不能・曖昧・cache・workerはunknownを維持する。75ms遅延する回帰ケースを追加した。Linuxの390px幅は長い対象版と入力の折り返しを修正した。

同PCの `C:/Users/ryo-n/Codex_dev/manual-bb-test-harness` のSkill・RUNBOOK・正式CLIに従い、観点→リスク→10ケース→計画→工数→Gate→briefを記録する。対象はLakda実アプリのlocalhost機能受入で、合成製品のみを用いる。攻撃・侵入、本番配備、別マシン・クラウド作業環境への転送・委譲は行わない。

ケース定義は `.lakda/pr25-takeover-20261125/formal/pr25.manual_case_set.json`、設計は同ディレクトリの親にある `design.md`。結果・最終SHA・各証跡hash・判定は `final-record.json` と `gate.json` に記録する。実行前の本記録ではformal受入はpendingであり、通常suite件数だけでは合格へ変更しない。PR本文は実施後の実測結果で更新し、manual-bb合格と通常GitHubチェックを満たした場合に限りマージする。
