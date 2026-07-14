---
task_id: TASK.20260714-08
intent_id: INT-LAKDA-001
status: planned
owner: RNA4219
created_at: 2026-07-14
updated_at: 2026-07-15
last_reviewed_at: 2026-07-14
next_review_due: 2026-08-13
---

# Task Seed: 適応型探索の共通契約・schema固定

## Metadata

| 項目 | 値 |
|---|---|
| repository | `domain-lakda-runner` |
| base / work branch | `main` / `feat/adaptive-contracts-v1` |
| priority / effort | P1 / 0.5 engineer-day以内 |
| primary spec | [SPEC-01](../spec/adaptive-exploration/SPEC-01-COMMON-CORE.md) |
| linked checklist | [CHECKLIST-01](../spec/adaptive-exploration/CHECKLIST-01-COMMON-CORE.md) |
| plan | [適応型探索実装計画](../IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) |

## Objective

`adaptive-explore`の共通DTOと単一JSON Schemaをtests-firstで固定し、後続adapterとCoordinatorが共有するversioned boundaryを実装する。

## Scope

- In: `Observation`、`ActionCandidate`、`ExecutionResult`、`OracleResult`、`EvidenceArtifactRef`、`AdapterCapabilities`、`AdapterError`、schema validation、valid/invalid fixture。
- Out: RunMode/config/CLI/Adapter SPI/Safety/Playwright/replay、既存`lakda/action-plan/v1`・RunResult・4 modeの意味変更。
- CHECKLIST-01のB/C欄と`AC-AE-014`は本Taskで完了にしない。後続実証跡取得後だけ更新する。

## Requirements

- 7 DTOはcanonicalな`schemaVersion`を必須にし、未知versionを`unsupported`として拒否する。
- adapter固有object、secret、cookie、authorization、実PIIを公開schemaへ含めない。参照はIDまたは保存済みartifact参照に限定する。
- enumと必須fieldを固定し、暗黙version変換と破壊的な既存core type変更を行わない。
- 対象要件は`REQ-CORE-001`〜`REQ-CORE-007`。`AC-AE-014`はadapter境界受入の前提証跡にとどめる。
- source変更が2ファイルまたは100行を超える場合は着手前にTaskを再分割する。

## Affected paths

- `src/adaptive/contracts.ts`（新規）
- `schemas/adaptive-contracts-v1.schema.json`（新規）
- `tests/adaptive/contracts.spec.ts`（新規）
- `docs/acceptance/AC-YYYYMMDD-xx.md`（Task完了時に新規）

## Plan

1. SPEC-01 §4、CHECKLIST-01、評価仕様の`AC-AE-014`を確認し、DTO/field/enum対応表をtestに先行して置く。
2. valid payload、必須field欠落、unknown version、adapter object、secret/PII混入を検査する失敗testを作る。
3. DTOとschemaを実装し、unknown versionと禁止fieldをfail-closedにする。
4. local checksを実行し、Acceptance Recordへ結果、artifact hash、未完了AC/checklistを記録する。

## Patch

- public DTOのexportは`src/adaptive/contracts.ts`だけに集約する。
- schemaは`lakda/adaptive-contracts/v1`を唯一の正本とする。
- error原文を公開payloadへ複製せず、sanitized referenceと分類だけを保持する。

## Tests

- Unit: stable enum、必須field、version検査、error分類。
- Contract: valid/invalid fixtureとunknown version、公開禁止field。
- Regression: typecheck、lint、既存Playwright suite、`lakda/action-plan/v1`互換性。

## Commands

```powershell
npm run check:docs
npm run typecheck
npm run lint
npx playwright test tests/adaptive/contracts.spec.ts
npm test
```

## Notes

- 本Taskの完了は共通契約の局所受入であり、adapter実装または最終ACの完了を意味しない。
- `AC-AE-014`の最終証跡はTASK.20260714-12とTASK.20260714-34で収集する。
- 新fieldが必要になった場合は、SPEC-01、CHECKLIST-01、評価fixture、実装計画を同一変更で更新する。
