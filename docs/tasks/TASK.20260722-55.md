---
task_id: TASK.20260722-55
intent_id: INT-LAKDA-MNT-001
status: reviewing
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P1
depends_on: [TASK.20260722-54]
---

# Task Seed: runs list・show read-only catalog

## Objective

`runs list`と`runs show`をread-only catalogとして追加し、上限100件、決定的順序、sanitized versioned outputを保証する。

## Scope

In: run index/detail schema、catalog reader、CLI list/show。Out: delete、prune、外部upload、artifact書換え。

## Requirements

REQ-MNT-RUN-001、REQ-MNT-RUN-002、REQ-MNT-RUN-006、REQ-MNT-RUN-007。AC-MNT-007。

## Plan

1. run directoryを変更しないreaderを実装する。
2. 開始日時降順・同値run ID順・最大100件を固定する。
3. secret/PII/absolute pathをschemaとtestで拒否する。

## Patch

catalog出力はversioned canonical JSONとし、元run artifactを更新しない。

## Tests

`tests/runs.spec.ts`で順序、上限、read-only、malformed runを検証する。

## Commands

- `npx playwright test --workers=1 tests/runs.spec.ts`
- `npm run test:contracts`

## Notes

不完全runは明示状態で表示し、黙って正常runへ分類しない。

## Evidence

- 対象test: `tests/runs.spec.ts`。
- 対象command: `npx playwright test --workers=1 tests/runs.spec.ts`、`npm run test:contracts`。
- 状態: 統合Gate記録待ち。
