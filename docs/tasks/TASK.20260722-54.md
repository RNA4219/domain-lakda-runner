---
task_id: TASK.20260722-54
intent_id: INT-LAKDA-MNT-001
status: reviewing
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P2
depends_on: [TASK.20260722-53]
---

# Task Seed: CLI責務分割

## Objective

CLI parsing、command dispatch、output/exit codeを分割し、既存help、公開command、終了codeを維持する。

## Scope

In: `src/cli`/`src/commands`内部module、既存entry facade。Out: command rename、破壊的run操作、QEG command追加。

## Requirements

REQ-MNT-MOD-003、REQ-MNT-MOD-004。AC-MNT-009。

## Plan

1. CLI help、argument、exit codeをcharacterisation testで固定する。
2. parser/dispatcher/command実装を分離する。
3. 既存P10/replay/acceptance commandを回帰する。

## Patch

既存`src/cli.ts`とpackage binを互換入口として残す。

## Tests

`tests/cli-boundaries.spec.ts`と`tests/adaptive/p10-cli.spec.ts`で境界とhelpを検証する。

## Commands

- `npx playwright test --workers=1 tests/cli-boundaries.spec.ts tests/adaptive/p10-cli.spec.ts`
- `npm run typecheck`

## Notes

run delete/prune/uploadやLakda内QEG verdict commandは追加しない。

## Evidence

- 対象test: `tests/cli-boundaries.spec.ts`、`tests/adaptive/p10-cli.spec.ts`。
- 対象command: `npx playwright test --workers=1 tests/cli-boundaries.spec.ts tests/adaptive/p10-cli.spec.ts`、`npm run typecheck`。
- 状態: 統合Gate記録待ち。
