# RUNBOOK: domain-lakda-runner

この文書は Workflow-cookbook の「prepare → execute → confirm」を Lakda に割り当てた運用手順である。Lakda の run outcome は QEG Gate verdict ではない。

## 1. 環境

| 環境 | 用途 | LLM |
|---|---|---|
| local-deterministic | 開発、通常CI相当、headed/headless確認 | 不使用。`llm_status=unavailable`を記録 |
| local-llm-explore | 実GGUFの受入 | loopback OpenAI互換endpointのみ |
| CI | 再現性・契約・fixture integration | fake OpenAI互換server固定 |
| staging | 現行release profileに束縛したRC検証。real targetは承認済みmanifestがある場合だけ接続 | browser実機、認証はEnvironment/local auth stateから注入 |

固定版とSHAは [REQUIREMENTS.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/REQUIREMENTS.md) / [SPECIFICATION.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/SPECIFICATION.md) を正本とする。run metadataには実行時の版、commit SHA、seed、schema/upstream SHAを記録する。

## 1.1 現行release profile

現行候補の唯一の可変入口は [release-profiles/current.json](release-profiles/current.json) である。package version、設計入力、必須check、RanD入力、受入ID、artifact prefix、five-tool namespaceを同一profileへ固定し、次で接続前に検証する。

```powershell
npm run release:validate-profile
npm run check:docs
```

`.github/workflows/release-evidence.yml` は `reference_target_manifest_path` を含む承認済み外部入力を検査し、profile ID/SHA-256とcandidate revisionをprepared evidenceへ保存する。profile不一致、未知check、参照欠落、target manifest欠落ではreal targetへ接続しない。manual-bbは人間の確認記録、QEGだけが最終Go/No-Goを決定する。

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

### Historical / Legacy: v0.2.1 worker batch / artifact確認

`workers=1`は従来どおり単一の`RunResult`をstdoutへ返す。`workers=2..4`の`run`/`replay`は`lakda/run-batch/v1`の`RunBatchResult`を返し、child runごとに独立run directoryとHATE manifestを保存する。workerは逐次実行し、1件の失敗や基盤error後も残りを実行する。seedは`baseSeed + workerIndex`、batch共有Action Budgetは60秒sliding windowで、上限到達時は待機せず`partial/rate_limit`でworkerを終了する。

`artifacts.domSnapshots=true`を指定したrunでは、成功action後の`artifacts/dom/0001-<action-id>.html`を確認する。保存内容はredacted HTMLのみで、script本文、form値、password/token/secret要素、`data-lakda-sensitive`要素の内容と全属性を含めない。保存前は実際に保存するUTF-8 bytesで容量判定し、metadataなど最終必須artifactの保存後に上限超過となった場合は、任意artifactであるDOM snapshotを削除して`partial/artifact_limit`とする。HAR指定時は`artifacts/network.har`だけを確認し、一時raw HARが残っていないこと、すべてのheader値、cookie、Set-Cookie、query値、bodyにsecret/PIIがないことを確認する。
### Historical / Legacy: v0.3.0-rc.1 適応型探索 / P6

`lakda.config.json`で`mode=adaptive-explore`と`adaptive`契約を明示し、対象host、target kind、mutation kind、停止条件、recovery budgetを固定して実行する。

```powershell
lakda run --base-url <approved-base-url> --mode adaptive-explore --persona <persona> --seed <seed>
npm run acceptance:adaptive
```

Playwright adapterはin-processで動作する。Airtest/PocoとSecurity adapterはoperator管理のloopback JSON serviceへ接続し、Lakdaは外部processを起動しない。endpoint/capability/initialTargetが欠ける場合はfail-closedとする。Security active操作では認可record、scope、rate/concurrency、kill switch、cleanupを必須とし、scanner/LLMの結果はcandidateから自動昇格させない。

P6 RCのローカル納品Gateは`npm run check`、`npm run acceptance:fixture`、`npm run acceptance:adaptive`、`npm run check:hate`、`npm run pack:check`である。これはpackageの再現性とfixture受入を示すが、Airtest/Poco実機、認可済みSecurity target、manual-bb/QEG final Gateを代替しない。

### P10 strict replay・調査・昇格

P10はfixtureの成功を本番Goへ変換する機能ではなく、同じ入力を一回だけ再生して人間の調査対象を絞る手順です。元traceとconfigを保存したまま、次の順で実行します。

```powershell
lakda scout --config <lakda.config.json> --suite <adaptive-trace.json> --scout-mode rule-only --out <leads.json>
lakda investigate --lead <leads.json> --trace <adaptive-trace.json> --config <lakda.config.json> --reviewer <reviewer-ref> --out <investigation.json>
lakda promote --investigation <investigation.json> --kind trace --out <promotion.json>
```

