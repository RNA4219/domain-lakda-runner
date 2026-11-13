# GUARDRAILS: domain-lakda-runner

Workflow-cookbook の `GUARDRAILS.md` を上位方針とし、このリポジトリでは以下を実装時の停止条件とする。文書の優先順位は [HUB](HUB.codex.md) に従う。v1 公開契約の要件の正本は [REQUIREMENTS.md](REQUIREMENTS.md)、詳細契約は [SPECIFICATION.md](SPECIFICATION.md) である。

## 変更境界

- `src/`、`tests/`、CI、依存関係、認証データは実装 Task Seed の対象に明記されていない限り変更しない。
- `core/schema/**`、`auth/**` に相当する共有契約・認証実装を変更するときは、Task Seed と人手レビューを必須とする。

## LLM とブラウザの安全境界

- LLM は `decision`（`action | stop | hold`）、`reason`、`confidence` の strict JSON だけを返す。`action` では `candidateId` を必須とし、`inputProfileId` は任意で、返す場合は提示した candidate の値と一致させる。`stop` と `hold` では `candidateId` を返さない。
- Executor が提示した candidate ID の allowlist 外、任意コード、任意 URL、任意 selector、shell command は拒否する。
- LLM の raw output を `eval`、shell、ブラウザ API の引数へ直接渡さない。
- prompt injection、secret 混入、外部 URL 遷移、破壊操作は Executor 側で拒否し、拒否理由を証跡へ残す。
- LLM は pass/fail や QEG Gate を決定しない。一次オラクルは pageerror、HTTP status、timeout、状態差分などの機械観測とする。

## adapter・bridge・証跡の安全境界

- 操作はallow host、deny操作、mutation種別、操作予算、kill switchの検査後にだけ実行する。
- screenshot、trace、videoは画面上の情報を含み得るため、承認済みtargetでartifact classificationとretentionを設定し、sanitized release bundleやGitへ含めない。
- Airtest/PocoとSecurity bridgeは、Lakdaが外部processを起動せず、operator管理のloopback endpointにだけ接続する。bridgeはredirectを追跡せず、JSON content typeと1 MiBのrequest/response上限を検査する。
- Security機能は認可済み環境の補助である。passive候補を含む全candidateで独立したenvironment、host/path、HTTP method、request template digest、capability/bridge digestを照合し、実行時はpermit receiptをbridgeへ渡す。本番への攻撃的scan、無承認mutation、LLMだけによる脆弱性認定は行わない。
- text artifactはredaction、secret/PII scan、容量判定、SHA-256、HATE/v1 exportを通す。screenshot／trace／videoはtext scan済みと偽らず、通常runでは`redaction_status=pending`、scanは`not_applicable`として保持する。real探索でbinaryをHATEへ登録するには、target manifestで許可した外部attestorの署名付きscan結果を必須とする。raw prompt、認証情報、storageState、実入力値を公開証跡へ含めない。
- mock、fixture、状態注入は補助証跡である。実サーバー・実機の受入証跡とは区別する。

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

## 現行release profile境界

- `release-profiles/current.json`を現行RCの正本とし、package version、設計入力、必須check、受入ID、artifact namespaceを同時に検証する。
- live release workflowへ過去RC固有のartifact名、scope、acceptance ID、RanD入力を直書きしない。
- profile IDとSHA-256をcandidate revisionへ束縛し、finalize時にcheckout側とprepared artifact側の両方を再照合する。
- 未知check、repository外参照、欠落参照、未承認target manifestはtarget接続前にfail-closedとする。
- `docs/release-gate`と`docs/acceptance`の既存証跡は履歴としてimmutableに扱い、現行profileへ転用しない。

## Historical / Legacy: v1 対象範囲と v0.2.1 責務境界

- v1 の対象は Chromium、smoke、seeded-random、regression-replay、`llm-explore`、HATE/v1 manifest に限る。
- Artifact Storeへfilesystem、JSON、列挙、hash、portable pathを集約し、CollectorとHATE Exporterを相互importさせない。
- Artifact Policyが実bytesのsecret/PII scan、必須artifact、profile、容量を検査し、Outcome Policyが最終outcome/termination reasonを決める。Policy順序はbase保存→scan→outcome→atomic metadata/failure→再scan→HATE exportで固定する。
- batch workerは逐次実行し、共有Action Budget上限到達時はLLM/Playwright操作を行わず`partial/rate_limit`で停止する。
- HARは`content=omit`の一時captureを構造化redactionして保存し、raw HARを削除する。binary以外へ固定passを設定せず、実bytes scanとclassificationをHATEへ伝播する。
- DOM snapshotはbrowser内clone後のredacted HTMLだけを保存し、raw DOMを保存しない。容量超過は`partial/artifact_limit`、snapshot保存失敗は`error/artifact_failure`とする。

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
