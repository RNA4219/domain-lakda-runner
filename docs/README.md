---
document_id: LAKDA-DOC-INDEX-001
status: active
last_updated: 2026-07-22
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

## 証跡資格

fixture、mock、simulatedは補助証跡である。実target受入、manual-bb、外部QEGが未完了なら`pending_external`を維持し、LakdaはQEG verdictを生成しない。
