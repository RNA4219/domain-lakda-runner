---
task_id: 20260712-01
intent_id: INT-LAKDA-001
owner: RNA4219
status: in_progress
last_reviewed_at: 2026-07-13
next_review_due: 2026-08-12
---

# Task Seed: M1 決定的実行・認証・機械オラクル

## Objective

設定、CLI、deterministic plan、Chromium Executor、persona storageState、機械rule、`doctor`、終了コードを実装する。

## Scope

- `smoke` / `seeded-random` の実行前plan、stable sort、seeded RNG、safety filter。
- `lakda run`、`doctor`、`auth capture`、`auth validate` と `RunResult`。
- UI-001〜UI-007、`passed|failed|partial|error` と `0|2|2|1`。
- deterministic mode は LLM 不在を `llm_status=unavailable` として続行する。

## Requirements / Acceptance

REQ-FN-001〜003、006〜007、011〜012、REQ-SEC-001〜002、006〜007、REQ-NF-002 を AC-001〜AC-003、AC-011〜AC-012 へ対応付ける。browser crash と timeout は run failure（exit 2）であり、config/schema/provider のみが runner error（exit 1）である。

## Out

replay、HATE export、LLM provider、QEG。

## Evidence

fixture の headed/headless smoke、same-seed plan byte equality、rule/exit-code/auth/doctor の契約テスト。
