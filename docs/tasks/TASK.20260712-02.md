---
task_id: 20260712-02
intent_id: INT-LAKDA-001
owner: RNA4219
status: planned
last_reviewed_at: 2026-07-13
next_review_due: 2026-08-12
---

# Task Seed: M2 証跡収集・HATE/v1

## Objective

Collector と HATE/v1 exporter を実装し、全完了runの監査可能な artifact を固定する。

## Scope

- run metadata、action sequence、console JSONL、failure report、artifact hash/redaction、manifest。
- failed/partial で trace と screenshot、profile 明示時だけ video/HAR/DOM snapshot。
- `lakda export hate --run-dir --out` と固定 HATE/v1 schema 検証。

## Requirements / Acceptance

REQ-FN-008〜010、REQ-SEC-003〜005、REQ-NF-003〜004 を AC-005、AC-006、AC-013 で検証する。必須artifact生成・hash・manifest失敗は UI-008 の runner error（exit 1）とする。HATE audit record と QEG record は生成しない。

## Evidence

artifact lifecycle、redaction、schema、失敗時必須 trace/screenshot の契約テスト。
