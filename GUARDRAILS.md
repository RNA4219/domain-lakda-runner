# GUARDRAILS: domain-lakda-runner

Workflow-cookbook の `GUARDRAILS.md` を上位方針とし、このリポジトリでは以下を実装時の停止条件とする。要件の正本は [REQUIREMENTS.md](REQUIREMENTS.md)、詳細契約は [SPECIFICATION.md](SPECIFICATION.md) である。

## 変更境界

- v1 の対象は Chromium、smoke、seeded-random、regression-replay、`llm-explore`、HATE/v1 manifest に限る。
- `src/`、`tests/`、CI、依存関係、認証データは実装 Task Seed の対象に明記されていない限り変更しない。
- `core/schema/**`、`auth/**` に相当する共有契約・認証実装を変更するときは、Task Seed と人手レビューを必須とする。
- 1回の実装ループは原則 source 2ファイルまたは100行以内。docs-only の準備作業は除外する。

## LLM とブラウザの安全境界

- LLM は `action | stop | hold`、`candidateId`、`inputProfileId`、`reason`、`confidence` の strict JSON だけを返す。
- Executor が提示した candidate ID の allowlist 外、任意コード、任意 URL、任意 selector、shell command は拒否する。
- LLM の raw output を `eval`、shell、ブラウザ API の引数へ直接渡さない。
- prompt injection、secret 混入、外部 URL 遷移、破壊操作は Executor 側で拒否し、拒否理由を証跡へ残す。
- LLM は pass/fail や QEG Gate を決定しない。一次オラクルは pageerror、HTTP status、timeout、状態差分などの機械観測とする。

## 実行環境と証跡

- LLM endpoint は `http://127.0.0.1:8080/v1` を既定とし、外部 bind を許可しない。
- 実モデル ID、GGUF SHA-256、engine 版、chat template、prompt/schema hash、seed、sampling、token 数、latency、retry、raw response hash を run metadata へ保存する。
- retry は接続 reset と一時的 5xx のみ最大2回。同一 prompt/seed/sampling で行う。Schema 不正、意味的不合格、モデル不一致は retry しない。
- secret、token、storage state はログ・artifact・fixture に平文で保存しない。
- `doctor` は読み取り専用。`doctor --fix` と自動起動・自動 fallback は v1 対象外。

## 連携境界

- Lakda は HATE/v1 artifact manifest までを担当する。
- QEG 変換は HATE adapter、Gate verdict は QEG 側の責務とする。
- `lakda:` ID は HATE 入力内だけで使用し、QEG ID として出力しない。
- HATE audit record は Lakda が生成しない。artifact 検証後に HATE が生成する。

## テストと停止条件

- 実装は tests-first とし、fake OpenAI 互換 server による決定的契約テストを PR 必須とする。
- JSON Schema 不適合、allowlist 外操作、モデル不在、必須 artifact 欠落は成功扱いにしない。
- 既知欠陥検出率70%以上、false positive15%以下、replay 成功率85%以上、必須 artifact 欠落率1%以下を満たさない場合はリリース候補を停止する。
- LLM 受入は Schema 適合率100%、allowlist 外操作0件、暗黙 fallback 0件、critical golden case 全件成功とする。

## 許可されない近道

- QEG 完全 record の直接生成、Lakda による Gate 判定、LLM の直接 shell 実行。
- LLM 不在時の別モデルへの暗黙切替。
- 失敗時 artifact の削除、結果の上書き、再試行による意味的不合格の隠蔽。
- 未固定のバージョン、モデル、schema のままの受入判定。
