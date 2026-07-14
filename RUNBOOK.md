# RUNBOOK: domain-lakda-runner

この文書は Workflow-cookbook の「prepare → execute → confirm」を Lakda に割り当てた運用手順である。Lakda の run outcome は QEG Gate verdict ではない。

## 1. 環境

| 環境 | 用途 | LLM |
|---|---|---|
| local-deterministic | 開発、通常CI相当、headed/headless確認 | 不使用。`llm_status=unavailable`を記録 |
| local-llm-explore | 実GGUFの受入 | loopback OpenAI互換endpointのみ |
| CI | 再現性・契約・fixture integration | fake OpenAI互換server固定 |
| staging | v0.2.1 RCの一回限りmanual-bb。継続監視はpost-v1 | browser実機、認証はEnvironment/local auth stateから注入 |

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

実GGUFの受入は、運用者が対象modelをloopbackの`8080`で起動し、期待model IDと実file SHA-256を明示した後にだけ実行する。`full`はworkers=1、通常20ケース×3回＋critical 10ケース×3回の90 child runsでAC-007/010の正本となる。`worker-smoke`はworkers=2、critical 10ケース×1回の20 child runsでAC-014の補助だけに使う。旧`--critical-only`等はcustom扱いでAC-007/010へ適格ではない。

```powershell
$env:LAKDA_REAL_LLM_MODEL = "C:\models\release-model.gguf"
$env:LAKDA_REAL_LLM_MODEL_ID = "release-model.gguf"
$env:LAKDA_REAL_LLM_MODEL_SHA256 = "<64-hex>"
npm run acceptance:real-llm:full -- --out=.lakda/reports/full.json --bundle=.lakda/acceptance/full
npm run acceptance:real-llm:worker-smoke -- --out=.lakda/reports/worker-smoke.json --bundle=.lakda/acceptance/worker-smoke
npm run acceptance:verify -- --report=.lakda/reports/full.json --bundle=.lakda/acceptance/full --check-revision
npm run acceptance:verify -- --report=.lakda/reports/worker-smoke.json --bundle=.lakda/acceptance/worker-smoke --check-revision
```

bundleにはdecision JSONL、action sequence、HATE manifest、bundle manifestだけを含める。DOM、trace、screenshot、auth state、raw prompt、絶対pathは含めず、Gitへcommitしない。report summary、検証結果、bundle SHAだけをGit文書へ記録する。

### v0.2.1 worker batch / artifact確認

`workers=1`は従来どおり単一の`RunResult`をstdoutへ返す。`workers=2..4`の`run`/`replay`は`lakda/run-batch/v1`の`RunBatchResult`を返し、child runごとに独立run directoryとHATE manifestを保存する。workerは逐次実行し、1件の失敗や基盤error後も残りを実行する。seedは`baseSeed + workerIndex`、batch共有Action Budgetは60秒sliding windowで、上限到達時は待機せず`partial/rate_limit`でworkerを終了する。

`artifacts.domSnapshots=true`を指定したrunでは、成功action後の`artifacts/dom/0001-<action-id>.html`を確認する。保存内容はredacted HTMLのみで、script本文、form値、password/token/secret要素、`data-lakda-sensitive`要素の内容と全属性を含めない。保存前は実際に保存するUTF-8 bytesで容量判定し、metadataなど最終必須artifactの保存後に上限超過となった場合は、任意artifactであるDOM snapshotを削除して`partial/artifact_limit`とする。HAR指定時は`artifacts/network.har`だけを確認し、一時raw HARが残っていないこと、すべてのheader値、cookie、Set-Cookie、query値、bodyにsecret/PIIがないことを確認する。
### HATE出力と後続連携

```text
lakda export hate --run-dir .lakda/runs/<run-id> --out .lakda/runs/<run-id>/exports/artifact-manifest.json
hate export qeg --manifest .lakda/runs/<run-id>/exports/artifact-manifest.json
qeg validate --input <qeg-record>
qeg gate --input <qeg-record>
```

Lakdaの責務はHATE/v1 manifestまでである。HATE adapterがQEG IDへ変換し、QEGがGateを決定する。
### v0.2.1 Release Candidate Gate

`.github/workflows/release-evidence.yml`をself-hosted Windows/Qwen runnerで手動起動する。GitHub Environmentの`staging`へHTTPS staging URL、allowlist、認証secretを設定し、manual-bb recordにはsecret値を入れない。実行順はdeterministic CI → full 90-run → worker-smoke 20-run → bundle/security検証 → Code-to-gate strict → HATE upstream → manual-bb real staging → QEG validate/gate/recordである。

manual recordは[manual-bb schema](schemas/manual-bb-release-record-v1.schema.json)に従い、対象40桁revision、HTTPS staging origin、明示allowlist、`testExecutionMode=real`、全caseのpass結果、operator、実行時刻、参照artifactのsize/SHA-256を持つ。`testExecutionMode=mock`、full/worker証跡欠落、HATE upstream未確認、Code-to-gate strict未達では`npm run release:prepare-gate`がQEG入力を作らない。

staging入力またはself-hosted runnerがない場合、workflowを成功扱いにせずRCを`hold`にする。Lakdaが生成するのはsanitized QEG入力候補までであり、`qeg gate`と`qeg record`を実行してverdict/recordを生成する主体はQEGである。PRをreadyにするのは全必須checkとQEG `go`後だけとする。 security scan済みrelease packageだけをActions artifact（90日）とrelease attachmentへ保存し、raw Code-to-gate/HATE出力、manual record、失敗途中のpartial packageはuploadしない。Medium findingは`triage-verification.json`へfingerprint、根拠、担当、期限、入力hashを残し、未分類・stale・blanket suppressionをGate前に拒否する。

## 4. Confirm

- `.lakda/runs/<run-id>/` に `run-metadata.json`、`action-sequence.json`、`console.jsonl`、`failure-report.json`、`exports/artifact-manifest.json` が存在する。
- browser起動済みの `failed` / `partial` / `error` ではtraceと最低1枚のscreenshotがある。browser未起動のrate_limit/config errorへcaptureを要求しない。
- outcomeと終了コードが一致する（0=passed、1=error、2=failed/partial）。
- HATE/v1 schemaに適合し、再exportのmanifest bytesが一致し、LakdaがQEG record、Gate verdict、QEG用`lakda:` IDを出力していない。
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

Task完了時は`docs/acceptance/AC-YYYYMMDD-xx.md`または`.json`へ対象commit SHA、CI URL、dataset/model attestation、profile/coverage、検証結果、bundle SHAを記録し、`docs/completion-record.md`とCHANGELOGへリンクする。過去JSONは改変せず、誤ったcoverage主張は後続訂正文書で訂正する。Birdseye/Codemapは`codemap.config.json`に従い`docs/acceptance/**/*.{md,json}`を発見し、`.lakda/**`を除外する。未変更capsuleのtimestampを維持したままworkflow-cookbookの`--repo-root`指定で更新する。
