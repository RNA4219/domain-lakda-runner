# RUNBOOK: domain-lakda-runner

この文書は Workflow-cookbook の「prepare → execute → confirm」を Lakda に割り当てた運用手順である。Lakda の run outcome は QEG Gate verdict ではない。

## 1. 環境

| 環境 | 用途 | LLM |
|---|---|---|
| local-deterministic | 開発、通常CI相当、headed/headless確認 | 不使用。`llm_status=unavailable`を記録 |
| local-llm-explore | 実GGUFの受入 | loopback OpenAI互換endpointのみ |
| CI | 再現性・契約・fixture integration | fake OpenAI互換server固定 |
| staging | post-v1監視候補 | v1対象外 |

固定版とSHAは [REQUIREMENTS.md](REQUIREMENTS.md) / [SPECIFICATION.md](SPECIFICATION.md) を正本とする。run metadataには実行時の版、commit SHA、seed、schema/upstream SHAを記録する。

## 2. Prepare

```text
npm ci
npx playwright install chromium
lakda doctor
lakda auth validate --persona <persona> --base-url <base-url>
```

`doctor` は読み取り専用であり、file、browser installation、process、port listenerを変更しない。`doctor --fix` はv1に存在しない。auth storageStateは `.lakda/auth/` に保存しGitへ入れない。

`llm-explore` は明示設定されたmodel path、loopback endpoint、expected model ID、GGUF SHA-256が一致するときだけ使用できる。起動・停止はLakdaではなく運用者が行う。

## 3. Execute

### 決定的モード

```text
lakda run --base-url <base-url> --mode smoke --persona <persona> --seed <seed>
lakda run --base-url <base-url> --mode seeded-random --persona <persona> --seed <seed>
lakda replay --input .lakda/runs/<run-id>/action-sequence.json --base-url <base-url>
```

### ヘッデッド回帰と任意の外部スモーク

ローカルでブラウザ表示を伴う回帰確認を行う場合は、次を実行する。CIではこのテストをskipし、headlessの通常suiteを正本とする。

```text
npm run test:headed
```

外部環境へのsmokeは、明示したURLだけをallow hostへ設定して1 actionを実行する。URL未指定時は成功扱いのskipとなり、外部ネットワークへ接続しない。設定に使う環境変数は `LAKDA_EXTERNAL_BASE_URL` だけであり、secretやartifact保存先を環境変数で暗黙上書きしない。

```text
LAKDA_EXTERNAL_BASE_URL=https://example.test npm run smoke:external
```

### LLM探索モード

```text
lakda run --base-url <base-url> --mode llm-explore --persona <persona> --seed <seed>
```

LLMは安全検査済みcandidate IDの選択または停止だけを返す。一次オラクルは機械ruleであり、LLMはpass/failやGateを決めない。

実GGUFの受入は、運用者がQwen3.5-4Bをloopbackの`8080`で起動・verifyした後にだけ実行する。これは固定corpusのLLM decision 20件×3回とcritical 10件×3回を実ブラウザで確認し、raw run directoryを残さず集計recordだけを出力する。

```text
npm run acceptance:real-llm -- --out=docs/acceptance/AC-YYYYMMDD-02.real-llm.json
```

### v0.2 worker batch / artifact確認

`workers=1`は従来どおり単一の`RunResult`をstdoutへ返す。`workers=2..4`の`run`/`replay`は`lakda/run-batch/v1`の`RunBatchResult`を返し、child runごとに独立run directoryとHATE manifestを保存する。workerは逐次実行し、1件の失敗や基盤error後も残りを実行する。seedは`baseSeed + workerIndex`、batch共有Action Budgetは60秒sliding windowで、上限到達時は待機せず`partial/rate_limit`でworkerを終了する。

`artifacts.domSnapshots=true`を指定したrunでは、成功action後の`artifacts/dom/0001-<action-id>.html`を確認する。保存内容はredacted HTMLのみで、script本文、form値、password/token/secret要素、`data-lakda-sensitive`内容を含めない。
### HATE出力と後続連携

```text
lakda export hate --run-dir .lakda/runs/<run-id> --out .lakda/runs/<run-id>/exports/artifact-manifest.json
hate export qeg --manifest .lakda/runs/<run-id>/exports/artifact-manifest.json
qeg validate --input <qeg-record>
qeg gate --input <qeg-record>
```

Lakdaの責務はHATE/v1 manifestまでである。HATE adapterがQEG IDへ変換し、QEGがGateを決定する。

## 4. Confirm

- `.lakda/runs/<run-id>/` に `run-metadata.json`、`action-sequence.json`、`console.jsonl`、`failure-report.json`、`exports/artifact-manifest.json` が存在する。
- `failed` / `partial` ではtraceと最低1枚のscreenshotがある。
- outcomeと終了コードが一致する（0=passed、1=error、2=failed/partial）。
- HATE/v1 schemaに適合し、LakdaがQEG record、Gate verdict、QEG用`lakda:` IDを出力していない。
- LLM使用時はendpoint、model、model SHA、runtime/template/prompt/schema hash、sampling、TTFT、latency、retry、raw/redacted response hashが残る。
- secret、token、storageStateがartifact、prompt、raw response保存物に残っていない。

## 5. 失敗時の復旧

| 状況 | 対応 |
|---|---|
| deterministic modeでLLMが利用不可 | `llm_status=unavailable`を記録し継続 |
| `llm-explore`でmodel不在/不一致 | `error`、exit 1。fallbackせず設定を修正 |
| schema不正/未提示candidate | retryせず`error`、exit 1。実行なし |
| browser crash/navigation timeout | machine failureとして`failed`、exit 2。trace等を保存してreplay |
| 必須artifact/hash/manifest失敗 | UI-008の`error`、exit 1。invalid manifestは公開しない |
| 誤った変更を戻す必要がある | 該当commitを`git revert`し、既存artifactは削除しない |

## 6. 完了記録

Task完了時は `docs/acceptance/AC-YYYYMMDD-xx.md` または `.json` にcommit SHA、CI URL、dataset/model hash、実行結果を記録し、完了後に `docs/completion-record.md` とCHANGELOGへリンクする。Birdseye/Codemapはコード構成の生成後、workflow-cookbookの`--repo-root`指定でdry-run後に更新する。
