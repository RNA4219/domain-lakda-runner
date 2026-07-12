---
intent_id: INT-LAKDA-001
owner: RNA4219
status: active
last_reviewed_at: 2026-07-12
---

# domain-lakda-runner HUB

## 文書の優先順位

1. [REQUIREMENTS.md](REQUIREMENTS.md) — 要件の正本
2. [SPECIFICATION.md](SPECIFICATION.md) — 実行・CLI・LLM契約の正本
3. [BLUEPRINT.md](BLUEPRINT.md) — 課題、スコープ、I/O、最小フロー
4. [GUARDRAILS.md](GUARDRAILS.md) — 安全境界と変更境界
5. [RUNBOOK.md](RUNBOOK.md) — prepare → execute → confirm
6. [EVALUATION.md](EVALUATION.md) — 受入条件、指標、トレーサビリティ
7. [deep-research-report (11).md](deep-research-report%20%2811%29.md) — 参考資料（非規範）

## 実装順

- M0: [TASK.20260712-00.md](docs/tasks/TASK.20260712-00.md) — 実装準備
- M1: [TASK.20260712-01.md](docs/tasks/TASK.20260712-01.md) — 決定的コア
- M2: [TASK.20260712-02.md](docs/tasks/TASK.20260712-02.md) — 証跡と HATE/v1
- M3: [TASK.20260712-03.md](docs/tasks/TASK.20260712-03.md) — `llm-explore`
- M4: [TASK.20260712-04.md](docs/tasks/TASK.20260712-04.md) — replay と golden acceptance

## 連携境界

Lakda は HATE/v1 manifest までを生成する。QEG 変換と Gate verdict は HATE/QEG 側で行う。Birdseye/Codemap はコード生成後、workflow-cookbook の生成手順に従って追加する。

## 受入記録

計画中の準備記録は [AC-20260712-00.md](docs/acceptance/AC-20260712-00.md)。実装 Task の完了ごとに新しい acceptance record を作成する。

