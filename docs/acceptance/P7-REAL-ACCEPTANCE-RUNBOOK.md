# P7 実環境適応型受入ランブック

## 状態

P7は引き続き`pending_external`です。このランブックはoperator向けの契約を定義するものであり、承認済み外部target、実機、認可済みsecurity環境、手動review、QEG Gateを代替しません。

## 入力

すべての入力が揃っていない場合、runnerはLakdaの読込みやtargetへの接続より前に失敗します。

- `LAKDA_ADAPTIVE_REAL_CONFIRM=I_UNDERSTAND`
- `LAKDA_ADAPTIVE_REAL_CONFIG`: `mode=adaptive-explore`と`baseUrl`を持つ既存の`lakda/v1` config。正確なfile bytesのSHA-256が、選択したcorpus caseの`configDigest`と一致しなければならない
- `LAKDA_ADAPTIVE_TARGET_MANIFEST`: `status=ready` の承認済み `lakda/target-manifest/v1`。origin、host/path scope、mutation allowlist、action contract、settle policy、受入必須action IDの正本として扱う
  - `binding.targetRevision` はcorpusの `targetRevision`、`binding.configDigest` は選択caseの `configDigest` と完全一致させる。不一致時はbrowser moduleを読込まず終了code 2とする
- `LAKDA_ADAPTIVE_CORPUS_PATH`: immutableなcorpus file
- `LAKDA_ADAPTIVE_CASE_ID`: そのcorpusに存在するcase ID
- `LAKDA_ADAPTIVE_ENVIRONMENT`: 承認済みenvironment label
- `LAKDA_ADAPTIVE_TARGET_REVISION`: immutable corpusの`targetRevision`と完全一致しなければならない表明値

corpus契約は次のとおりです。

```json
{
  "schemaVersion": "lakda/adaptive-acceptance-corpus/v1",
  "corpusId": "approved-corpus-id",
  "version": "1.0.0",
  "targetRevision": "product-revision-or-app-hash",
  "cases": [
    { "caseId": "web-dom-refresh-001", "acceptanceId": "AC-AE-001", "configDigest": "sha256:<64-lowercase-hex>", "expected": { "outcome": "passed" } }
  ]
}
```

`acceptanceId`は`AC-AE-001`から`AC-AE-016`まで、期待outcomeは`passed`、`failed`、`partial`、`error`のいずれかでなければなりません。各caseは`configDigest`によって正確なconfig bytesに束縛されます。runnerはoperatorによる上書きを受け入れず、hash済みcorpusからこれらの値とtarget revisionを導出します。revisionまたはconfig digestの不一致は、config読込みやtarget接続より前に拒否されます。corpusとreportのschemaは[adaptive-acceptance-corpus-v1.schema.json](../../schemas/adaptive-acceptance-corpus-v1.schema.json)と[adaptive-acceptance-case-v1.schema.json](../../schemas/adaptive-acceptance-case-v1.schema.json)です。

## 実行

```powershell
$env:LAKDA_ADAPTIVE_REAL_CONFIRM = "I_UNDERSTAND"
$env:LAKDA_ADAPTIVE_REAL_CONFIG = "C:\approved\lakda.real.json"
$env:LAKDA_ADAPTIVE_TARGET_MANIFEST = "C:\approved\target-manifest.ready.json"
$env:LAKDA_ADAPTIVE_CORPUS_PATH = "C:\approved\adaptive-corpus.json"
$env:LAKDA_ADAPTIVE_CASE_ID = "web-dom-refresh-001"
$env:LAKDA_ADAPTIVE_ENVIRONMENT = "staging-chromium"
$env:LAKDA_ADAPTIVE_TARGET_REVISION = "product-revision-or-app-hash"
npm run acceptance:adaptive:real
```

caseごとに1 processを実行します。本番環境または未承認のdevice／hostに対して、このcommandを実行してはいけません。Security caseでは、Lakda configにauthorization record、scope、rate／concurrency上限、cleanup参照、kill-switch参照も必要です。

## 受入一式の検証

すべてのcase reportをreviewし、明示的な相対path indexへ登録した後、読取り専用のsuite verifierを実行します。

```json
{
  "schemaVersion": "lakda/adaptive-acceptance-suite-index/v1",
  "suiteId": "approved-suite-id",
  "version": "1.0.0",
  "reports": [
    { "path": "runs/run-id/adaptive/acceptance-case-web-dom-refresh-001.json", "sha256": "sha256:<64-lowercase-hex>" }
  ]
}
```

```powershell
$env:LAKDA_ADAPTIVE_SUITE_INDEX = "C:\approved\adaptive-suite-index.json"
npm run acceptance:adaptive:verify-real
```

