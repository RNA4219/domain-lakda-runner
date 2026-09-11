---
document_id: LAKDA-DOC-INDEX-001
status: active
last_updated: 2026-09-10
---

# Lakda 文書索引

## 現行正本

1. [README](../README.md) — 製品概要、機能、CLI入口
2. [保守性・拡張性要件](../REQUIREMENTS-MAINTAINABILITY.md) — 0.4系の現行改修正本
3. [適応型探索要件](../REQUIREMENTS-ADAPTIVE-EXPLORATION.md) — P1〜P7契約
4. [Lakda拡張要件](spec/Lakda拡張要件定義書.md) — P8〜P11契約
5. [現行実装計画](IMPLEMENTATION-PLAN-MAINTAINABILITY.md) — Workflow-cookbook形式
6. [current release profile](../release-profiles/current.json) — live release入力
7. [RUNBOOK](../RUNBOOK.md) / [GUARDRAILS](../GUARDRAILS.md) — 実行と安全境界

## ディレクトリ

- [仕様](spec/README.md)
- [Task Seeds](tasks/README.md)
- [受入・実環境runbook](acceptance/README.md)
- [歴史的release Gate設計](release-gate/README.md)
- [Birdseye](BIRDSEYE.md)
- [ライセンスFAQ](licensing/FAQ.md)
- [対象資料](targets/README.md)

## 検討中の要求

- [改修要件のレビュー用要約](proposals/20260911-requirements-brief.md) — 最初に確認する完成形、7件の改修、レポートの初期範囲と利用シナリオ。
- [実装仕様・セルフレビュー](spec/verification-reports/README.md) — 詳細要件を仕様3件とTask 61〜69へ展開。実装を進行中。
- [2026-09-10 改修要件定義](proposals/20260910-detailed-requirements.md) — 7件の改修の対象範囲、段階、詳細要件、既定値と外部条件。
- [テスト実行後レポート詳細](proposals/20260910-report-detail.md) — 画面、CLI、データ、異常時、共有profile、性能・操作性。
- [詳細受入チェックリスト](proposals/20260910-detailed-checklist.md) — 要件とACの対応、期待結果、必要証跡。
- [2026-09-10 初期要求草案](proposals/20260910-improvement-requirements.md) — 詳細化前の検討経緯。実装向けの条件は上記詳細要件を参照。
- [初期要求チェックリスト](proposals/20260910-improvement-checklist.md) — 初期整理の履歴。

## 証跡資格

fixture、mock、simulatedは補助証跡である。実target受入、manual-bb、外部QEGが未完了なら`pending_external`を維持し、LakdaはQEG verdictを生成しない。
