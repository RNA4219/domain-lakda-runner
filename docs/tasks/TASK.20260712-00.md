---
task_id: 20260712-00
intent_id: INT-LAKDA-001
owner: RNA4219
status: in_progress
last_reviewed_at: 2026-07-13
next_review_due: 2026-08-12
---

# Task Seed: M0 正本・基盤確定

## Objective

正本、Workflow-cookbook 文書、TypeScript/Playwright の最小基盤、固定 HATE/v1 schema、CI を直接 `main` に確定する。

## Scope

- 正本と補助文書、Task Seed、受入記録の整合。
- Node 24.6.0、TypeScript、Playwright Chromium、文書検査、lint/typecheck/build/test、GitHub Actions。
- HATE/v1 schema の固定 SHA を伴う vendoring。

## Constraints

- QEG record/Gate、HATE audit record、LakdaのQEG直接export、`doctor --fix` は実装しない。
- DOCX と調査報告書は原資料として内容を変更しない。
- `main` に小さな検証済みコミットを直接積む。

## Acceptance

- [x] 正本、Workflow 文書、Task Seed、受入記録がリンク・JSON・REQ/AC 対応検査を通過する。
- [x] `npm run check`、`npm run pack:check`、`npm run acceptance:fixture` がローカルで通過する。
- [x] Birdseye/Codemapをdry-run後に生成し、Capsuleを更新する。
- [ ] 実Qwen4B受入、push後のGitHub Actions成功、completion recordの確定。

## Evidence

- `npm run check`
- `npm run pack:check`
- `.github/workflows/ci.yml`
- `vendor/hate/v1/UPSTREAM.json`
