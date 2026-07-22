---
task_id: TASK.20260722-44
intent_id: INT-LAKDA-MNT-001
status: in_progress
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-43]
---

# Task Seed: 文書索引・HUB・Birdseye・checker同期

## Objective

現行正本への入口をdocs索引、HUB、Birdseyeへ接続し、正本分岐、欠落checklist、stale profile、全schema不整合をCIで検出する。

## Scope

In: docs index、HUB、BIRDSEYE/codemap、scripts/check-docs.mjs。
Out: Acceptance artifact本文、QEG保存artifact、実target実行。

## Requirements

REQ-MNT-GOV-001、REQ-MNT-GOV-002、REQ-MNT-GOV-007。AC-MNT-001。

## Plan

1. docs/spec/tasks/acceptance/release-gateの索引を追加する。
2. HUBとcodemap discoveryへ現行正本を登録する。
3. checkerへ1対1、alias、全schema、profile、index、workflow検査を追加する。
4. canonical codemap toolでBirdseyeを再生成する。

## Patch

索引は現行とHistoricalを分離し、歴史的artifactそのものは変更しない。

## Tests

broken link、重複document ID、孤立要件、alias checkbox、schema compile、profile不一致、過去RC固定値をnegativeで検出する。

## Commands

- `npm run check:docs`
- Codemap dry-run / generate
- `git diff --check`

## Notes

Birdseyeは生成物間の世代を揃え、indexだけを手編集しない。
