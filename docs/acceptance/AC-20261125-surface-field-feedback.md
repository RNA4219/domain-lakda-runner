---
status: acceptance_plan
owner: RNA4219
last_reviewed_at: 2026-11-25
---

# 実利用で判明した画面/APIカバレッジ5項目の受入

対象は9674374に対する利用者の報告である。画面/APIの実行観測と公開範囲に限定し、1（識別子の保存破損）と3（製品版と実行元SHAの混同）を修正する。利用者が追加を明示承認した2（準備完了条件）、4（hash routeと同一URL内のDOM状態）、5（既存Playwright E2E用公開SDK）も含める。

仕様・判定根拠は[SPEC-10](../spec/e2e-platform/SPEC-10-RUNTIME-SURFACE-COVERAGE.md)の「実利用フィードバックへの追加契約」と[AC-S14〜19](../spec/e2e-platform/CHECKLIST-10-RUNTIME-SURFACE-COVERAGE.md)。使い方は[導入例](../../examples/surface-coverage/README.md)を正本とする。

実行場所はDESKTOP-HCPVLHMの `C:/Users/ryo-n/Codex_dev/_worktrees/lakda-runtime-coverage-20261125` のみ。以前のタスクは再開せず、別PC・クラウド作業環境へ委譲しない。試験対象はlocalhostの合成アプリであり、報告された実製品や実在の認証情報を利用しない。攻撃・侵入試験、本番配備は対象外。

通常テストとfixtureの件数は補助証跡とする。同PCの `C:/Users/ryo-n/Codex_dev/manual-bb-test-harness` の正式手順・CLIで観点、リスク、ケース、開始/停止条件、工数、実行結果、Gateを結ぶ。版を固定したケースごとに実際のCLI・ブラウザー・SDK入力と出力を保持する。失敗した製品runと手動ケースの合否を混同しない。

対象SHA、製品側の宣言revisionと実行元SHA、ケースごとのpass/fail/skip、観測とHATEのdigest、通常検証、残留制約、PRとマージの記録は、作業ツリー内の `.lakda/surface-field-feedback-20261125/final-record.json` とその隣のケース定義・実行証跡を正本とする。本書自体は受入手順と範囲を固定するもので、未実行のケースや外部製品の受入を合格とは扱わない。既存の破損済み観測は書き換えず、修正版で再実行する。

準備完了条件はアプリ全体の将来の通信を保証しない。DOM状態の到達はunknown laneで、状態だけからAPI関係を推測しない。SDKは呼出側のテスト結果を記録し、テストランナー・ブラウザー・認証・routingの所有権を取らない。これらの制約を含めて受入結果を読む。
