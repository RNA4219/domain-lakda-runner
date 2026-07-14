---
task_id: TASK.20260714-22
intent_id: INT-LAKDA-001
status: fixture_accepted
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: Generator/Stop Condition分離

## Metadata

| 項目 | 値 |
|---|---|
| phase | P3 |
| repository | domain-lakda-runner |
| priority / effort | P1 / 0.5 engineer-day以内 |
| primary spec | [仕様書](../spec/adaptive-exploration/SPEC-02-STATE-GRAPH-EXPLORATION.md) |
| linked checklist | [対応チェックリスト](../spec/adaptive-exploration/CHECKLIST-02-STATE-GRAPH-EXPLORATION.md) |
| plan | [適応型探索実装計画](../IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) |

## Objective

REQ-STOP-001〜006を、共通契約・Safety Policy・Artifact Policyを経由して最小実装とtests-firstで満たす。

## Scope

- In: 要件、対応チェックリスト、関連する自動試験、Acceptance Record。
- Out: action-plan/v1、既存mode、RunResultの破壊的変更。
- 実機/認可環境を要するACはfixtureで完了扱いにしない。

## Plan

1. 仕様書とlinked checklistを確認する。
2. 失敗するunitまたはintegration testを先に追加する。
3. 最小実装とartifact証跡を追加する。
4. docs、typecheck、lint、対象Playwright testを実行する。
5. Acceptance Recordへ実行環境と未完ACを記録する。

## Acceptance

- REQ-STOP-001〜006に対応する自動試験が通過する。
- 追加artifactはredaction、実bytes scan、SHA-256、HATE/v1 manifestを経由する。
- pending_externalではreal実行をfixture/mockで代替した完了宣言をしない。

## Evidence

- 現在の状態: fixture_accepted
- fixture受入: [AC-20260715-04](../acceptance/AC-20260715-04.adaptive-evidence-replay-fixture.md)
- 実機、認可済みSecurity target、QEGは承認済み環境で別途取得する。
