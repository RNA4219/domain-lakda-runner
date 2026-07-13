# EVALUATION: domain-lakda-runner

## 判定の位置づけ

この文書は実装と受入の契約であり、Lakda の `RunResult.outcome` や QEG の Gate verdict を代替しない。実装準備の判定は `ready | hold | blocked` とし、実行時の終了コードは [SPECIFICATION.md](SPECIFICATION.md) に従う。

## v1 受入条件

| ID | 受入条件 | 検証方法 | 対応仕様 |
|---|---|---|---|
| AC-001 | 同一入力の deterministic action plan が byte-identical となる率100%。 | unit + contract | 5.1 |
| AC-002 | 既知欠陥20件以上に対する検出率70%以上。 | golden suite | 7.1 |
| AC-003 | 正常ケース20件以上に対する false positive 率15%以下。 | golden suite | 7.1 |
| AC-004 | replay sequence 20件×3回の最後までの実行成功率85%以上。 | replay suite | 5.1, 7.2 |
| AC-005 | 必須 artifact 欠落率1%以下。critical failure run の欠落は0件。 | artifact audit | 8 |
| AC-006 | 生成した全 artifact manifest が固定 HATE/v1 schema に適合する。 | schema contract | 8 |
| AC-007 | LLM decision 20件×3回の strict JSON Schema 適合率100%。 | fake/local LLM suite | 5.3 |
| AC-008 | allowlist 外 URL、未提示 candidate、deny action の実行件数0。 | security suite | 5.2, 9 |
| AC-009 | 指定外モデルへ暗黙 fallback した件数0。 | provider contract | 6.1, 6.2 |
| AC-010 | critical LLM decision 10件×3回が全件期待 outcome を満たす。 | local LLM acceptance | 5.2, 6 |
| AC-011 | LLM停止時も deterministic mode が継続し、`llm_status=unavailable` を記録する。 | integration | 7.2 |
| AC-012 | `doctor` 前後で tracked file、browser installation、process、port listener に変更がない。 | doctor immutability | 4.1 |
| AC-013 | secret fixture がartifact/prompt/raw outputに平文で残らず、LLM出力がコード実行されない。 | security suite | 8, 9 |
| AC-014 | `workers=2..4`を逐次実行し、seed、独立run/HATE、全worker継続、batch集約、RunBatchResultを検証する。 | batch contract | 5.1, 7.2 |
| AC-015 | 共有Action Budgetのrate limitがLLM/Playwright操作を停止し、partial/rate_limit/exit 2を返す。 | fake clock + batch contract | 7.2, 8 |
| AC-016 | redacted DOM snapshotをactionごとに保存し、HATE static登録と実bytes security scanを検証する。 | DOM/security contract | 2.1, 8, 9 |

## LLM 固有受入

- strict JSON Schema 適合率100%。
- candidate allowlist 外操作、任意コード、shell、任意 URL、任意 selector は0件。
- endpoint 不在・モデル不一致時の暗黙 fallback は0件。
- critical golden case は全件成功。LLM 単独の pass/fail または Gate 判定は0件。
- `temperature=0`、`top_p=1`、action decision `max_tokens=512`、接続 timeout 5秒、生成 timeout 60秒を既定値として検証する。
- retry は接続 reset と一時的 5xx の最大2回だけで、Schema 不正・意味的不合格・モデル不一致を再試行しない。

## 品質指標

| 指標 | v1 閾値 | 証跡 |
|---|---:|---|
| 既知欠陥検出率 | >=70% | golden report |
| false positive | <=15% | classifier report |
| replay 成功率 | >=85% | replay report |
| 必須 artifact 欠落率 | <=1% | artifact audit |
| LLM Schema 適合率 | 100% | decision validation |
| allowlist 外操作 | 0件 | security report |
| 暗黙 fallback | 0件 | run metadata audit |
| critical golden case | 全件成功 | acceptance record |

## テスト層

| 層 | 対象 | 実行条件 |
|---|---|---|
| unit | config、candidate validator、classifier、exit code | 毎回。LLM は fixture |
| contract | OpenAI 互換 client、HATE/v1 manifest、CLI JSON | PR 必須。fake server 固定 |
| integration | Chromium、artifact lifecycle、replay、sequential worker batch | PR または専用 runner |
| security | secret redaction、allowlist、loopback、prompt injection | PR 必須 |
| golden | 欠陥検出、false positive、critical cases | 受入時・リリース候補 |
| local-llm | 実 GGUF、latency、raw hash、再現性 | 明示 opt-in。`npm run acceptance:real-llm`で固定corpusを実行。決定的CIから分離 |

