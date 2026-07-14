---
intent_id: INT-LAKDA-001
owner: RNA4219
status: active
last_reviewed_at: 2026-07-14
---

# domain-lakda-runner HUB

## 文書の優先順位

1. [REQUIREMENTS.md](REQUIREMENTS.md) — 現行v1要件の正本
2. [SPECIFICATION.md](SPECIFICATION.md) — 現行v1の実行・CLI・LLM契約の正本
3. [REQUIREMENTS-ADAPTIVE-EXPLORATION.md](REQUIREMENTS-ADAPTIVE-EXPLORATION.md) — post-v1適応型探索・共通コアの追加要件ドラフト
4. [適応型探索仕様書群](docs/spec/adaptive-exploration/) — 6仕様書、対応チェックリスト、一次所有
5. [適応型探索評価仕様](docs/spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md) — post-v1受入条件と必要証跡
6. [適応型探索実装計画](docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) — Workflow-cookbookのTask Seed、Phase Gate、受入証跡
7. [BLUEPRINT.md](BLUEPRINT.md) — 課題、スコープ、I/O、最小フロー
8. [GUARDRAILS.md](GUARDRAILS.md) — 安全境界と変更境界
9. [RUNBOOK.md](RUNBOOK.md) — prepare → execute → confirm
10. [EVALUATION.md](EVALUATION.md) — 現行v1受入条件、指標、トレーサビリティ
11. [deep-research-report (11).md](deep-research-report%20%2811%29.md) — 参考資料（非規範）

## 実装順

- M0: [TASK.20260712-00.md](docs/tasks/TASK.20260712-00.md) — 実装準備
- M1: [TASK.20260712-01.md](docs/tasks/TASK.20260712-01.md) — 決定的コア
- M2: [TASK.20260712-02.md](docs/tasks/TASK.20260712-02.md) — 証跡と HATE/v1
- M3: [TASK.20260712-03.md](docs/tasks/TASK.20260712-03.md) — `llm-explore`
- M4: [TASK.20260712-04.md](docs/tasks/TASK.20260712-04.md) — replay と golden acceptance
- post-v1: [追加要件](REQUIREMENTS-ADAPTIVE-EXPLORATION.md) → [6仕様書・チェックリスト](docs/spec/adaptive-exploration/) → [評価仕様](docs/spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md) → [実装計画](docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) → [TASK.20260714-08](docs/tasks/TASK.20260714-08.md)

## 連携境界

Lakda は HATE/v1 manifest までを生成する。QEG 変換と Gate verdict は HATE/QEG 側で行う。Birdseye/Codemap はコード生成後、workflow-cookbook の生成手順に従って追加する。

## 受入記録

計画中の準備記録は [AC-20260712-00.md](docs/acceptance/AC-20260712-00.md)。実装 Task の完了ごとに新しい acceptance record を作成する。

