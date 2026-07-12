---
task_id: 20260712-04
intent_id: INT-LAKDA-001
owner: RNA4219
status: planned
last_reviewed_at: 2026-07-13
next_review_due: 2026-08-12
---

# Task Seed: M4 replay・golden acceptance

## Objective

regression-replay、固定corpus、AC-001〜AC-013の集計・受入証跡、CIとローカル実LLM検収を完成する。

## Scope

- `lakda replay --input --base-url`、20 sequence×3 の replay 集計。
- known defect 20、normal 20、LLM decision 20（critical 10を含む）の固定fixture。
- HATE manifest検証、secret/code execution不在、metrics/acceptance report。
- GitHub Actionsはfixture/fake LLMのみ、実GGUFはlocalhost opt-in。

## Requirements / Acceptance

全 Must（REQ-FN-001〜012、REQ-LLM-001〜009、REQ-SEC-001〜007、REQ-NF-001〜004）を AC-001〜AC-013 と対応付ける。`lakda:*` はHATE入力内のみ許容し、QEG変換/Gate判定は行わない。

## Evidence

version/SHA付きcorpus、3回反復集計、CI run URL、実機LLM evidence、release readiness report。Should要件（NF-005〜006等）はpost-v1として記録する。
