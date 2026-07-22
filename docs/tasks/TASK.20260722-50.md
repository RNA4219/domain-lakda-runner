---
task_id: TASK.20260722-50
intent_id: INT-LAKDA-MNT-001
status: reviewing
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-49]
---

# Task Seed: Generator・strict llm-select・P9 scouting degrade

## Objective

Generator解決とstrict llm-selectを実装し、安全なcandidate IDまたはstop以外を拒否し、P9 scouting失敗時を明示的degradeとして証跡化する。

## Scope

In: generator registry、strict JSON、no fallback、seed determinism、P9 scouting degrade。Out: selector/URL/input/code/commandのLLM生成、暗黙random fallback。

## Requirements

REQ-MNT-EXT-004、REQ-MNT-EXT-005、REQ-MNT-EXT-006、REQ-MNT-EXT-007、REQ-MNT-EXT-008。AC-MNT-006。

## Plan

1. 提示済みcandidate IDとredacted graphだけをLLMへ渡す。
2. 追加key、提示外ID、timeout、不正応答をpartial/llm_errorへ固定する。
3. P9 scouting unavailableを暗黙成功にせずdegraded evidenceへ残す。
4. 同一seed/Observation/candidate列のbyte determinismを確認する。

## Patch

LLMは選択だけを行い、action生成、oracle判定、Gate判定を行わない。

## Tests

`tests/adaptive/llm-select.spec.ts`と`registries.spec.ts`でstrict schema、no fallback、determinism、degradeを検証する。

## Commands

- `npx playwright test --workers=1 tests/adaptive/llm-select.spec.ts tests/adaptive/registries.spec.ts`
- `npm run acceptance:adaptive`

## Notes

scoutingのdegradeは理由と観測済み証跡を保持し、別Generatorへ黙って切り替えない。

## Evidence

- 対象test: `tests/adaptive/llm-select.spec.ts`、`tests/adaptive/registries.spec.ts`。
- 対象command: `npx playwright test --workers=1 tests/adaptive/llm-select.spec.ts tests/adaptive/registries.spec.ts`、`npm run acceptance:adaptive`。
- 状態: 統合Gate記録待ち。
