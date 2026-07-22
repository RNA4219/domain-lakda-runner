---
task_id: TASK.20260722-52
intent_id: INT-LAKDA-MNT-001
status: done
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P2
depends_on: [TASK.20260722-51]
---

# Task Seed: Coordinator責務分割

## Objective

Coordinatorをruntime setup、観測loop、選択、oracle、recovery、shrinkingへ分割し、既存action sequenceとterminationを維持する。

## Scope

In: coordinator内部module、既存facade、characterisation test。Out:探索policy、artifact path、終了codeの変更。

## Requirements

REQ-MNT-MOD-002、REQ-MNT-MOD-004。AC-MNT-009。

## Plan

1. 公開I/Oと決定的action sequenceを固定する。
2. loop/setup/oracle/recovery/shrinkingを責務別moduleへ移す。
3. 既存5 modeとtermination reasonを回帰する。

## Patch

Coordinator公開class/functionは互換facadeとして残す。

## Tests

`coordinator.spec.ts`と`coordinator-modules.spec.ts`でfacade同値性とmodule境界を検証する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/coordinator.spec.ts tests/adaptive/coordinator-modules.spec.ts`
- `npm run typecheck`

## Notes

分割によってreplay digestやevidence pathを変更しない。

## Evidence

- 対象test: `tests/adaptive/coordinator.spec.ts`、`tests/adaptive/coordinator-modules.spec.ts`。
- 対象revision: `74a2a9b47cc106795320323a597dfdf5931cbead`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/coordinator.spec.ts tests/adaptive/coordinator-modules.spec.ts`、`npm run typecheck`。
- 終了code: 対象commandはいずれも`0`。
- Acceptance: [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)。
