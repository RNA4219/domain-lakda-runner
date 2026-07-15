---
document_id: LAKDA-EVAL-LX-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-15
requirements: ../Lakda拡張要件定義書.md
specifications: README.md
---

# Lakda 拡張評価仕様

## Objective

P8〜P10のfixture/contract受入と、P11のreal external handoffを同じEvidence条件で評価する。local passをproduction GoやP7完了へ昇格させない。

## Scope

対象はAC-LX-001〜014、追加schema、combo/scout/investigate/promote CLI、artifact/HATE投影、既存CLI互換である。P11のreal server/device、authorized security target、manual-bb、QEGは外部承認環境で実施する。

## Evidence qualification

| executionMode | 資格 | 扱い |
|---|---|---|
| real | 実サーバまたは実機、target revision/config digest付き | product behaviorの本証跡 |
| simulated | 外部processまたはloopback fake | 補助証跡 |
| mock | in-process fixture、状態注入 | contract/unit補助のみ |

全caseはschema version、seed、generator version、revision、target、executionMode、OracleResult refs、artifact SHA-256を持つ。必須artifact欠落、redaction/scan失敗、security failureはpassに数えない。

## Acceptance Criteria

| ID | 対応仕様 | 合格条件 |
|---|---|---|
| AC-LX-001 | SPEC-01 | 同一model/version/seedの30回生成でbyte-identical、valid pair coverage 100%、constraint違反0件。 |
| AC-LX-002 | SPEC-01 | 充足不能constraint、未知factor/value、重複case、coverage欠落を独立verifierが検出し非0 exit。 |
| AC-LX-003 | SPEC-01 | select fixtureで有効optionを安定順抽出し、disabled/非表示/secret/PII残存0件。 |
| AC-LX-004 | SPEC-01 | 指定factor groupだけ3-way昇格、指定外group変化0件、理由と差分case保存。 |
| AC-LX-005 | SPEC-01 | caseから同一action sequenceを生成し、未許可mutation、scope外、budget超過実行0件。 |
| AC-LX-006 | SPEC-02 | 固定traceから期待Signalを100%生成し、根拠なし・重複・LLM由来新規Signal 0件。 |
| AC-LX-007 | SPEC-02 | valid responseだけ受理し、extra/duplicate/unknown ref、selector、URL、command、raw input、confirmed verdictを100%拒否。 |
| AC-LX-008 | SPEC-02 | timeout/schema/attestation不一致で暗黙provider切替0件、Signalと判断JSONL欠落0件。 |
| AC-LX-009 | SPEC-03 | 改ざんref/digestを100%拒否し、正常Leadはstrict replay後だけ人手調査へ遷移。意図的divergence検出100%。 |
| AC-LX-010 | SPEC-03 | reproduced以外のpromote成功0件、promoted artifactから元Lead/run/artifactへ追跡可能。 |
| AC-LX-011 | SPEC-03 | case/sequence/input shrinkで親artifact不変、failure signatureとSafety Policy維持、未許可mutation 0件。 |
| AC-LX-012 | SPEC-03 | 全追加artifactがredaction、scan、digest、HATE/v1を通り、secret/PII残存0件、QEG verdict生成0件。 |
| AC-LX-013 | SPEC-01 | 既存CLI/config/trace contract testが無変更で通り、unknown version/refが非0、新command help固定。 |
| AC-LX-014 | SPEC-03 | real評価でtarget revision、config digest、executionMode、oracle refs、HATE refsを記録し、fixture/mockのみの完了宣言0件。 |

## Test matrix

| 層 | 対象 | 実行条件 | 判定 |
|---|---|---|---|
| unit | canonicalization、stable ID、Signal rule、schema validator、promotion policy | mock許可 | contract failure 0件 |
| contract | JSON Schema、unknown ref/version、Safety、HATE manifest | simulated fixture | fail-closed全件 |
| integration | Playwright select、suite→case、trace→Signal/Lead、strict replay、artifact tree | loopback/Chromium | 14 ACのfixture条件 |
| real handoff | target revision固定、real server/device、authorized security | 承認済み外部環境のみ | real証跡とdownstream review |
| downstream | manual-bb、QEG | HATE artifact bundle外部評価 | Lakdaはverdictを生成しない |

## Artifacts

推奨artifact treeは次のとおりとする。

- adaptive/combinations/factor-model.json
- adaptive/combinations/suite.json
- adaptive/combinations/coverage.json
- adaptive/signals/*.json
- adaptive/leads/*.json
- adaptive/investigations/*.json
- adaptive/promotions/*.json
- reports/lead-report.json
- reports/lead-report.html
- artifacts/llm-scout.jsonl

## Workflow

1. preflight: schema、seed、config digest、target scope、executionModeを検証する。
2. execute: case/scout/investigateを実行し、各step後にObservationとartifactを確定する。
3. verify: ACごとのexpected/actual、failure signature、artifact refs、SHA-256を照合する。
4. classify: exploratory finding、defect evidence、security candidate、confirmed vulnerabilityを分離する。
5. handoff: HATE/v1 manifestをmanual-bb/QEGへ渡し、Lakdaのrun outcomeと混同しない。

## Commands

- npm run check:docs
- npm run typecheck
- npm run lint
- npm run build
- npm test
- npm run acceptance:fixture
- npm run check:hate

real handoffの実行手順はP7 runbookと承認済みtarget/device手順へ委譲する。mock結果でAC-LX-014を完了扱いにしない。
