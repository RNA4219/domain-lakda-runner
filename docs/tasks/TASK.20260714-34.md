---
task_id: TASK.20260714-34
intent_id: INT-LAKDA-001
status: pending_external
owner: RNA4219
created_at: 2026-07-15
updated_at: 2026-07-15
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
---

# Task Seed: 固定Web corpus・16 AC評価

## Metadata

| 項目 | 値 |
|---|---|
| phase | P7 |
| repository | domain-lakda-runner |
| priority / effort | P1 / 0.5 engineer-day以内 |
| primary spec | [仕様書](../spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md) |
| linked checklist | [対応チェックリスト](../spec/adaptive-exploration/CHECKLIST-01-COMMON-CORE.md) |
| plan | [適応型探索実装計画](../IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) |

## Objective

AC-AE-001〜014を、共通契約・Safety Policy・Artifact Policyを経由して最小実装とtests-firstで満たす。

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

- AC-AE-001〜014に対応する自動試験が通過する。
- 追加artifactはredaction、実bytes scan、SHA-256、HATE/v1 manifestを経由する。
- pending_externalではreal実行をfixture/mockで代替した完了宣言をしない。

## Evidence

- 現在の状態: pending_external
- fixture受入: [AC-20260715-04](../acceptance/AC-20260715-04.adaptive-evidence-replay-fixture.md)
- runner local verification: [AC-20260715-07](../acceptance/AC-20260715-07.p7-runner-pending-external.md)
- 実機、認可済みSecurity target、QEGは承認済み環境で別途取得する。

## P7 Real Case Runner

- Status remains `pending_external`.
- The case runner derives `acceptanceId`, expected outcome, target revision, and per-case config digest from an immutable, SHA-256-recorded corpus and fails closed before target access when required metadata, revision assertion, or config bytes differ.
- Each eligible report records config digest, seed, environment, target revision, run identity, OracleResult refs, and HATE artifact refs. The read-only suite verifier requires unique case IDs and all 16 acceptance IDs before manual-bb/QEG handoff.
- Operator procedure and evidence conditions: [P7 Real Adaptive Acceptance Runbook](../acceptance/P7-REAL-ACCEPTANCE-RUNBOOK.md).
- Real device, authorized Security target, manual review, and QEG evidence must be collected in approved external environments; fixture evidence cannot close P7.
