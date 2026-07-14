---
task_id: TASK.20260713-06
status: completed
owner: RNA4219
created_at: 2026-07-13
updated_at: 2026-07-13
---

# Task Seed: v0.2.1 Artifact Hardening

## 目的

Action Budget、HAR/security/classification、Artifact/Outcome Policyの確定順序、DOM容量と異常系を実装契約として固定し、v0.2.0の責務分離を実運用可能なPoCへ引き上げる。Classifier、Auth/Doctor、LLM transport分割、並列worker、cross-browser、QEG/Gateは次Taskへ送る。

## 変更境界

- production: ActionBudget、ArtifactCollector、ArtifactPolicy、OutcomePolicy、HATE exporter、runner、config/types。
- test: fake clock、batch先頭rate-limit、HARの全header/cookie/Set-Cookie/query/body redactionとclassification、alternate/default HATE再export、DOM最終容量、fixture reset/executor/export異常系。
- docs: REQUIREMENTS、SPECIFICATION、EVALUATION、BLUEPRINT、GUARDRAILS、RUNBOOK、CHANGELOG、Birdseye、AC-017/018。
- CI/dependency: 新規依存なし。既存workflowとHATE/v1 schemaを維持する。

## 実装順

1. batch全体で共有する60秒sliding-window Action Budgetをruntime contextへ注入し、上限判定をLLM preflight/Playwright起動より前へ置く。
2. HARを`content=omit`の一時captureへ分離し、全header値、cookie/Set-Cookie、query値、bodyを構造化redactionし、raw削除、実bytes scan、classificationをHATEへ伝播する。
3. base artifacts → scan → outcome → atomic metadata/failure → final-byte rescan → HATE exportの順でPolicyを確定し、VerifiedArtifactのbytes変更を拒否する。生成済み`exports/`は再export入力から除外する。
4. DOM snapshotの保存前容量判定と最終必須artifact後の任意snapshot除去、実保存件数による期待値、browser未起動時のartifact適用除外、fixture reset/executor/rate_limit/export失敗時のtermination reason・manifest pathを検証する。
5. docs、Task Seed、acceptance、Birdseyeを更新し、docs/typecheck/lint/build/test/HATE/package/fixture/CIを確認する。

## 受入

- AC-015: batch共有Action Budget、先頭枯渇時のLLM preflight/Playwright操作0、`partial/rate_limit`、exit 2。
- AC-016: `data-lakda-sensitive`要素の内容・全属性を除去したredacted DOM、HATE `static`、実bytes scan、保存時・最終容量超過、browser未起動、snapshot保存失敗の異常系。
- AC-017: HAR一時capture、全header値、cookie/Set-Cookie、query値、bodyのredaction、raw削除、classification、alternate/default HATE再export一致。
- AC-018: Policy確定順序、atomic metadata/failure、VerifiedArtifact bytes不変、export失敗時の`artifactManifestPath`不返却、termination reason、workers整数検証。
- `npm run check`、`npm run check:hate`、`npm run pack:check`、`npm run acceptance:fixture`、critical local-LLM acceptanceが成功する。
- source/test/CI/dependency以外の変更を混入させず、生run artifactをcommitしない。

## 証跡

- fixture: `tests/v02.spec.ts`、`docs/acceptance/AC-20260713-05.v021-hardening-fixture.json`
- local LLM: `docs/acceptance/AC-20260713-06.v021-hardening-real-llm.json`
- CI: GitHub ActionsのActions URLを完了記録へ追記
- code map: `docs/BIRDSEYE.md`、`docs/birdseye/index.json`、`docs/birdseye/hot.json`、`docs/birdseye/caps/`
