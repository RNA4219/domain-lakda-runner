---
task_id: TASK.20260722-49
intent_id: INT-LAKDA-MNT-001
status: reviewing
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-48]
---

# Task Seed: Adapter・Oracle built-in registry

## Objective

Adapter、Generator、Oracleをbuilt-in allowlist registryから解決し、未知ID、capability不一致、任意code pluginを接続前に拒否する。

## Scope

In: adapter/oracle registry、capability照合、generic/product/security oracle責務分離。Out: 外部code plugin loader、LLMによる判定。

## Requirements

REQ-MNT-EXT-001、REQ-MNT-EXT-002、REQ-MNT-EXT-003、REQ-MNT-EXT-008。AC-MNT-005。

## Plan

1. built-in IDとcapabilityを型付きregistryへ登録する。
2. unknown ID/capability mismatchをfail-closedにする。
3. generic/product/security oracleとQEG境界をcharacterisation testで固定する。

## Patch

既存公開configと5 modeを維持し、解決経路だけをregistryへ統一する。

## Tests

`tests/adaptive/registries.spec.ts`と`bridges-oracles.spec.ts`でallowlistと責務境界を検証する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/registries.spec.ts tests/adaptive/bridges-oracles.spec.ts`
- `npm run test:contracts`

## Notes

registryは組み込み実装だけを扱い、filesystem/package名から任意moduleを読み込まない。

## Evidence

- 対象test: `tests/adaptive/registries.spec.ts`、`tests/adaptive/bridges-oracles.spec.ts`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/registries.spec.ts tests/adaptive/bridges-oracles.spec.ts`、`npm run test:contracts`。
- 状態: 統合Gate記録待ち。
