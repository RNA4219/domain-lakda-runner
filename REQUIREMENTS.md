---
document_id: LAKDA-REQ-001
status: normative
version: 1.0.0-draft
last_updated: 2026-07-12
---

# domain-lakda-runner 要件定義

## 1. 文書の位置づけ

本書は `domain-lakda-runner` v1 の規範的な要件正本である。解釈が競合する場合は、本書、`SPECIFICATION.md`、`deep-research-report (11).md` の順で優先する。調査報告書は背景と選定理由を提供する参考資料であり、Must/Should、公開契約、schema、Gate 権限を定義しない。

要件は次の語で強度を示す。

- **Must**: v1 の受入に必須
- **Should**: v1 で設計上考慮するが、実装完了は post-v1 でもよい
- **Could**: 将来候補
- **Out**: v1 の対象外

## 2. 目的と対象利用者

`domain-lakda-runner` は、ローカルの実ブラウザを安全かつ再現可能に操作し、実行結果を HATE/v1 が検証可能な証跡として保存する local-first のブラウザ探索 runner である。

主な利用者は次のとおりである。

- ローカル開発中に UI 回帰を探索する開発者
- 再現可能なブラウザ証跡を必要とする QA 担当者
- HATE/QEG に品質証跡を受け渡すリリース担当者
- ローカル LLM を用いた探索テストを評価するモデル運用者

## 3. 用語と責務境界

| 用語 | 定義 |
|---|---|
| deterministic mode | 実行前に action plan を確定し、LLM に次操作を決めさせないモード |
| `llm-explore` | Executor が提示する安全な候補から、ローカル LLM が次操作、停止、保留を選ぶ独立モード |
| run outcome | Lakda の単一 run の技術的結果。`passed / failed / partial / error` |
| gate verdict | QEG が複数証跡と policy から決定する `go / conditional_go / no_go / disqualified` |
| artifact manifest | Lakda が生成する HATE/v1 `artifact-manifest` |
| audit record | artifact 検証後に HATE が生成する記録。Lakda は生成しない |

Lakda は browser evidence producer であり、最終リリース Gate、承認、waiver、QEG `quality-evidence-record` の生成責任を持たない。QEG 連携は次の経路に限定する。

```text
Lakda -> HATE/v1 artifact-manifest -> HATE validation/export -> QEG validate/gate
```

## 4. 検証済み基準環境

v1 の文書・実装・受入試験は次の固定値を基準とする。変更時は本書と `SPECIFICATION.md` の両方を更新し、golden suite を再承認する。

| 対象 | 固定値 |
|---|---|
| OS | Microsoft Windows 11 Home 10.0.26200、build 26200、x86_64 |
| Node.js | 24.6.0 |
| npm | 11.5.1 |
| Playwright | `@playwright/test` 1.61.1 |
| HATE | package 0.3.0、schema `HATE/v1`、Git SHA `3a4b655c2434109e230f8b862a9d5fe14f1c069e` |
| QEG | package/schema 0.2.0、Git SHA `958fd284c3d371b3562114d1f9cba5fdc27ab7fc` |
| LLM runtime | `llama-server` version 9733、build `f449e0553`、Windows x86_64 |
| LLM model | `Qwen3.5-4B-Q4_K_M.gguf`、2,740,937,888 bytes |
| model SHA-256 | `00FE7986FF5F6B463E62455821146049DB6F9313603938A70800D1FB69EF11A4` |
| LLM context | 8,192 tokens |
| LLM endpoint | `http://127.0.0.1:8080/v1` |

この表は対応可能な全環境を意味しない。v1 の受入対象は上記基準環境であり、Linux、macOS、Arm、別 runtime、別 GGUF、別量子化は post-v1 の互換性評価対象とする。

## 5. v1 機能要件

### 5.1 実行と再現

