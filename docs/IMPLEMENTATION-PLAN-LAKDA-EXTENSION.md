---
intent_id: INT-LAKDA-EXT-001
owner: RNA4219
status: implementation-baseline
last_reviewed_at: 2026-07-15
next_review_due: 2026-08-14
source_requirements: spec/Lakda拡張要件定義書.md
source_specs: spec/lakda-extension/README.md
source_evaluation: spec/lakda-extension/EVALUATION-LAKDA-EXTENSION.md
---
# Lakda拡張 実装計画（Workflow-cookbook形式）

## Summary

P8〜P11を段階導入する。既存P0〜P7、CLI、config、trace、`pending_external`状態は維持し、新機能は追加経路として実装する。

- P8: factor model、select option抽出、pairwise/mixed-strength生成、独立verify
- P9: Signal/Lead、rule-only、loopback LLM scout、report、strict replay investigate
- P10: promote、shrinking、artifact/HATE接続、KPI
- P11: 認可済み実環境受入とmanual-bb/QEG handoffのみ。環境未設定時は`pending_external`

対象計画書は `C:\Users\ryo-n\Codex_dev\domain-lakda-runner\docs\IMPLEMENTATION-PLAN-LAKDA-EXTENSION.md` とする。

## Objective

観測済みの状態・操作・入力を決定的な組み合わせcaseへ変換し、実行結果からSignalとLeadを生成する。strict replayで`reproduced`となったものだけを回帰traceまたは強化suiteへ派生させる。

## Scope

In:

- versioned JSON Schemaとfail-closed validator
- Playwrightのselect option抽出
- deterministic pairwise/mixed-strength generator・独立verifier
- Signal/Lead生成、rule-only fallback、loopback LLM
- investigate、promote、case/sequence/input shrinking
- redaction、scan、SHA-256、HATE/v1 manifest
- CLI、Task Seed、Acceptance Record、checklist更新

Out:

- 既存mode・`action-plan/v1`・`RunResult`の意味変更
- LLMによるselector、URL、command、任意入力値、factor変更
- 未許可active security、外部SaaS LLM、DB永続化
- LakdaによるQEG verdict、approval、waiverの生成

## 固定する設計判断

| 決定 | 採用方針 |
|---|---|
| DEC-LX-001 | `lakda-ipog/v1`は全列挙＋貪欲被覆の凍結legacyとして既存artifact再検証だけに残す。新規modelは内製の逐次`lakda-ipog/v2`を明示し、水平/垂直成長、partial constraint、seed付きtie-breakで生成する。外部library・外部toolへ依存しない。 |
| DEC-LX-002 | `lakda/combination-constraints/v1` の専用DSL。`allOf`、`anyOf`、`not`、`eq`、`neq`、`in`、`notIn`、`implies`だけを許可する。 |
| DEC-LX-003 | rule-only Leadは`sourceRunId + failureSignature + oracleClass + severity + sourceFingerprint + graphRevision`でrun内dedupeする。Lead cap既定値は3。 |
| DEC-LX-004 | 初版は既存`LocalLlmClient`のloopback transport、model attestation、timeout、token budgetだけを利用する。暗黙provider切替は禁止する。 |
| DEC-LX-005 | P8〜P10ではKPIを分子・分母・revision付きで記録するだけとし、production閾値はP11のreal corpus取得後に決定する。 |
| DEC-LX-006 | 初版の正本は既存filesystem Artifact Store。DBや外部永続storeは追加しない。 |

## Public I/O・データ契約

