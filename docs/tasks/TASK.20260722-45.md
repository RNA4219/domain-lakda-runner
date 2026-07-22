---
task_id: TASK.20260722-45
intent_id: INT-LAKDA-MNT-001
status: in_progress
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-44]
---

# Task Seed: Release Profile / live workflow汎用化

## Objective

`lakda/release-profile/v1`とcurrent profileを導入し、live release workflowの過去RC固定値を除去する。

## Scope

In: profile schema/current profile、現行release設計入力、release-evidence workflow、RUNBOOK/GUARDRAILS、P6 Legacy表示。
Out: 歴史的docs/release-gate、Acceptance/QEG artifactの変更、QEG verdict生成。

## Requirements

REQ-MNT-GOV-004、REQ-MNT-GOV-005、REQ-MNT-GOV-006、REQ-MNT-GOV-007。AC-MNT-002。

## Plan

1. profile schemaとcurrent profileを作成する。
2. 現行feature/risk/manual/RanD入力を過去RCと別pathへ作成する。
3. workflowのartifact名、scope、acceptance ID、設計入力、required checkをprofileから解決する。
4. RUNBOOK/GUARDRAILSをCurrent/Historical/Legacyへ分離する。

## Patch

profile/package不一致と未知checkはtarget接続前に拒否する。P6 workflowは表示だけをLegacy化し、保存契約を変えない。

## Tests

schema、package version、参照path、required check allowlist、external input名、workflow固定文字列0件を検証する。

## Commands

- `npm run release:validate-profile`
- `npm run check:docs`
- `git diff --check`

## Notes

profileがlocal validationを通ってもreal staging/manual-bb/QEG未完了なら`pending_external`である。
