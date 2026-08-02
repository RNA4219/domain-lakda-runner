---
task_id: TASK.20260802-60
intent_id: INT-LAKDA-AUTONOMOUS-EXPLORATION-001
status: in_progress
owner: RNA4219
created_at: 2026-08-02
updated_at: 2026-08-03
priority: P0
depends_on: [TASK.20260802-59]
---

# Task Seed: 自動・クロスプラットフォーム探索仕様正本化

## メタデータ

```yaml
task_id: TASK.20260802-60
repo: domain-lakda-runner
base_branch: main
work_branch: feat/autonomous-cross-platform-exploration
priority: P0
langs: [typescript, python, markdown]
```

## Objective

自動探索中心の探索的テストを、PC Web、mobile Web、Windows、Android、iOS、Airtest画像観測、finding／captureまで含む単一MVPとして仕様化する。

## Scope

- In: Exploration Charter／Session／Finding／Report、autonomous selection、Playwright PC／mobile、Airtest/Poco visual-device、platform lane、capture retention、受入条件、チェックリスト、文書routing。
- Out: Airtest/Python processのLakdaからの自動起動、実機接続そのもの、macOS／Linux native desktop、未許可mutation、QEG verdict生成。runtime実装は本仕様を受けた後続実装として同じworking treeへ反映し、real acceptanceは別の外部工程とする。

## Requirements

- Behavior:
  - 人間の逐次操作を要求しない自動探索を既定とする。
  - Windows、Android、iOSを別capability／real acceptance laneとして扱う。
  - Airtest画像、Poco hierarchy、device状態を別provenanceで保持する。
  - safe visual candidateがなければrandom／LLM座標tapせずcoverage debtを残す。
  - finding／non-passだけ録画を保持し、regression／fullは録画しない。
- I/O Contract:
  - Input: `lakda/exploration-charter/v1`。
  - Output: session、events、visual observations、findings、report、既存adaptive／HATE artifact。
- Constraints:
  - 既存mode、`lakda/action-plan/v1`、HATE/QEG境界を変更しない。
  - Airtest/Pocoはoperator管理のloopback endpointだけを使う。
  - Lint／Type／Test／docsはゼロエラー。
- Acceptance Criteria:
  - `REQ-AX-001`〜`REQ-AX-021`が仕様とチェックリストへ1対1で追跡できる。
  - `AC-AX-001`〜`AC-AX-010`に正常、境界、異常、禁止、real evidence条件がある。
  - `REQ-GAME-001`〜`004`と`AC-AE-015`がcross-platform MVP方針へ同期される。

## Affected Paths

- `REQUIREMENTS-ADAPTIVE-EXPLORATION.md`
- `docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md`
- `docs/spec/adaptive-exploration/{README,SPEC-05-AIRTEST-POCO-ADAPTER,CHECKLIST-05-AIRTEST-POCO-ADAPTER,EVALUATION-ADAPTIVE-EXPLORATION}.md`
- `docs/spec/autonomous-exploratory-testing/**`
- `docs/spec/README.md`
- `docs/tasks/{README,TASK.20260802-60}.md`
- `HUB.codex.md`

## Local Commands

```powershell
npm run check:docs
git diff --check
```

実装後の検証では`npm run check`、`npm run acceptance:adaptive`、`npm run acceptance:fixture`、`npm run check:hate`、`npm run pack:check`、`npx playwright test tests/exploration.spec.ts --workers=1`を実行する。

## Deliverables

- Workflow-cookbook形式の統合仕様書。
- 仕様完成、実装、受入を分離した正本チェックリスト。
- Airtest/Poco visual-device正本、追加要件、評価仕様、実装計画、文書索引の同期差分。
- 実機証跡が未取得であることを明示した`pending_external`境界。

## Plan

1. 既存adaptive、Airtest/Poco、Artifact Policy、Workflow-cookbookの正本を確認する。
2. 自動探索MVPのplatform、session、candidate、finding、capture、safety、evidence契約を固定する。
3. integration specと対応checklistを作成する。
4. Airtest一次所有仕様、要件、評価、実装計画、索引を同期する。
5. docs contractと差分を検査する。
6. runtime実装はschema／session、visual／bridge、CLI／captureの独立境界へ分け、real acceptanceを外部証跡として残す。

