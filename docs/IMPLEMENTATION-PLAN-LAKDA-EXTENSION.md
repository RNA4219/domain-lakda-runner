---
intent_id: INT-LAKDA-EXT-001
owner: RNA4219
status: draft
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
source_requirements: spec/Lakda拡張要件定義書.md
source_specs: spec/lakda-extension/README.md
source_evaluation: spec/lakda-extension/EVALUATION-LAKDA-EXTENSION.md
---

# Lakda 拡張 実装計画

本計画はWorkflow-cookbookのPlan、Patch、Tests、Commands、Notes契約で、追加要件をP8〜P11へ投影する。既存P0〜P7、P7 pending_external、既存modeは変更しない。

## Objective

pairwiseで広く探索し、観測済みSignalをLeadへ束ね、人手investigateで再現性を確認したものだけをmixed-strength suiteまたは回帰traceへpromoteする。

## Scope

In: factor/schema、select option extraction、combo gen/verify、Signal/Lead、loopback LLM boundary、investigate、promote、shrinking、artifact/HATE、evaluation。
Out: 既存mode破壊、LLM executor、未許可active security、QEG verdict、外部SaaS LLMの必須化。

## Plan

### Context intake

- 要件正本: spec/Lakda拡張要件定義書.md
- 仕様索引: spec/lakda-extension/README.md
- 評価正本: spec/lakda-extension/EVALUATION-LAKDA-EXTENSION.md
- 共通契約: ../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
- Workflow正本: Agent_tools/workflow-cookbook/HUB.codex.md、BLUEPRINT、RUNBOOK、GUARDRAILS、EVALUATION

### Dependency order

| Phase | Task Seed候補 | 成果物 | 受入 |
|---|---|---|---|
| P8 | TASK.20260715-36〜37 | factor/schema、option extraction、combo gen/verify | AC-LX-001〜005 |
| P9 | TASK.20260715-38〜39 | Signal/Lead、rule-only、LLM scout、lead report | AC-LX-006〜008 |
| P10 | TASK.20260715-40〜41 | investigate、promote、shrinking、HATE projection | AC-LX-009〜013 |
| P11 | TASK.20260715-42 | real external evaluation、manual-bb/QEG handoff | AC-LX-014 |

Task Seedは実装開始時に1件0.5 engineer-dayを目安に個別化し、Requirements、Affected Paths、Tests、Commands、Evidenceを持たせる。

### Artifact I/O

- Input: factor model、suite、config、seed、Lead ref、approved target scope
- Process: observe、generate、verify、execute、replay、classify
- Output: combination、Signal、Lead、investigation、promotion、report、HATE/v1 refs
- Stop: unknown schema/ref、scope逸脱、budget超過、artifact/security failure、kill switch

## Patch

- 新規実装は既存adaptive/artifact boundaryへ追加し、既存run/replay/action-plan bytesを変更しない。
- Schemaはversioned、unknown versionは非0 exit、raw secret/PIIは保存しない。
- Taskごとにtests-first、Acceptance Record、対応ChecklistのB/C evidenceを同一変更へ含める。
- real/mock qualificationとHATE/QEG責務境界を全Taskへ継承する。
- generator、LLM、recovery、shrinkerはSafety Policyを越えない。

## Tests

### Unit

canonicalization、stable IDs、constraints、Signal rule、schema validation、promotion status、redaction、KPI denominator。

### Contract

unknown version/ref、extra key、duplicate key、forbidden LLM field、Safety deny、HATE manifest、existing CLI/config compatibility。

### Integration

Chromium select fixture、suite→case mapping、trace→Signal/Lead、strict replay divergence、immutable parent、shrink phases、artifact tree。

### External

P11だけreal server/device、authorized security target、manual-bb、QEGを使用する。fixture/mockはP11の完了条件を満たさない。

## Commands

- npm run check:docs
- npm run typecheck
- npm run lint
- npm run build
- npm test
- npm run acceptance:fixture
- npm run check:hate
- npm run pack:check

## Notes

### Risks and stop conditions

| risk | stop |
|---|---|
| combinatorial state explosion | case/graph/artifact budget超過 |
| nondeterministic suite/selection | same model/seedでbyte差分 |
| LLM boundary breach | unknown ref、selector、URL、raw input、confirmed verdictの1件以上 |
| stale or unsafe replay | pre/post/topology/oracle divergence、scope外、deny違反 |
| evidence qualification error | mockでreal ACを完了扱い、QEG生成 |
| Birdseye/tooling stale | 新規spec node未登録、生成世代不整合 |

### Open decisions

DEC-LX-001〜006はP8〜P11のTask Seed開始前にownerとdecision recordを付ける。未決定でも本書のSafety Policy、fail-closed、QEG境界は変更しない。

### Follow-ups

- Task Seed 36〜42を作成し、各spec/checklist/evaluationへリンクする。
- Birdseyeをcanonical workflow-cookbook toolでindex+caps更新する。
- 各Task完了時にAC-YYYYMMDD-xx形式のAcceptance RecordとChecklist B/Cを更新する。
- final Go/No-GoはLakdaではなくHATE/QEGが決定する。
