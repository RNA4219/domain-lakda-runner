---
status: acceptance_plan
owner: RNA4219
last_reviewed_at: 2026-11-26
---

# 末尾スラッシュとrole readyの受入

起点a0d155d（#27）で報告された2件を対象とする。要件は、末尾スラッシュ付き正規画面を直接登録して画面/API/関係を観測できること、およびtestIdなし製品をreadyのrole＋名前で待てることである。[SPEC-10](../spec/e2e-platform/SPEC-10-RUNTIME-SURFACE-COVERAGE.md)、[AC-S20〜22](../spec/e2e-platform/CHECKLIST-10-RUNTIME-SURFACE-COVERAGE.md)、[導入例](../../examples/surface-coverage/README.md)を判定根拠とする。

実行機はDESKTOP-HCPVLHM、worktreeは `C:/Users/ryo-n/Codex_dev/_worktrees/lakda-slash-role-ready-20261126`、branchは `fix/surface-slash-role-ready-20261126` に固定する。対象はlocalhost合成アプリだけで、実製品・本番・侵入試験は行わない。別PCやCloud taskへの再委譲と、ローカル生ログ/証跡の転送は行わない。

観点はURLの同値分割と境界、readyの状態遷移、公開制御と定義digest、CLI/SDK回帰とする。誤ったURL同一視、readyの早期完了、公開漏えいをP1として優先し、根拠・risk・priority・手動ケース・工数・Gate・briefを正式manual-bb-test-harnessへ渡す。開始条件は機器/branch一致とlocalhost限定、停止条件は対象外接続・証跡不整合・未解決の失敗である。

CLI replay、packから隔離installした公開SDKのcheckpoint/finish、専用indexからのcoverage surfaces JSON/HTMLを実行する。slashなしと単一末尾、root、中間空segment/二重末尾拒否、template/hashRoute、非公開重なり、旧カタログ/digest、testId互換、roleの完全一致/複数候補/未表示/timeout、遅延実通信/画面→API、outcomeの独立性、観測/公開出力/診断の非漏えいを確認する。通常Playwrightは補助とし、手動ブラックボックス結果には定義版・内容hash・oracle版・対象SHAと実入力/出力参照を結ぶ。

結果の正本はこのworktreeの `.lakda/slash-role-ready/final-record.json` と隣接するmanual-bb artifactであり、Gitへは転送しない。全予定ケースpass、fail/skip/blocked/unknown/untestedが0、正式Gate go、通常check/packと適用GitHub checksの成功が最終headに揃った場合だけ通常操作でマージする。マージ後は検証headとマージcommitのtreeを比較する。本書は手順の定義であり未実行結果の成功宣言ではない。外部製品のログイン、hash route実環境、認証と接続先真正性は未検証のまま残る。
