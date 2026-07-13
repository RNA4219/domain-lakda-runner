---
task_id: 20260712-04
intent_id: INT-LAKDA-001
owner: RNA4219
status: reviewing
last_reviewed_at: 2026-07-13
next_review_due: 2026-08-12
---

# Task Seed: M4 replay・golden acceptance

## State history

- `in_progress` — v1 PoC実装、fixture corpus、CI、実Qwen検証を実施。
- `reviewing` (2026-07-13) — 全MustとAC-001〜AC-013の証跡を確認し、最終完了記録とBirdseye更新を待つ。

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

- fixture/fake LLM: [AC-20260713-01.fixture.json](../acceptance/AC-20260713-01.fixture.json) — deterministic、replay、artifact、HATE、security、critical goldenの集計。
- 実Qwen 4B: [AC-20260713-02.real-llm.json](../acceptance/AC-20260713-02.real-llm.json) — 20 decision×3、critical 10×3の90 run。strict JSON、候補外操作なし、fallbackなし、critical 30/30を確認。
- main CI: [run 29228033697](https://github.com/RNA4219/domain-lakda-runner/actions/runs/29228033697) — docs-contract、quality、package-smoke、chromiumが成功。

Should要件（NF-005〜006等）はpost-v1として記録する。