| ID | 強度 | 要件 |
|---|---|---|
| REQ-FN-001 | Must | Chromium を headless と headed の両方で実行できること。 |
| REQ-FN-002 | Must | `smoke` と `seeded-random` を deterministic mode として実行できること。 |
| REQ-FN-003 | Must | action plan を実行前に JSON 化し、候補の安定 sort、単一 seed、時刻非依存の乱数消費順で生成すること。 |
| REQ-FN-004 | Must | 保存済み action sequence を `regression-replay` で再実行できること。 |
| REQ-FN-005 | Must | `llm-explore` を deterministic mode とは別のモードとして提供すること。 |
| REQ-FN-006 | Must | persona ごとに Playwright `storageState` を切り替え、実行前に認証状態を検証できること。 |
| REQ-FN-007 | Must | `pageerror`、browser crash、console error、主要 request の 5xx、許可ルートの 401/403/404、timeout、予期しない logout を機械判定すること。 |
| REQ-FN-008 | Must | run metadata、action sequence、console log、failure report、HATE artifact manifest をすべての完了 run で保存すること。 |
| REQ-FN-009 | Must | `failed` または `partial` の run で trace と screenshot を保存すること。 |
| REQ-FN-010 | Must | HATE/v1 artifact manifest を正本 schema に適合させ、実 artifact の path、size、SHA-256、classification、redaction、retention、security check を記録すること。 |
| REQ-FN-011 | Must | `doctor` は環境を読み取り専用で診断し、ファイル、依存関係、browser、process を変更しないこと。 |
| REQ-FN-012 | Must | run outcome と process exit code を仕様書の対応表どおりに返すこと。 |

### 5.2 ローカル LLM

| ID | 強度 | 要件 |
|---|---|---|
| REQ-LLM-001 | Must | OpenAI 互換 `/v1/models` と `/v1/chat/completions` を使用し、loopback endpoint のみを許可すること。 |
| REQ-LLM-002 | Must | `llm-explore` では安全検査済み候補 ID だけを LLM に提示し、LLM が任意 URL、selector、コード、path、shell command を実行対象として指定できないこと。 |
| REQ-LLM-003 | Must | LLM 出力を strict JSON とし、`action / stop / hold` の判別、理由、confidence、および action 時の候補 ID を schema 検証すること。 |
| REQ-LLM-004 | Must | endpoint、実モデル ID、GGUF SHA-256、runtime、chat template、prompt/schema hash、seed、sampling 値、token 数、latency、retry、raw response hash を証跡化すること。 |
| REQ-LLM-005 | Must | 接続 reset と一時的 5xx だけを最大2回 retryし、schema 不正、意味的不合格、モデル不一致を retry しないこと。 |
| REQ-LLM-006 | Must | 指定モデルが不在または不一致なら `llm-explore` を `error` で終了し、別モデルへ暗黙 fallback しないこと。 |
| REQ-LLM-007 | Must | deterministic mode は LLM 不在でも継続し、metadata に `llm_status=unavailable` を記録すること。 |
| REQ-LLM-008 | Must | LLM を唯一の failure oracle、run outcome 決定者、QEG Gate 決定者として使用しないこと。 |
| REQ-LLM-009 | Must | `/v1/models` と小さな completion の疎通確認を品質受入 suite と区別すること。 |

### 5.3 セキュリティ

| ID | 強度 | 要件 |
|---|---|---|
| REQ-SEC-001 | Must | browser 遷移を `baseUrl` と明示 allow host に限定すること。 |
| REQ-SEC-002 | Must | delete、deactivate、billing、transfer 等の破壊操作を既定 deny とし、v1 では LLM が解除できないこと。 |
| REQ-SEC-003 | Must | prompt、console、network、screenshot、LLM raw response から token、cookie、authorization、email、phone を保存前に redaction すること。 |
| REQ-SEC-004 | Must | auth state を repository 外または ignore 対象へ保存し、artifact classification を既定 `internal` とすること。 |
| REQ-SEC-005 | Must | LLM 出力を `eval`、動的 import、shell、PowerShell、`cmd.exe` へ渡さないこと。 |
| REQ-SEC-006 | Must | action 数、run 時間、LLM request 数、artifact size、worker 数に上限を設定できること。 |
| REQ-SEC-007 | Must | state を変更するテストでは run 前後の fixture reset hook を必須化すること。 |