## Patch

- 新規integration specは既存6一次所有仕様を置き換えずcross-cutting profileとして追加する。
- Airtest/Pocoの`REQ-GAME-*`はShouldからMustへ引き上げ、Windows／Android／iOSを同一MVPの別laneにする。
- 既存modeを変更せず、`lakda explore`とversioned exploration schemaをadditiveに実装する。
- 実機、manual-bb、QEGの未取得状態をlocal docs検証の成功で昇格しない。

## Tests

- 文書front matter、相対link、仕様／checklist backlink。
- `REQ-AX-001`〜`021`とチェックリスト行の一意対応。
- `AC-AX-001`〜`010`の仕様／チェックリスト対応。
- adaptive既存128要件、16受入、6一次所有仕様の文書契約回帰。
- Markdown whitespace、壊れたanchor、禁止されたQEG CLI／opaque citationの不在。

## Commands

- `npm run check:docs`
- `git diff --check`
- `git status --short`
- `rg -n "REQ-AX-|AC-AX-|REQ-GAME-|AC-AE-015" docs REQUIREMENTS-ADAPTIVE-EXPLORATION.md`

## Notes

### Rationale

探索engineとadapterの一次所有を既存仕様へ残し、Exploration Sessionとplatform統合だけを新仕様へ分離する。これによりWeb-only MVPへの縮小を防ぎつつ、既存adaptive契約を二重定義しない。

### Risks

- iOS実機、device signing、app fixture、Windows application、Android実機の準備がなければreal Gateは完了しない。
- 画像redactionとVisualCandidateProviderの供給元／version／confidence policyはruntime実装前にschemaへ固定する必要がある。
- platform別recording capability差をvideoの暗黙fallbackで隠してはならない。

### Follow-ups

- Charter／Session／Finding／Report schemaを独立Taskへ分解する。
- autonomous selection、Playwright lane、visual-device bridge、visual candidate、capture、real acceptanceを別Taskへ分解する。
- 実装完了後にAcceptance Recordを作成し、subject revisionとartifact digestを固定する。

## Evidence

- 対象working tree: base revision `1f8bc0d7d0895d002f35c82f9e4c31d6b1fe9bc1`＋未commit差分。Task 59の先行差分と同居し、仕様契約と後続runtime実装を同一working treeで検証する。
- `npm run check:docs`、`npm run lint`、`git diff --check`: pass（`REQ-AX` 21件、`AC-AX` 10件、Workflow-cookbook 5節、whitespace errorなし）。
- `npm run check`: pass（docs contract、typecheck、lint、build、Playwright 251/251）。
- `npm run acceptance:adaptive`: pass（144/144）。
- `npm run acceptance:exploration:fixture`: pass（21/21）。
- `npm run acceptance:fixture`: pass（overall=true、critical 30/30、manifest 215/215、strict JSON 1.0、unsafe 0、secret 0）。full corpusが通常録画を継承していた時点では1/60がaccepted後の`UI-006`となる失敗を再現したため、case ID診断を追加し、full fixture契約を`video=false`へ固定して解消した。failure screenshot／traceは維持する。
- `npm run check:hate`: pinned HATE check pass（upstreamChecked=false）。`npm run pack:check`: pass（package 295 files、isolated install／CLI help／import／Airtest bridge pass、Node/npm engine warningのみ）。初回はsandbox外npm cacheへの書込みがEPERMとなり、同一commandの許可済みsandbox外再実行で確認した。
- Python reference bridgeの`py_compile`はこのWindows環境で実行可能なPython runtimeが見つからず、未実施として扱う（実機Gateの代替にはしない）。
- Windows、Android実機、iOS実機の統合MVP Gateは、承認済みtarget manifest／実機証跡が未提供のため`pending_external`。fixture成功で代替しない。
