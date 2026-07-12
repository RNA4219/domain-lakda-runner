---
task_id: 20260712-03
intent_id: INT-LAKDA-001
owner: RNA4219
status: planned
last_reviewed_at: 2026-07-13
next_review_due: 2026-08-12
---

# Task Seed: M3 ローカル LLM `llm-explore`

## Objective

OpenAI互換 loopback client と strict decision validator を実装し、安全な候補IDだけを選ぶ `llm-explore` を追加する。

## Scope

- `127.0.0.1` または `localhost` の `/v1/models`、`/v1/chat/completions`。
- model ID/GGUF SHA確認、strict JSON、candidate allowlist、evidence、retry、timeout、redaction。
- LLM decision JSONL（LakdaのHATE audit recordではない）。

## Requirements / Acceptance

REQ-LLM-001〜009、REQ-SEC-001〜002、005〜007 を AC-007〜AC-011、AC-013 で検証する。schema不正、candidate違反、model mismatchはretryせず `error`（exit 1）。retryはconnection reset と500/502/503/504に限り、初回に加え最大2回とする。

## Evidence

fake OpenAI serverによるSSE/5xx/reset/timeout/invalid JSON、allowlist、fallback禁止、critical goldenの契約テスト。実GGUFはopt-in local suiteとする。
