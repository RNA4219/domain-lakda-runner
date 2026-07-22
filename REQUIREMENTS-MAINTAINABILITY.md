---
document_id: LAKDA-REQ-MNT-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
implementation_plan: docs/IMPLEMENTATION-PLAN-MAINTAINABILITY.md
specification_index: docs/spec/maintainability/README.md
---

# Lakda 保守性・拡張性要件定義書

## 1. 目的

Lakda 0.4系以降の要求追加を、安全境界と既存公開契約を壊さず受け入れられる構造へ整理する。正本管理、release profile、real acceptance共通契約、安全な組み込みregistry、run比較、module境界、sanitized exampleを対象とする。

## 2. 変更しない境界

- `smoke`、`seeded-random`、`regression-replay`の選択規則、artifact、終了codeを変更しない。
- HATE/v1の生成・検証までをLakdaの責務とし、QEG verdict、approval、waiver、recordを生成しない。
- 任意module path、動的import、外部process起動、LLM生成selector・URL・input・commandを拡張機構へ持ち込まない。
- fixture、mock、simulated evidenceをreal acceptanceへ昇格しない。
- 歴史的release Gate文書、Acceptance artifact、保存済みQEG artifactを再生成または書き換えない。

## 3. Repository Governance / Release Profile

| 要件ID | 優先度 | 要件 |
|---|---|---|
| REQ-MNT-GOV-001 | Must | 保守要件、5仕様、各仕様に1件だけ紐づく正本チェックリスト、実装計画、Task Seedを索引から追跡できること。 |
| REQ-MNT-GOV-002 | Must | 文書checkerは仕様・チェックリストの1対1対応、要件IDと受入IDの欠落、正本分岐、broken linkをfail-closedで検出すること。 |
| REQ-MNT-GOV-003 | Must | P8〜P11の詳細チェックリストを正本とし、既存短縮版はチェック項目を持たない非規範aliasとすること。 |
| REQ-MNT-GOV-004 | Must | 現行release候補は`lakda/release-profile/v1`でversion、scope、設計入力、必須check、外部入力名、artifact名、受入IDを固定すること。 |
| REQ-MNT-GOV-005 | Must | live release workflowはcurrent profileを検証し、package version不一致、未知check、参照欠落、stale profileをtarget接続前に拒否すること。 |
| REQ-MNT-GOV-006 | Must | live workflowのartifact名、scope、acceptance ID、RanD入力を特定の過去RCへ直書きしないこと。 |
| REQ-MNT-GOV-007 | Must | 歴史的profile、release設計入力、QEG/Acceptance artifactはimmutableとして扱い、現行導線と表示上分離すること。 |

## 4. Real Acceptance Core

| 要件ID | 優先度 | 要件 |
|---|---|---|
| REQ-MNT-ACC-001 | Must | P7/P11はschema検証、canonical digest、corpus/case preflight、target manifest照合、HATE bytes/hash検証を共通coreから利用すること。 |
| REQ-MNT-ACC-002 | Must | target manifest、承認、scope、revision、config digest、mutation、settle policyをbrowserまたはbridge接続前に検証すること。 |
| REQ-MNT-ACC-003 | Must | preflight不成立はtargetへ接続せず、`pending_external`と理由を保存し、exit code 2とすること。内部障害はexit code 1と区別すること。 |
| REQ-MNT-ACC-004 | Must | P11 v2 reportはtarget manifest ID/digestとcandidate auditを持ち、P0/P1候補欠落、coverage debt、未分類controlを合格扱いにしないこと。 |
| REQ-MNT-ACC-005 | Must | P7既存reportとP11歴史的v1 artifactは読取互換を維持し、既存bytesを変更しないこと。 |
| REQ-MNT-ACC-006 | Must | verifierはreport refだけを信用せず、最終HATE manifest、artifact bytes、size、SHA-256を独立再照合すること。 |

## 5. Extension Registry / LLM Selection

| 要件ID | 優先度 | 要件 |
|---|---|---|
| REQ-MNT-EXT-001 | Must | Adapter、Generator、Oracleはbuilt-in allowlist registryから解決し、未知IDまたはcapability不一致を接続前に拒否すること。 |
| REQ-MNT-EXT-002 | Must | registryは`playwright`、`airtest-poco`、`security`および承認済み組み込みGenerator/Oracleだけを登録し、任意code pluginをロードしないこと。 |
| REQ-MNT-EXT-003 | Must | Oracleはgeneric、宣言型product contract、security candidateを別責務として評価し、LLMをpass/failまたはGate verdictの決定者にしないこと。 |
| REQ-MNT-EXT-004 | Must | `llm-select`へ渡す値は安全検査済みcandidate IDとredaction済みgraph summaryだけとすること。 |
| REQ-MNT-EXT-005 | Must | `llm-select`はstrict JSONで候補IDまたはstopだけを受理し、提示外ID、追加key、selector、URL、input、code、command、oracle verdictを拒否すること。 |
| REQ-MNT-EXT-006 | Must | LLM不在、timeout、不正応答時は別Generatorへ暗黙fallbackせず、`partial`、`llm_error`と検査済み証跡を残して停止すること。 |
| REQ-MNT-EXT-007 | Must | 各Generatorは同一config、seed、Observation列、candidate列でbyte-identicalな選択列を返すこと。 |
| REQ-MNT-EXT-008 | Must | registry導入で既存5 mode、config validation、trace、replay契約を変更しないこと。 |

