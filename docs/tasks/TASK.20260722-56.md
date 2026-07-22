---
task_id: TASK.20260722-56
intent_id: INT-LAKDA-MNT-001
status: done
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P1
depends_on: [TASK.20260722-55]
---

# Task Seed: Graph比較・tamper・PII境界

## Objective

`runs compare`でHATE manifestとartifact bytes/hashを再検証し、state/transition/coverage/outcome差分をsanitized canonical JSONで返す。

## Scope

In: run comparison schema、graph comparator、tamper/version/traversal/PII negative。Out: Gate判定、外部upload、比較元artifact変更。

## Requirements

REQ-MNT-RUN-003、REQ-MNT-RUN-004、REQ-MNT-RUN-005、REQ-MNT-RUN-006、REQ-MNT-RUN-007。AC-MNT-008。

## Plan

1. 比較前に両runのmanifest/bytes/size/SHA-256を再検証する。
2. graph versionとcanonical orderingを固定する。
3. tamper、path traversal、secret/PIIを非0 exitで拒否する。

## Patch

比較結果は差分事実だけを表し、regression verdictやGo/No-Goを生成しない。

## Tests

`tests/runs.spec.ts`で正常比較、determinism、tamper、version mismatch、traversal、PIIを検証する。

## Commands

- `npx playwright test --workers=1 tests/runs.spec.ts`
- `npm run test:contracts`

## Notes

比較不能はpass/failへ丸めず、理由付きerrorとして扱う。

## Evidence

- 対象test: `tests/runs.spec.ts`。
- 対象revision: `74a2a9b47cc106795320323a597dfdf5931cbead`。
- 対象command: `npx playwright test --workers=1 tests/runs.spec.ts`、`npm run test:contracts`。
- 終了code: 対象commandはいずれも`0`。
- Acceptance: [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)。