追加Schemaを`C:\Users\ryo-n\Codex_dev\domain-lakda-runner\schemas\`へ作成する。

- `lakda-combination-factor-model-v1.schema.json`
- `lakda-combination-case-v1.schema.json`
- `lakda-input-interaction-coverage-v1.schema.json`
- `lakda-exploration-signal-v1.schema.json`
- `lakda-exploration-lead-v1.schema.json`
- `lakda-llm-scout-context-v1.schema.json`
- `lakda-llm-scout-response-v1.schema.json`
- `lakda-investigation-v1.schema.json`
- `lakda-promotion-v1.schema.json`
- `lakda-lead-report-index-v1.schema.json`

全Schemaは`additionalProperties: false`、未知version/refは非0終了とする。

| モデル | 必須契約 |
|---|---|
| CombinationFactorModel | schemaVersion、modelId、factor ID/kind、許可値、source、risk、constraints、generatorPolicy |
| CombinationCase | suiteId、caseId、strength、assignments、coveringTuples、seed、generatorVersion |
| Signal | signalId、signalType、severity、source refs、failure signature、artifact refs |
| Lead | leadId、title、summary、risk、signalRefs、candidateRefs、factorRefs、status |
| InvestigationRecord | leadRef、strict replay結果、status、reviewer、revision、evidence refs |
| PromotionRecord | investigationRef、parent refs、derived refs、generator version、promotion policy |

Artifact保存先は次で固定する。

- `adaptive/combinations/factor-model.json`
- `adaptive/combinations/suite.json`
- `adaptive/combinations/coverage.json`
- `adaptive/signals/*.json`
- `adaptive/leads/*.json`
- `adaptive/investigations/*.json`
- `adaptive/promotions/*.json`
- `reports/lead-report.json`
- `reports/lead-report.html`
- `artifacts/llm-scout.jsonl`

## Plan

### 0. 着手前の仕様固定

1. DEC-LX-001〜006をDecision Record化する。
2. 追加Schema、CLI help、終了code、artifact pathをfreezeする。
3. 各Task SeedのChecklist Aを完了させる。
4. Task SeedはWorkflow-cookbookの原則に従い、原則0.5 engineer-day・2 source files・100行以内で分割する。

### P8: 組み合わせ生成

| Task Seed | 実装内容 | 主な対象 | 受入 |
|---|---|---|---|
| `TASK.20260715-36` | factor model、constraint DSL、Playwright select option抽出、redaction | `src/adaptive/combinations/`、`src/adapters/playwright.ts`、Schema | AC-LX-001〜003、Checklist-01 |
| `TASK.20260715-37` | pairwise/mixed-strength generator、独立verifier、case resolver、combo CLI | `src/adaptive/combinations/`、`src/cli.ts`、CLI contract tests | AC-LX-001〜005、013、Checklist-01 |

固定CLI:

```text
lakda combo gen --factor-model <path> --out <suite> --strength <2|3> --seed <int> [--factor-group <id>] [--case-budget <n>]
lakda combo verify --factor-model <path> --suite <path> --out <coverage>
```

生成前にcase数を推定し、budget超過・充足不能constraintの場合はsuiteを保存せず終了する。

### P9: Signal・Lead・scout・investigate

| Task Seed | 実装内容 | 主な対象 | 受入 |
|---|---|---|---|
| `TASK.20260715-38` | rule registry、Signal stable ID、dedupe、Lead grouping、rule-only | `src/adaptive/scouting/`、Signal/Lead Schema | AC-LX-006、Checklist-02 |
| `TASK.20260715-39` | loopback LLM scout、strict JSON、ref allowlist、JSONL evidence、lead report、strict replay investigate | `src/adaptive/scouting/`、`src/adaptive/investigation/`、`src/core/llm.ts`、`src/cli.ts` | AC-LX-007〜009、013、Checklist-02/03 |

固定CLI:

```text
lakda scout --config <path> --suite <path> --mode <rule-only|loopback> --out-dir <dir>
lakda investigate --lead <path> --reviewer <id> --out <record>
lakda report leads --run-dir <dir> --out <path> --format <json|html>
```

LLM失敗時はprovider切替を行わず、Signalを保持したまま`partial`または明示された`rule-only`へ遷移する。

### P10: promote・shrinking・証跡

| Task Seed | 実装内容 | 主な対象 | 受入 |
|---|---|---|---|
| `TASK.20260715-40` | `reproduced`限定promote、Lead起点mixed-strength、immutable parent linkage | `src/adaptive/investigation/`、`src/adaptive/combinations/` | AC-LX-004、010、Checklist-01/03 |
| `TASK.20260715-41` | case→sequence→input shrinking、signature維持、Artifact Store/HATE/KPI | `src/adaptive/investigation/`、`src/adaptive/evidence.ts`、`src/core/hate.ts` | AC-LX-011〜012、Checklist-03 |

固定CLI:

```text
lakda promote --investigation <path> --kind <trace|suite> --out <path>
```

promote条件は`status=reproduced`、必須artifact存在、digest一致、reviewer・revision存在の全条件とする。元run、Lead、artifactは変更しない。

shrinkingはcase、sequence、inputの順で試行し、各試行を派生artifactとして残す。Safety Policy、scope、mutation、budget、kill switchを全試行へ適用する。

### P11: 実環境受入

| Task Seed | 実装内容 | 受入 |
|---|---|---|
| `TASK.20260715-42` | 拡張用case単位real acceptance runner、immutable corpus、revision/config digest、HATE refs | AC-LX-014、Checklist-03 |

追加スクリプト:

- `scripts/run-lakda-extension-real-acceptance.mjs`
- `scripts/verify-lakda-extension-real-acceptance.mjs`

target revision、config digest、executionMode、OracleResult refs、HATE refsが揃わない場合はtargetへ接続せず`pending_external`で終了する。fixture/mockだけではAC-LX-014を完了扱いにしない。manual-bb/QEGは外部工程へhandoffし、Lakdaはverdictを生成しない。

## Patch

- 新規実装は`src/adaptive/combinations/`、`src/adaptive/scouting/`、`src/adaptive/investigation/`へ分離する。
- `src/core/runner.ts`は必要なdispatchだけを追加し、既存run/replay経路は変更しない。
- `src/core/llm.ts`は既存`decide`契約を維持し、scout専用のstrict structured completionだけを追加する。
- `LakdaConfig`と`lakda-config-v1.schema.json`へoptional `extensions` blockを追加する。既存modeでは無視し、既存configのvalidation結果を変えない。
- `extensions.combinations.caseBudget`既定値は1000、`defaultStrength`は2。
- `extensions.scouting.mode`既定値は`rule-only`、`leadCap`既定値は3。
- unknown schema/ref、Safety deny、artifact scan失敗は成功へ変換しない。
- 各TaskでAcceptance Recordを作成し、対応ChecklistのB/Cは実証跡取得後だけ更新する。
- 仕様・計画追加後は`codemap.config.json`とBirdseye index/capsuleをcanonical toolで同期する。

## Tests

### Unit

- canonicalization、stable ID、seeded generator
- constraint DSLの充足・不充足
- pair/tuple coverage、duplicate、unknown ref
- Signal生成・dedupe、Lead cap
- promotion status、parent immutability
- shrink signature、redaction、KPI分母

### Contract / fail-closed

- unknown schema version/ref
- extra key、duplicate JSON key、non-JSON
- LLMのselector、URL、path、code、command、raw input、confirmed verdict
- provider切替、attestation不一致、timeout、token budget超過
- Safety deny、scope外、budget超過
- HATE manifest不備、secret/PII残存、QEG artifact生成

### Integration

- Chromium selectの有効option抽出
- suite→CombinationCase→InputCase/ActionTemplate
- trace→Signal→Lead
- strict replay divergence
- reproducedのみpromote
- case/sequence/input shrink
- artifact tree→HATE/v1

### Regression

既存の以下を無変更で通す。

```powershell
npm run check:docs
npm run typecheck
npm run lint
npm run build
npm test
npm run acceptance:fixture
npm run pack:check
npm run check:hate
```

P11のみ、承認済み外部環境で次を実行する。

```powershell
npm run acceptance:extension:real
npm run acceptance:extension:verify-real
```

## Implementation status

| phase | status | evidence |
|---|---|---|
| P8 | completed_local | combination/select/combo tests、typecheck、build |
| P9 | completed_local | Signal/Lead/scout/investigate tests、lint |
| P10 | completed_local | promote/shrink/KPI/HATE path tests |
| P11 | pending_external | real runner/verifierは未設定環境でpending_external。approved target、manual-bb、QEG待ち |

Local completion does not change P7/P11 external eligibility or generate a QEG verdict.

## Notes

停止条件:

- 不明Schema/ref、artifact欠落、redaction/scan失敗
- suite byte差分、coverage不足、constraint違反
- LLM境界違反、暗黙provider切替
- strict replay divergence、parent改変
- 未許可mutation、scope逸脱、budget超過
- 実環境metadata不足

ロールバックはTask単位のrevertとし、既存artifactやschemaを削除しない。P7の`pending_external`およびP11の外部受入状態は、local fixture成功によって変更しない。
