---
task_id: TASK.20260713-05
status: completed
owner: RNA4219
created_at: 2026-07-13
updated_at: 2026-07-13
---

# Task Seed: v0.2.0 責務分離・実行契約

## 目的

Artifact Store、Artifact/Outcome Policy、Action Budgetを独立させ、逐次worker batch、DOM snapshot redaction、設定正規化を実装する。追加のClassifier/Auth/Doctor/LLM transport分割、並列worker、cross-browser、QEG/Gateは次Taskへ送る。

## 変更境界

- production: Artifact Store/Policy、Outcome Policy、Action Budget、runner/CLI/types/config/LLM。
- test: Action Budget、worker batch、rate limit、DOM redaction、設定正規化、fake LLM契約。
- docs: REQUIREMENTS、SPECIFICATION、EVALUATION、BLUEPRINT、GUARDRAILS、RUNBOOK、CHANGELOG、Birdseye、acceptance record。
- CI/dependency: 新規依存なし。既存check/package/fixture workflowを維持する。

## 実装順

1. Artifact Storeを抽出し、Collector/HATE Exporterの循環依存を解消する。
2. Artifact PolicyとOutcome Policyを純粋関数として接続し、保存後実bytes scanとredactionを検証する。
3. fake clockのAction Budgetを追加し、batch共有budgetへ接続する。
4. workerを逐次実行し、派生seed、独立run/HATE、全worker継続、`RunBatchResult`を検証する。
5. redacted DOM snapshot、`fixtureResetConfigured`導出、`llm.seed`同期、version 0.2.0を検証する。
6. docs、acceptance、Birdseyeを更新し、check/hate/pack/fixture/CIを確認する。

## 受入

- AC-014: workers=2..4のbatch契約、seed、独立artifact、aggregate outcome、fake LLM契約。
- AC-015: 60秒sliding window共有budget、LLM/Playwright操作0、`partial/rate_limit`、exit 2。
- AC-016: action後redacted DOM、HATE `static`登録、script/form/token/email/sensitive非保存、実bytes scan。
- `npm run check`、`npm run check:hate`、`npm run pack:check`、`npm run acceptance:fixture`、critical local-LLM acceptanceが成功する。
- source/test/CI/dependency以外の変更を混入させず、生run artifactをcommitしない。

## 証跡

- fixture: `tests/v02.spec.ts`、`docs/acceptance/AC-20260713-03.v02-fixture.json`
- local LLM: `docs/acceptance/AC-20260713-04.v02-real-llm.json`
- CI: GitHub Actions URLを完了記録へ追記
- code map: `docs/BIRDSEYE.md`、`docs/codemap.generated.json`