---
task_id: TASK.20260722-58
intent_id: INT-LAKDA-MNT-001
status: done
owner: RNA4219
created_at: 2026-07-22
updated_at: 2026-07-22
priority: P0
depends_on: [TASK.20260722-46, TASK.20260722-47, TASK.20260722-48, TASK.20260722-49, TASK.20260722-50, TASK.20260722-51, TASK.20260722-52, TASK.20260722-53, TASK.20260722-54, TASK.20260722-55, TASK.20260722-56, TASK.20260722-57]
---

# Task Seed: 統合Gate・manual-bb・Birdseye・Acceptance

## Objective

Phase 0〜5の差分を同一revisionへ束縛し、local統合Gate、manual-bb設計/外部記録、Birdseye、Acceptance状態を確定する。

## Scope

In: full local Gate、release profile、manual-bb入力検証、Birdseye、Acceptance status整理。Out: 外部証跡なしのGo判定、QEG verdict生成、歴史的artifact書換え。

## Requirements

REQ-MNT-GOV-001〜007、REQ-MNT-ACC-001〜006、REQ-MNT-EXT-001〜008、REQ-MNT-RUN-001〜007、REQ-MNT-MOD-001〜006。AC-MNT-001〜010。

## Plan

1. 全schema、docs、typecheck、lint、build、unit/fixture/contract/example/package Gateを同一revisionで実行する。
2. manual-bbの正常・境界・異常・禁止系を現行profileへ束縛する。
3. Birdseyeをcanonical toolで再生成しTask SeedとAcceptance状態を同期する。
4. P7/P11/実機/security/実Qwen/manual-bb外部/QEGをpending_externalとして分離する。

## Patch

local Gate結果と外部未取得理由を混在させず、QEGだけを最終Go/No-Go authorityとして維持する。

## Tests

Phase 0〜5の対象testに加え、manual-bb入力strict validation、Birdseye generation、release evidence workflow/profile整合を確認する。

## Commands

- `npm run check:docs`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run release:validate-profile`
- `npm run acceptance:fixture`
- `npm run acceptance:adaptive`
- `npm run check:hate`
- `npm run test:contracts`
- `npm run test:examples`
- `npm run pack:check`
- `npm run acceptance:adaptive:real`（target未設定時はexit 2）
- `npm run acceptance:extension:real`（target未設定時はexit 2）
- [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)に記録したmanual-bb strict Gate command
- `uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps`
- `git diff --check`

## Notes

P7/P11、Airtest/Poco実機、認可済みSecurity target、実Qwen、manual-bb外部実行、QEGは証跡取得まで`pending_external`である。

## Evidence

- 対象test: Phase 0〜5の全対象test、manual-bb strict input、release profile/Birdseye contract。
- 対象revision: `74a2a9b47cc106795320323a597dfdf5931cbead`。
- 対象command: `npm run check:docs`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm test`、`npm run release:validate-profile`、`npm run acceptance:fixture`、`npm run acceptance:adaptive`、`npm run check:hate`、`npm run test:contracts`、`npm run test:examples`、`npm run pack:check`、`npm run acceptance:adaptive:real`、`npm run acceptance:extension:real`、[AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)に記録したmanual-bb strict Gate command、`uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps`、`git diff --check`。
- 終了code: 取得済みlocal Gateは`0`。P7/P11 real acceptance preflightはtarget未設定をtarget接続前に拒否して`2`（`pending_external`）。最終subject SHAの`npm run lint`再実行は権限review timeoutのため未取得であり、直前revisionの`0`を最終証跡へ昇格しない。
- Acceptance: [AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)。
