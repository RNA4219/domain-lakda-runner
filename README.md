# Lakda / domain-lakda-runner

[![CI](https://github.com/RNA4219/domain-lakda-runner/actions/workflows/ci.yml/badge.svg)](https://github.com/RNA4219/domain-lakda-runner/actions/workflows/ci.yml)
[![reference staging: QEG go](https://img.shields.io/badge/reference_staging-QEG_go-1f883d)](docs/release-gate/qeg-600a037/gate-verdict.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Lakdaは、Web・ゲーム・認可済みセキュリティ探索を共通の状態遷移モデルで扱うテストオーケストレーターです。Playwright、Airtest/Poco、ZAPなどの操作基盤を再実装せず、「目と手」として接続します。Lakda Coreは、安全に試す候補、踏破済み状態、再現手順、証跡を管理します。

> Lakdaのrun outcomeは最終品質Gateではありません。LakdaはHATE/v1証跡までを生成し、Go／No-Goは外部のmanual-bbとQEGが判断します。

> [!NOTE]
> 現在の候補版は `0.3.0-rc.5` です。code revision `600a037efec8617d2090b1c8be408a1d1b9b1c5a` の公開・非破壊[reference staging](https://rna4219.github.io/domain-lakda-runner/)に対するQEG `go`は、履歴として保持しますが、現在のrc.5 source revisionを承認するものではありません。rc.5はfreeze SHAごとにdeterministic、adaptive、package、reference staging、実Qwen、RanD、Code-to-gate、HATE、manual-bb、QEGを再実行するまで`pending_external`です。任意の本番・実機・security targetへの包括承認も示しません。詳細は[品質証跡記録](docs/acceptance/AC-20260716-19.reference-staging-qeg-go.md)を参照してください。

## 機能

| 領域 | Lakdaが担うこと | 操作基盤 | 境界 |
|---|---|---|---|
| Web / SaaS | DOM・URL・通信を観測し、安全な操作候補を探索・replay | Playwright | in-process adapter |
| ゲーム | 画面・UI階層・実機入力から状態を探索 | Airtest / Poco | operator管理のloopback bridgeのみ |
| セキュリティ | 認可差分・安全な変異・手順差分を探索補助 | Security bridge / ZAP等 | 承認、scope、rate、cleanup、kill switch必須 |
| 共通コア | fingerprint、遷移graph、停止条件、oracle、replay、証跡 | adapter共通 | HATE/v1まで。QEG verdictは生成しない |

```mermaid
flowchart LR
  O[観測] --> C[安全なcandidate生成]
  C --> X[安全制御・実行]
  X --> R[DOM再観測・oracle]
  R --> G[状態遷移graph・replay]
  G --> E[redacted evidence / HATE v1 manifest]
  E --> H[HATE: 自動テスト証跡の正規化]
  H --> M[manual-bb: 人間のブラックボックス確認]
  M --> Q[QEG: 最終Gate verdict / record]
```

## 品質検証の全体像

Lakda単体の成功をリリース成功とは呼びません。要件から最終判定まで、次の独立したツールを順に接続します。

| ツール | 人間向けの役割 | このrepoとの関係 |
|---|---|---|
| [RanD](https://github.com/RNA4219/RanD) | 要求仮説、調査、受入条件を整理する | 検証対象と期待結果の入口 |
| [Code-to-gate](https://github.com/RNA4219/code-to-gate) | 静的解析、finding、risk、readinessを作る | source revisionを独立評価 |
| [HATE](https://github.com/RNA4219/harness-auto-test-evidence) | JUnit、coverage、artifactを品質証跡へ正規化する | LakdaのHATE/v1 manifestを受け取る |
| [manual-bb-test-harness](https://github.com/RNA4219/manual-bb-test-harness) | 人間が実targetを確認し、Go/No-Go briefを作る | fixtureでは代替できないoracleを担当 |
| [QEG](https://github.com/RNA4219/quality-evidence-graph) | 全証跡をgraph化し、最終Gate verdictとrecordを生成する | Lakdaの外部にある最終判定者 |

今回の自己完結したQEG入力、`go` verdict、recordは[docs/release-gate/qeg-600a037/](docs/release-gate/qeg-600a037/gate-input.json)から辿れます。HATE export成功はQEG `go`と同義ではなく、QEG自身のschema-check、hash verify、Gate評価が必要です。

## 実装済みの機能面

| 機能 | 内容 | 入口 | ローカル実証 |
|---|---|---|---|
| 決定的実行とreplay | `smoke`、`seeded-random`、回帰replayをseed付きで再現 | `lakda run` / `lakda replay` | 済み |
| 適応型探索 | 表示・操作可能要素からcandidateを生成し、各操作後にDOMを再観測 | `lakda run --mode adaptive-explore` | 済み |
| 状態graphとcoverage | fingerprint、遷移、未探索優先、plateau停止、backtrackを記録 | adaptive run artifact | 済み |
| 安全制御と入力 | allowlist、deny操作、予算、mutation policy、kill switch、seed付き同値・境界・異常値入力 | `lakda.config.json` | 済み |
| P8 組合せ探索 | constraint-safeなpairwise／mixed-strength suiteを生成・検証 | `lakda combo gen` / `lakda combo verify` | 済み |
| P9 scouting | timeout、oracle failure、coverage gapなどをSignal／Leadへ正規化 | `lakda scout` / `lakda report leads` | 済み |
| P10 調査・昇格・縮約 | strict replay、reproduced-only promote、安全なfailure shrinking | `lakda investigate` / `lakda promote` | 済み |
| P11 case受入 | 承認targetでcase単位のreal acceptanceを実行・検証 | `npm run acceptance:extension:real` | runner実装済み。revision `600a037`の公開reference stagingで範囲限定実証済み |

P8〜P11の契約は[拡張仕様書](docs/spec/lakda-extension/README.md)を正本とします。fixture成功を実環境受入へ昇格しません。reference stagingの実証も、実機や認可済みsecurity targetの代替にはしません。

## 最短のローカル検証

```powershell
npm ci
npx playwright install chromium
npm run check
npm run acceptance:fixture
npm run acceptance:adaptive
npm run pack:check
```

この経路は、型・lint・ビルド・Playwright回帰・fixture受入・公開package境界を検証します。実サーバー、実機、実モデル、認可済みsecurity targetには接続しません。

## Codex Skills（任意）

Codexで保守や受入作業を行う場合は、次のpersonal Skillsを利用できます。これらはnpm packageのruntime依存ではなく、作業手順と責務境界をCodexへ与えるための補助です。

| Skill | 使う場面 |
|---|---|
| `lakda-maintainer` | Lakdaの設定、CLI、adapter、P8〜P11、real acceptance、HATE/QEG境界を変更・レビューするとき |
| `five-tool-validation-gate` | RanD → Code-to-gate → HATE → manual-bb → QEGを一続きのrelease evidenceとして実行するとき。全体フローの正本は[workflow-cookbook](https://github.com/RNA4219/workflow-cookbook) |
| [`manual-bb-test-harness`](https://github.com/RNA4219/manual-bb-test-harness/tree/main/skills/manual-bb-test-harness) | 仕様とriskから手動ブラックボックスケース、strict Gate、Go/No-Go briefを作るとき |
| `agent-tools-hub` | Agent_tools全体の入口を選び、workflow-cookbook・manual-bb・QEGへの読み順を整理するとき |
| `workflow-agent-evidence` | workflow-cookbookのEvidence recordとLakda/HATEの証跡連携を保守するとき |
| `local-llm-launcher` | operatorが実Qwenをloopbackで起動・停止し、model IDとGGUF SHA-256を固定するとき |

人間が先に読む正本はこのREADME、[RUNBOOK.md](RUNBOOK.md)、各仕様書です。Skillは正本を置き換えず、fixtureを実環境証跡へ昇格させる権限も持ちません。

## 使い方

### 診断とsmoke

`doctor`は読み取り専用です。許可済みのローカルまたはstaging URLだけを指定してください。

```powershell
lakda doctor
lakda run --base-url http://127.0.0.1:3000 --mode smoke --seed 1
```

実行結果は`.lakda/runs/<run-id>/`に保存されます。action sequence、console、failure report、必要に応じてtrace／screenshot、HATE/v1 manifestを確認できます。

### 適応型探索

`adaptive-explore`には、対象host、adapter、停止条件、recovery、mutation方針を明示した`lakda.config.json`が必要です。既存の決定的modeとは別契約です。

```powershell
lakda run --base-url <approved-base-url> --mode adaptive-explore --persona <persona> --seed <seed>
```

設定例、adapter capability、recovery、artifact確認は[RUNBOOK.md](RUNBOOK.md)と[適応型探索仕様](docs/spec/adaptive-exploration/README.md)を参照してください。

### 組合せ探索、scouting、調査

```powershell
lakda combo gen --factor-model <factor-model.json> --seed 1 --strength 2 --case-budget 50 --out <suite.json>
lakda combo verify --factor-model <factor-model.json> --suite <suite.json> --out <coverage.json>
lakda scout --config <lakda.config.json> --suite <trace-or-suite.json> --scout-mode rule-only --out <leads.json>
lakda investigate --lead <lead.json> --trace <adaptive-trace.json> --config <lakda.config.json> --reviewer <reviewer-ref> --out <investigation.json>
lakda promote --investigation <investigation.json> --kind trace --out <promotion.json>
```

P10の調査は、Leadと元traceを同じ設定で一度だけ再生する人間向けの手順です。

1. `lakda scout` でtraceからLead reportを作る。
2. `lakda investigate` にLead、元の`adaptive/trace.json`、同じ`lakda.config.json`、reviewer参照、出力先を明示する。
3. preflightでschema/version、Lead digest、seed、base URLとallowHosts、target kind、URL scopeを検証してから、対象へ接続する。
4. 再生中はcandidateの再解決、実行status、pre/post fingerprint、settle status、popup/iframe/new-tabを含むtarget topology、generic/product/security oracleの署名を比較する。比較は一回だけで、差分・欠落・不明はfail-closedになる。
5. `status=reproduced` かつreplayDigest、oracleRefs、evidenceRefsが揃った場合だけ`lakda promote`が成功する。`not_reproduced`、`replay_diverged`、`inconclusive`、artifact欠落は昇格できない。

Lakdaが生成するのはredacted artifactとHATE/v1 manifestまでです。最終のGo/No-Go、QEG record、QEG verdictは外部工程です。[HATE](https://github.com/RNA4219/harness-auto-test-evidence)で証跡を正規化し、[QEG](https://github.com/RNA4219/quality-evidence-graph)で最終Gateを判定してください。
factor modelは安全なfixture値と専用constraint DSLだけを受け入れます。scoutはrule-firstであり、LLMが使える場合でも提示済みLead IDの選択または停止だけが許されます。`promote`はstrict replayで再現済み、かつartifact／oracle参照が揃う場合だけ成功します。

## 安全性と証跡

- 操作はallow host、deny操作、mutation種別、操作予算、kill switchの検査後にだけ実行します。
- Airtest/PocoとSecurity bridgeは、Lakdaが外部processを起動せず、operator管理のloopback endpointにだけ接続します。
- Security機能は認可済み環境の補助です。本番への攻撃的scan、無承認mutation、LLMだけによる脆弱性認定は行いません。
- artifactはredaction、secret/PII scan、容量判定、SHA-256、HATE/v1 exportを通します。raw prompt、認証情報、storageState、実入力値を公開証跡へ含めません。
- mock、fixture、状態注入は補助証跡です。実サーバー・実機の受入証跡とは区別します。

## 受入とリリースの状態

| 区分 | 状態 | 意味 |
|---|---|---|
| P8〜P10ローカル機能検証 | 実施済み | 決定性、coverage、fail-closed、replay、promotion、redactionをfixtureで検証 |
| P11 reference staging | 実施済み（範囲限定） | revision `600a037`、公開・非破壊target、実Qwen、case単位runner/verifierで確認 |
| 実機・認可済みsecurity target・実ZAP | 未実施 | operator承認と外部環境が必要 |
| P7 real 16 AC corpus | 未実施 | immutable corpus、実target、artifact再照合が必要 |
| manual-bb / QEG final Gate | reference stagingで実施済み | manual-bb strict P0 4/4、QEG `go`。対象revisionと適用境界を固定 |

P7の環境変数、corpus、case report、suite verifierの証跡条件は[P7 Real Adaptive Acceptance Runbook](docs/acceptance/P7-REAL-ACCEPTANCE-RUNBOOK.md)に固定しています。P11の別target、実機、security環境には、新しい承認とrevision-bound evidenceが必要です。直近の範囲限定`go`と残留境界は[品質証跡記録](docs/acceptance/AC-20260716-19.reference-staging-qeg-go.md)、機械可読な判定は[QEG gate verdict](docs/release-gate/qeg-600a037/gate-verdict.json)を参照してください。

P7/P11のrunnerとrunbookは開発・評価用であり、npm packageには含めません。

## ドキュメントの入口

| 確認したいこと | 正本 |
|---|---|
| 実行方法、環境、artifact確認、失敗時復旧 | [RUNBOOK.md](RUNBOOK.md) |
| 現行v1の要件・仕様 | [REQUIREMENTS.md](REQUIREMENTS.md) / [SPECIFICATION.md](SPECIFICATION.md) |
| 適応型探索の要件・評価 | [追加要件](REQUIREMENTS-ADAPTIVE-EXPLORATION.md) / [仕様・評価](docs/spec/adaptive-exploration/README.md) |
| P8〜P11の要件・仕様・チェックリスト | [拡張要件](docs/spec/Lakda拡張要件定義書.md) / [拡張仕様書](docs/spec/lakda-extension/README.md) |
| 設計・安全方針 | [BLUEPRINT.md](BLUEPRINT.md) / [GUARDRAILS.md](GUARDRAILS.md) |
| 受入証跡 | [docs/acceptance/](docs/acceptance/) |
| 最終品質Gate | [QEG gate input](docs/release-gate/qeg-600a037/gate-input.json) / [verdict](docs/release-gate/qeg-600a037/gate-verdict.json) / [record](docs/release-gate/qeg-600a037/output-record.json) |
| 背景調査・原資料（非規範） | [docs/reference/](docs/reference/README.md) |
| 外部検証ツール | [HATE](https://github.com/RNA4219/harness-auto-test-evidence) / [QEG](https://github.com/RNA4219/quality-evidence-graph) / [five-tool workflow](https://github.com/RNA4219/workflow-cookbook) |
| 実装計画・Task Seed | [適応型探索計画](docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) / [拡張計画](docs/IMPLEMENTATION-PLAN-LAKDA-EXTENSION.md) / [docs/tasks/](docs/tasks/) |

仕様の正本は現行v1では`REQUIREMENTS.md`と`SPECIFICATION.md`、適応型探索では`REQUIREMENTS-ADAPTIVE-EXPLORATION.md`と`docs/spec/adaptive-exploration/`、P8〜P11では`docs/spec/lakda-extension/`です。参考調査資料だけを根拠に公開契約を変更しないでください。