### 5.4 非機能

| ID | 強度 | 要件 |
|---|---|---|
| REQ-NF-001 | Must | browser、LLM、artifact、report をローカルで完結でき、クラウド接続を必須にしないこと。 |
| REQ-NF-002 | Must | 同一 config、seed、fixture、browser version から同一 deterministic action plan を生成すること。 |
| REQ-NF-003 | Must | すべての artifact に run ID、attempt、commit SHA、作成時刻、producer version を関連付けること。 |
| REQ-NF-004 | Must | schema version と upstream Git SHA を記録し、未対応 schema への暗黙変換を禁止すること。 |
| REQ-NF-005 | Should | 基準環境の単一ホストで2〜4 workerを安定実行できること。 |
| REQ-NF-006 | Should | 同一 error signature に対する LLM 分類をhash単位で重複排除すること。 |

## 6. post-v1

次は v1 の受入対象外とする。

| 強度 | 項目 |
|---|---|
| Should | Firefox / WebKit |
| Should | `route-crawl`、`form-fuzz`、`visual-sanity` |
| Should | video、HAR、DOM snapshot、visual baseline、semantic diff |
| Should | CI self-hosted runner 上の実 LLM suite、staging synthetic monitoring |
| Could | `llm-enrich` による failure summarization、dedupe、risk/requirement 候補 |
| Out | Lakda による QEG `quality-evidence-record`、gate verdict、approval、waiver の直接生成 |
| Out | `doctor --fix`、複数ホスト分散、hosted SaaS control plane、RUM、backend performance test |

## 7. 受入条件

評価 corpus は version と SHA-256 を持つ固定 dataset とする。最低構成は既知欠陥20件、正常ケース20件、replay sequence 20件、LLM decision 20件とし、LLM decision のうち10件を critical とする。replay と LLM decision は各ケース3回実行する。

| ID | 対応要件 | 合格条件 |
|---|---|---|
| AC-001 | REQ-FN-002〜004、REQ-NF-002 | deterministic action plan が同一入力で byte-identical となる率100%。 |
| AC-002 | REQ-FN-007 | 既知欠陥20件以上に対する検出率70%以上。 |
| AC-003 | REQ-FN-007 | 正常ケース20件以上に対する false positive 率15%以下。 |
| AC-004 | REQ-FN-004 | replay sequence 20件×3回の最後までの実行成功率85%以上。 |
| AC-005 | REQ-FN-008〜010 | 必須 artifact 欠落率1%以下。critical failure run の欠落は0件。 |
| AC-006 | REQ-FN-010、REQ-NF-004 | 生成した全 artifact manifest が固定 HATE/v1 schema に適合すること。 |
| AC-007 | REQ-LLM-003 | LLM decision 20件×3回の strict JSON Schema 適合率100%。 |
| AC-008 | REQ-LLM-002、REQ-SEC-001〜002 | allowlist 外 URL、未提示 candidate、deny action の実行件数0。 |
| AC-009 | REQ-LLM-006 | 指定外モデルへ暗黙 fallback した件数0。 |
| AC-010 | REQ-LLM-001〜009 | critical LLM decision 10件×3回が全件期待 outcome を満たすこと。 |
| AC-011 | REQ-LLM-007 | LLM 停止時に deterministic mode が継続し、`llm_status=unavailable` を記録すること。 |
| AC-012 | REQ-FN-011 | `doctor` 前後で tracked file、browser installation、process、port listener に変更がないこと。 |
| AC-013 | REQ-SEC-003〜005 | secret fixture が保存 artifact、prompt、LLM raw output に平文で残らず、LLM 出力がコード実行されないこと。 |

## 8. リリース判定

v1 の文書上の完成は、`SPECIFICATION.md` の traceability matrix がすべての Must 要件と受入条件を参照し、孤立要件が0件であることを必要とする。実装のリリース判定は全 Must と AC-001〜AC-013 の証跡が揃った後に QEG が行う。Lakda 自身の `passed` はリリース `go` を意味しない。