`investigate` は `--lead`、`--trace`、`--config`、`--reviewer`、`--out` を必須とします。configのschema、seed、Lead digest、base URL/allowHosts、target kind、URL scopeを先に検証し、失敗時は対象へ接続しません。strict replayはcandidateの再解決、status、pre/post fingerprint、settle、popup/iframe/new-tab topology、generic/product/security oracle署名を比較します。

調査結果の `status` は `reproduced`、`not_reproduced`、`replay_diverged`、`inconclusive` のいずれかです。`reproduced` でも replayDigest、oracleRefs、evidenceRefs が欠けていれば昇格できません。元trace、Lead、run artifactは変更せず、promotionはportableな参照とparent digestを持つ派生recordだけを作ります。

Lakdaの出力はredacted artifactとHATE/v1 manifestまでです。HATE export後のQEG入力、QEG record、Gate verdictは外部の[HATE](https://github.com/RNA4219/harness-auto-test-evidence)／[QEG](https://github.com/RNA4219/quality-evidence-graph)工程で扱い、Lakda自身はGo/No-Goを生成しません。

### HATE出力と後続連携

```text
lakda export hate --run-dir .lakda/runs/<run-id> --out .lakda/runs/<run-id>/exports/artifact-manifest.json
hate export qeg --manifest .lakda/runs/<run-id>/exports/artifact-manifest.json
qeg validate --input <qeg-record>
qeg gate --input <qeg-record>
```

Lakdaの責務はHATE/v1 manifestまでである。HATE adapterがQEG IDへ変換し、QEGがGateを決定する。
### Historical / Legacy: v0.3.0-rc.5 revision-bound Release Candidate Gate

`.github/workflows/release-evidence.yml`は手動起動の二段階Gateです。対象は`candidate_ref`で固定した40桁SHAであり、`package.json`のrc versionと一致しなければなりません。workflowはこのSHA以外のcommitやdirty worktreeを受け入れません。

`prepare`はself-hosted Windows/Qwen runnerで次を順に実行します。

1. retryなし・single workerの`npm run check`、fixture、adaptive、package、HATE upstream。
2. 承認済みreference stagingのimmutable config/corpus/caseを使うP11 real acceptanceとverifier。
3. 固定`b431504...`のRanD audit、固定revisionのCode-to-gateとHATE、実Qwen full 90-runとworker-smoke 20-run。
4. sanitized prepared evidenceのsecurity scanとdigest固定。

reference stagingのconfig、corpus、case、target revision、allowlist、kill switchが欠ける場合は`pending_external`相当のHOLDで停止する。fixture、mock、RanD fixtureは実targetの代替ではない。

`finalize`はprepared artifactとstrict manual-bb recordを同じcandidate SHAで照合してから、外部QEGのschema-check、evidence verify、gate、recordを実行する。RanD → Code-to-gate → HATE → manual-bb-test-harness → QEGのcommit、artifact hash、QEG policy hash、final verdictはworkflow-cookbookのfive-tool manifestで再検証する。QEG `go`とP0/P1 blockerなし以外ではrelease tagを作成しない。

`publish_release=true`を明示した場合だけ、QEG `go`後に`release_tag=v<package version>`を対象SHAへ作成し、sanitized evidence zipをprereleaseへ添付する。`600a037`の過去証跡は履歴であり、rc.5のGateを省略する根拠にはならない。

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

### AC-AE-016 Security実受入

Security実受入は既存の`acceptance:adaptive:real` runnerを使い、別runnerを増やさない。targetへ接続する前に次をすべて満たすこと。

- `LAKDA_ADAPTIVE_TARGET_MANIFEST`は`lakda/target-manifest/v2`で、status=`ready`、staging origin、target revision/config digestを固定する。
- authorizationのEd25519署名、期間、approval evidence refを検証できること。
- configの`securityEnvironment`とauthorizationのenvironmentが一致し、production activeを含まないこと。
- host/pathに加えてHTTP methodとrequest template SHA-256がscope内であること。
- security profile、capability handshake、loopback bridge endpointの各digestがmanifest/config/runtimeで一致すること。
- operator bridgeは各実行で`securityPermit`を受け取り、cleanupとkill switch endpointを提供すること。

case reportは`lakda/adaptive-acceptance-case/v2`となり、policy評価数、開始request数、permit receipt、cleanup、kill switch、binding digestを`securityAudit`へ保存する。16 ACのsuite verifierでは`LAKDA_ADAPTIVE_SECURITY_TARGET_MANIFEST`を指定し、署名とreportのmanifest ID/SHA-256/revision/config bindingを再検証する。LakdaはHATE/v1への登録までを行い、manual-bb/QEG verdictは引き続き`pending_external`とする。
