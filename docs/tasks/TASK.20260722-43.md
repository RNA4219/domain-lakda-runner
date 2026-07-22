---
task_id: TASK.20260722-43
intent_id: INT-LAKDA-MNT-001
status: done
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: []
---

# Task Seed: 保守要件・仕様・チェックリスト正本化

## Objective

REQUIREMENTS-MAINTAINABILITYと5仕様・5正本チェックリストを1対1で作成し、P8〜P11の短縮チェックリストを非規範aliasへ統一する。

## Scope

In: 保守要件、maintainability仕様群、拡張checklist正本/alias、SPEC-02 llm-select、拡張SPEC-03 target manifest。
Out: 実装code、歴史的Acceptance/release Gate/QEG artifactの変更。

## Requirements

REQ-MNT-GOV-001、REQ-MNT-GOV-003。AC-MNT-001。

## Plan

1. 要件IDと受入IDを確定する。
2. 5仕様と各1 checklistを作成する。
3. extension短縮版をaliasへ変更する。
4. 既存SPECへ新しいfail-closed境界を追記する。

## Patch

- [REQUIREMENTS-MAINTAINABILITY](../../REQUIREMENTS-MAINTAINABILITY.md)
- [maintainability仕様索引](../spec/maintainability/README.md)
- 既存adaptive/extension仕様とalias metadata

## Tests

要件IDが各仕様/正本checklistに1回だけ現れ、alias checkboxが0件であること。

## Commands

- `npm run check:docs`
- `git diff --check`

## Notes

仕様完成チェックと実装受入チェックを混同せず、未取得証跡を`[x]`へしない。

## Evidence

- 対象test: 要件IDと仕様/checklistの1対1、alias checkbox 0件、文書contract。
- 対象revision: `74a2a9b47cc106795320323a597dfdf5931cbead`。
- 対象command: `npm run check:docs`、`git diff --check`。
- 終了code: 対象commandはいずれも`0`。
- Acceptance: [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)。