verifierはindex/report schema、report SHA-256、revision/config/outcome/exit codeの束縛、`adaptive/oracle-results.jsonl` refが1件だけであること、Oracle/HATE refの一致、candidate auditの内部整合、最終HATE manifest identity、全参照artifactのbyte size/SHA-256、case IDの一意性、`AC-AE-001`から`AC-AE-016`までの網羅を検証します。manifestは`exports/artifact-manifest.json`に限定し、非canonicalなportable segmentを拒否します。各fileはread前に実体を解決し、symlink/junctionによるroot外参照と非file入力をfail closedにします。成功時も`ready_for_manual_bb_qeg`までで、`p7Status`と`qegHandoff.status`は`pending_external`、`verdictGeneratedByLakda`は`false`のままです。index/readiness schemaは[adaptive-acceptance-suite-index-v1.schema.json](../../schemas/adaptive-acceptance-suite-index-v1.schema.json)と[adaptive-acceptance-suite-readiness-v1.schema.json](../../schemas/adaptive-acceptance-suite-readiness-v1.schema.json)です。

## 不整合時に停止する契約

入力不足、未承認target、schema不一致、無効config、hash不一致、非portable path、symlink/junctionによるrun root外参照、manifest位置不一致、意味的に矛盾するreportは、target操作またはreadiness出力へ進めません。

| Exit | 意味 | 出力契約 |
|---|---|---|
| `0` | case runnerではcase verdictが`passed`、suite verifierでは全16件が手動確認へ引き渡せる状態 | QEG verdictは生成せず、handoffは`pending_external`のまま |
| `2` | 外部入力・承認・証跡が不足または不整合 | stderrへ`status=pending_external`、理由、`verdictGeneratedByLakda=false`を持つJSON envelopeを出力 |
| `1` | Lakda内部または実行基盤の予期しない失敗 | pass/readinessとして扱わず、調査後に再実行 |

Hashだけを再計算した改変もpassにはなりません。report verifierは次を再検証します。

- `revision == corpus.targetRevision`および`configDigest == corpus.caseConfigDigest`;
- `expected.outcome == actual.outcome`、`verdict == passed`、outcomeとexit code（passed=0、error=1、failed/partial=2）の一致;
- OracleResult refが1件だけで、pathが`adaptive/oracle-results.jsonl`、同一refがHATE artifact refsに1件だけ存在;
- candidate auditのcoverage debt/unclassified/violations/debt actionがゼロ、control countが整合し、required action IDsがobserved action IDsに含まれること;
- case report自身と全参照artifactが最終HATE manifestへ同一byte size/SHA-256で束縛されること。

## 証跡条件

caseが受入対象として有効になるのは、次の条件をすべて満たす場合だけです。

- execution modeが`real`であり、target revision、承認済みenvironment、corpus bytesのSHA-256が記録されている。
- 選択したcaseがimmutable corpusに存在し、表明したtarget revisionがcorpusの`targetRevision`と完全一致し、config bytesがcaseの`configDigest`と一致し、期待outcomeが実際のLakda outcomeと一致している。
- HATE/v1 manifestがschema検証に合格し、run ID／attemptと一致し、すべてのartifact sizeとSHA-256が現在のfile bytesと一致している。
- `adaptive/oracle-results.jsonl` artifactへの参照がちょうど1件である。
- `adaptive/acceptance-case-<caseId>.json`が`lakda/adaptive-acceptance-case/v1`に適合し、HATE/v1 artifact refsを再利用し、必須case fieldをすべて含み、そのfile自体も再生成したHATE manifestに含まれている。
- mock／simulated run、artifact欠落、infrastructure error、digest不一致、outcome不一致をpassとして数えない。
- Lakdaが記録するのはcase verdictだけである。HATE／manual-bb／QEGは外部工程のままとし、LakdaはQEG verdict、approval、waiver、recordを生成してはならない。

AC-AE-015では、承認済み実機証跡も必要です。AC-AE-016では、承認済み実security targetと明示的なhuman／oracle確認も必要であり、scannerまたはLLMの出力だけでは候補のままです。P7が`pending_external`から遷移できるのは、全16件のAC reportと後続のHATE／manual-bb／QEG証跡がreview・承認された後だけです。

## 5ツール品質判定の状態

| 工程 | 状態 | 証跡 |
|---|---|---|
| RanD | degraded | repositoryのrequirements／specificationは利用可能だが、新しいRanD packetは未生成。 |
| Code-to-gate | ready | 外部corpus／configを固定した後にstatic gateを実行可能。 |
| HATE | ready | runnerが各real caseのHATE/v1を検証・再生成する。 |
| manual-bb | pending_external | 実target／deviceの観測とoracle reviewが未取得。 |
| QEG | pending_external | 最終bundle、policy、approval、Gate verdictは外部工程。 |