## 実装準備の受入（AC-20260712-00）

- [x] REQUIREMENTS と SPECIFICATION が正本として存在する。
- [x] BLUEPRINT、GUARDRAILS、RUNBOOK、EVALUATION、Task Seed が相互リンクする。
- [ ] source、test、CI、dependency の変更がないことを実装開始前に確認する。
- [ ] M1–M4 の依存と受入証跡の保存先が Task Seed にある。
- [x] Birdseye/Codemap はコード生成後に workflow-cookbook の更新コマンドで生成する。

## トレーサビリティ

| 要件群 | 仕様節 | 受入 |
|---|---|---|
| REQ-FN-001 | 1, 4, 5 | AC-002, AC-003 |
| REQ-FN-002〜003 | 5.1 | AC-001 |
| REQ-FN-004 | 4.1, 5.1 | AC-001, AC-004 |
| REQ-FN-005 | 5.2 | AC-007〜AC-010 |
| REQ-FN-006 | 4.1, 9 | AC-013 |
| REQ-FN-007 | 7.1 | AC-002, AC-003 |
| REQ-FN-008〜010 | 8 | AC-005, AC-006 |
| REQ-FN-011 | 4.1 | AC-012 |
| REQ-FN-012 | 7.2 | AC-001〜AC-016 |
| REQ-LLM-001 | 3, 6.1 | AC-010 |
| REQ-LLM-002〜003 | 5.2, 5.3, 9 | AC-007, AC-008 |
| REQ-LLM-004〜005 | 6.2, 6.3 | AC-010 |
| REQ-LLM-006 | 6.1, 6.2, 7.2 | AC-009 |
| REQ-LLM-007 | 7.2 | AC-011 |
| REQ-LLM-008 | 2, 7, 8.3 | AC-002, AC-003 |
| REQ-LLM-009 | 4.1, 6.1 | AC-010 |
| REQ-SEC-001〜002 | 3, 5.2, 9 | AC-008 |
| REQ-SEC-003〜005 | 8, 9 | AC-005, AC-013 |
| REQ-SEC-006 | 3, 5.2 | AC-008, AC-010 |
| REQ-SEC-007 | 3, 9 | AC-002, AC-003 |
| REQ-NF-001 | 1, 2, 6 | AC-010, AC-011 |
| REQ-NF-002 | 5.1 | AC-001 |
| REQ-NF-003〜004 | 6.3, 8 | AC-005, AC-006 |
| REQ-NF-005 | 3 | post-v1 性能評価 |
| REQ-NF-006 | 6.3 | post-v1 重複排除評価 |
| REQ-FN-013 | 2.1、8 | AC-016 |
| REQ-FN-014 | 5.1、7.2 | AC-014 |
| REQ-FN-015 | 8.1、9 | AC-016 |
| REQ-SEC-008 | 2.1、8、9 | AC-015、AC-016 |
| REQ-NF-007 | 5.1、7.2 | AC-014、AC-015 |


### 要件IDの明示カバレッジ

自動検査で範囲表記を取りこぼさないよう、全要件IDを明示する。各IDは上表の仕様節・受入列または post-v1 評価へ対応する。

`REQ-FN-001` `REQ-FN-002` `REQ-FN-003` `REQ-FN-004` `REQ-FN-005` `REQ-FN-006` `REQ-FN-007` `REQ-FN-008` `REQ-FN-009` `REQ-FN-010` `REQ-FN-011` `REQ-FN-012` `REQ-FN-013` `REQ-FN-014` `REQ-FN-015`

`REQ-LLM-001` `REQ-LLM-002` `REQ-LLM-003` `REQ-LLM-004` `REQ-LLM-005` `REQ-LLM-006` `REQ-LLM-007` `REQ-LLM-008` `REQ-LLM-009`

`REQ-NF-001` `REQ-NF-002` `REQ-NF-003` `REQ-NF-004` `REQ-NF-005` `REQ-NF-006` `REQ-NF-007`

`REQ-SEC-001` `REQ-SEC-002` `REQ-SEC-003` `REQ-SEC-004` `REQ-SEC-005` `REQ-SEC-006` `REQ-SEC-007` `REQ-SEC-008`
post-v1 の要件も未定義のまま放置せず、対応する性能・重複排除評価を実装 Task の受入へ追加してから範囲に入れる。


