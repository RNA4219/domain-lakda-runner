---
intent_id: INT-LAKDA-001
owner: RNA4219
status: active
last_reviewed_at: 2026-07-22
next_review_due: 2026-08-22
---

# domain-lakda-runner HUB

## 文書の優先順位

1. [README](README.md) / [docs索引](docs/README.md) — 製品入口と文書routing
2. [REQUIREMENTS-MAINTAINABILITY](REQUIREMENTS-MAINTAINABILITY.md) — 0.4系保守・拡張改修の現行正本
3. [maintainability仕様・チェックリスト](docs/spec/maintainability/README.md) — 5仕様と各1正本checklist
4. [current release profile](release-profiles/current.json) — live releaseの機械可読入力
5. [適応型探索要件](REQUIREMENTS-ADAPTIVE-EXPLORATION.md) / [6一次所有仕様](docs/spec/adaptive-exploration/README.md) / [自動探索統合仕様](docs/spec/autonomous-exploratory-testing/README.md)
6. [P8〜P11拡張要件](docs/spec/Lakda拡張要件定義書.md) / [3仕様](docs/spec/lakda-extension/README.md)
7. [REQUIREMENTS.md](REQUIREMENTS.md) / [SPECIFICATION.md](SPECIFICATION.md) / [EVALUATION.md](EVALUATION.md) — v1公開契約
8. [GUARDRAILS](GUARDRAILS.md) / [RUNBOOK](RUNBOOK.md) — 安全境界と実行
9. [Birdseye](docs/BIRDSEYE.md) — 依存トポロジとCapsule
10. [reference](docs/reference/deep-research-report.md) — 非規範資料

## 現行実装順

2026-09-10追加改修は[実装仕様](docs/spec/verification-reports/README.md)と[Task 61](docs/tasks/TASK.20260910-61.md)〜[Task 69](docs/tasks/TASK.20260910-69.md)を入口とする。既存計画のlocal_complete履歴は保持する。

[Workflow-cookbook実装計画](docs/IMPLEMENTATION-PLAN-MAINTAINABILITY.md)を正本とする。

- Phase 0: [TASK.20260722-43](docs/tasks/TASK.20260722-43.md) → [TASK.20260722-44](docs/tasks/TASK.20260722-44.md)
- Phase 1: [TASK.20260722-45](docs/tasks/TASK.20260722-45.md)
- Phase 2〜6: TASK.20260722-46〜58。各Phase Gateが緑になるまで次へ進まない。
- 追加artifact改修: [TASK.20260802-59](docs/tasks/TASK.20260802-59.md)でnon-pass screenshot／trace／WebM保持policyを扱う。
- 探索的テスト仕様: [TASK.20260802-60](docs/tasks/TASK.20260802-60.md)で自動探索、PC／mobile、Windows／Android／iOS、Airtest画像、finding／captureの統合MVPを扱う。
- 歴史的Task Seedは[Task索引](docs/tasks/README.md)から参照する。

## Release / 証跡境界

- live workflowは[current release profile](release-profiles/current.json)からscope、artifact名、設計入力、required checkを解決する。
- [docs/release-gate](docs/release-gate/README.md)の既存JSON/QEGは過去revisionに固定された歴史的artifactであり、current releaseへ流用しない。
- P7/P11は承認、immutable corpus、target manifest、revision/config digestを接続前に検査する。不足時は`pending_external`を維持する。
- LakdaはHATE/v1 manifestまでを担当し、QEG record、approval、waiver、Gate verdictを生成しない。

## 受入記録

[受入索引](docs/acceptance/README.md)でrevisionと証跡資格を確認する。fixture/mockは補助証跡で、実target/manual-bb/QEGを代替しない。