## 6. Run Catalog / Graph Comparison

| 要件ID | 優先度 | 要件 |
|---|---|---|
| REQ-MNT-RUN-001 | Must | `runs list`と`runs show`はrun directoryを読取専用で索引・表示し、artifactを変更しないこと。 |
| REQ-MNT-RUN-002 | Must | `runs list`は最大100件、開始日時降順、同値時run ID順で決定的に返すこと。 |
| REQ-MNT-RUN-003 | Must | `runs compare`はbase/headのHATE manifestとartifact bytes/hashを再検証してから比較すること。 |
| REQ-MNT-RUN-004 | Must | 比較結果はstate、transition、transition-pair、round-trip、coverage、outcome、termination reasonの差分をcanonical JSONで表すこと。 |
| REQ-MNT-RUN-005 | Must | manifest欠落、改ざん、graph version不一致、path traversalを非0 exitで拒否すること。 |
| REQ-MNT-RUN-006 | Must | run index/detail/comparisonはversioned schemaを持ち、secret、PII、絶対path、認証状態を含めないこと。 |
| REQ-MNT-RUN-007 | Must | 本改修ではrun削除、prune、外部uploadをCLIへ追加しないこと。 |

## 7. Module Boundaries / Examples

| 要件ID | 優先度 | 要件 |
|---|---|---|
| REQ-MNT-MOD-001 | Must | Playwright Adapterを観測、candidate抽出、topology、実行、recoveryの責務へ分割すること。 |
| REQ-MNT-MOD-002 | Must | Coordinatorをruntime setup、観測loop、選択、oracle、recovery、shrinkingへ分割すること。 |
| REQ-MNT-MOD-003 | Must | CombinationとCLIを責務別moduleへ分割し、既存公開fileを互換facadeとして維持すること。 |
| REQ-MNT-MOD-004 | Must | 分割前後で公開export、schema、artifact path、終了code、deterministic action sequenceを維持すること。 |
| REQ-MNT-MOD-005 | Must | Playwright安全設定、factor model、replay、`pending_external` target manifestのsanitized exampleを提供しschema検証すること。 |
| REQ-MNT-MOD-006 | Must | exampleとpackage内容をsecret/PII scanし、credential、ready real target、実入力、storageStateを含めないこと。 |

## 8. 受入条件

| 受入ID | 対象 | 条件 |
|---|---|---|
| AC-MNT-001 | REQ-MNT-GOV-001〜003 | 5仕様と5正本チェックリストが1対1で、aliasにcheckboxがなく、文書checkerが分岐と欠落を拒否する。 |
| AC-MNT-002 | REQ-MNT-GOV-004〜007 | current profileがschema/packageと一致し、live workflow内の`rc5`/`v0.3.0-rc.5`固定値が0件である。 |
| AC-MNT-003 | REQ-MNT-ACC-001〜003 | P7/P11共通preflightが入力欠落を接続前にexit 2、`pending_external`へ固定する。 |
| AC-MNT-004 | REQ-MNT-ACC-004〜006 | P11 v2 candidate auditとHATE tamper negativeが通り、歴史的v1を読取検証できる。 |
| AC-MNT-005 | REQ-MNT-EXT-001〜003 | 未知registry ID/capabilityを拒否し、Oracle責務とQEG境界が維持される。 |
| AC-MNT-006 | REQ-MNT-EXT-004〜008 | `llm-select`が提示外ID、不正JSON、timeoutをfail-closedにし、randomへfallbackしない。 |
| AC-MNT-007 | REQ-MNT-RUN-001〜002 | list/showが読取専用、上限100件、決定的順序で動作する。 |
| AC-MNT-008 | REQ-MNT-RUN-003〜007 | 正常な2 runを決定的に比較でき、改ざん・version不一致・path traversalを拒否する。 |
| AC-MNT-009 | REQ-MNT-MOD-001〜004 | module分割前後の公開契約、CLI help、fixture action sequenceが同等である。 |
| AC-MNT-010 | REQ-MNT-MOD-005〜006 | 全exampleがschema/package/secret・PII検査を通り、real-ready値を含まない。 |

## 9. トレーサビリティ

- 仕様・チェックリスト正本: [docs/spec/maintainability/README.md](docs/spec/maintainability/README.md)
- Workflow-cookbook実装計画: [docs/IMPLEMENTATION-PLAN-MAINTAINABILITY.md](docs/IMPLEMENTATION-PLAN-MAINTAINABILITY.md)
- current release profile: [release-profiles/current.json](release-profiles/current.json)
- 実装がlocal Gateを通っても、実target、manual-bb、外部QEGが未完了なら`pending_external`を維持する。
