# RUNBOOK: domain-lakda-runner

この文書は Workflow-cookbook の「prepare → execute → confirm」を Lakda に割り当てた運用手順である。Lakda の run outcome は QEG Gate verdict ではない。

## 1. 環境

レポートの件数上限・表示性能は、repoで`npm run acceptance:reports`を実行して測定する。インストール済みWindows Chrome／Edgeを隔離profileで使い、100 run・履歴10,000件・failure 1,000件の人工保存入力を生成する。1366×768／390×844、browser zoom 100%／200%を検証し、全測定値・入力digest・bundle・画像・失敗理由を`.lakda/report-acceptance-<固有ID>/result.json`から参照できる。同じcommandで、画像の原寸表示とキー移動、参照対応・share除外、動画位置保持／停止、decode fallbackの媒体40ケースも実行する。媒体の詳細結果は`media/result.json`、移動後の閲覧用bundleは`media/images-moved`等へ保存する。外部targetへ接続しない。通常の`npm test`にはbrowser導入や性能閾値を要求しない。実機・手動受入・release Gateは別途実施する。測定条件は[SPEC-01](docs/spec/verification-reports/SPEC-01-REPORTING.md)を参照する。

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

### 失敗時の画面証跡

通常runのbrowser起動後non-passでは、既定で最終画面の`artifacts/failure.png`、操作・画面snapshot・networkを時系列で確認できる`artifacts/trace.zip`、人間が再生できる`artifacts/video/0001.webm`を保持する。

```powershell
npx playwright show-trace .lakda/runs/<run-id>/artifacts/trace.zip
```

録画を明示的に無効化する場合は、`lakda.config.json`へ次を設定する。

```json
{
  "artifacts": {
    "video": false
  }
}
```

`false`は録画なし、`true`は通常runの全run保持、既定の`"retain-on-non-pass"`は実行中録画してpassed時に削除し、`failed / partial / error`だけ`artifacts/video/0001.webm`からの連番で保持する。`regression-replay`、実LLMの`full` profile、`acceptance:fixture`のfull corpusは設定値にかかわらず`false`とし、failure screenshot／traceは維持する。Playwrightの録画はcontext終了時に確定するため、このモードは直前N秒の循環bufferではなくnon-pass run全体を残す。画面証跡は認証情報やPIIを含み得るので、承認済みtargetと適切なclassificationでのみ有効化し、Gitやsanitized release bundleへ入れない。

### 保存結果のHTMLレポート

概要の「操作件数・実行時間など」を開くと、観測した操作数と計画数、実行時間、除外媒体数を確認できます。結果一覧のメッセージは最大2行で、項目を開くと全文を表示します。詳細はスクロール中も「詳細を閉じる」またはEscapeで閉じ、元の行へフォーカスが戻ります。

日本語は`--report-language ja`、英語は`--report-language en`で生成します。`run`／`replay`／`explore run`／`explore resume`の自動生成と`report generate`に共通です。レポート設定`lakda.report.json`の`language`にも保存でき、CLI指定＞設定＞`ja`の順に解決します。画面の見出し・説明・操作ラベルを切り替え、テスト由来のメッセージ・履歴・ID・コードは原文を保ちます。保存済みのレポートはそのまま保持し、別言語が必要なら新しい出力先へ再生成します。

結果詳細では、手順一覧と選択した手順・画像をPCで並べ、狭幅では縦に表示します。「失敗した手順へ」で保存済みの失敗へ移動し、「前の手順」「次の手順」でページをまたいで確認できます。操作名・対象・状態・時間・判定メッセージは保存された範囲だけを表示し、「実行済み」と判定の「合格」を区別します。旧レポート等の未取得情報から失敗を推定しません。「履歴の選択を解除」で全体の証跡へ戻れます。

findingでは「この項目の証跡」と「実行全体の証跡」を切り替えます。対応を確認できない参照には理由を表示し、画像を推定して割り当てません。動画は利用者が再生し、同じ詳細内では位置を保持します。表示切替や詳細closeでは一時停止します。ID・revision・coverage等は「技術情報・実行記録」、媒体の所属や検査の根拠は「媒体の詳細」で確認できます。

失敗した手順を選んで画像が出ない場合でも、「実行全体の証跡を見る」があれば保存済みの画像・動画を確認できます。手順の選択を維持し、対応が未確認であることを表示します。前／次へ移ると手順別の表示に戻ります。

WindowsでローカルHTMLを開く場合、保存先は既定の`.lakda/reports`程度の短い階層にしてください。深い保存先ではbundle verifyがvalidでもブラウザが画像を開けない場合があります。レポートフォルダー全体を短いパスへコピーして開き、`lakda report verify --report-dir <コピー先>`で整合性を確認できます。

手順を移動すると履歴一覧も選択行へスクロールします。「状態」の「実行失敗」は失敗した実行、「失敗項目」は個別の失敗記録を表示します。キーワードは表示名でも元の`failed`／`failure`でも検索できます。

```text
lakda report generate --run-dir .lakda/runs/<run-directory> --out .lakda/reports/review-01
lakda report generate --session .lakda/explorations/<session-id> --out .lakda/reports/session-review-01 --text-only
lakda report verify --report-dir .lakda/reports/review-01
```

生成はtargetへ再接続せず、HATEと保存内容を読取り検証します。`--out`は未存在directoryで、入力の内側／祖先へは指定できません。生成時のstdoutはreceipt JSONだけです。書込可能な場合は出力directoryの親に`<reportId>.receipt.json`を保存します。`index.html`、CSS／JS、JSON、assetsは一式で保持してください。

生成exitはready=0、degraded／入力不正=2、I/O／内部error／timeout=1です。元runの合否は変えません。verifyはbundleの一致性を検査し、現時点の元runや外部受入を保証する処理ではありません。`local`の未検査媒体は画面で明示し、`--text-only`では全媒体を除外します。`share`は署名検証と媒体policyの両方を満たす媒体だけを同梱します。未知／重複optionを拒否し、設定fileはtarget用設定と別の`lakda.report.json`（明示は`--report-config`）です。

保存済みHATEに`attestations/binary-artifacts.jsonl`が含まれる場合は、report設定の`trustStorePath`へoperatorが管理する鍵一覧を指定します。相対pathは設定file基準です。鍵一覧は1〜64件のEd25519公開鍵（`keyId`と`publicKeyPem`）、配列または`{ "keys": [...] }`形式で、128 KiB以下にします。run内のtrust pathは採用しません。real sessionでは保存時点の署名済みtargetと許可鍵も必要です。媒体詳細の「検証に使った記録」に各digestを表示します。検査記録の不一致はwarning／degraded、HATEの改変やマスク前媒体の残存は入力errorとなります。既に確定したrunへ検査記録を追記・再exportする機能ではありません。

`run`／`replay`／`explore run`／`explore resume`では、確定後に新しいHTML snapshotを自動生成します。`--report off`で停止でき、`--report-dir <output-root>`／`--report-profile local|share`で変更します。stdoutと終了codeは元の結果のまま、stderrの`report` objectにreceipt、`directory`に完成bundle、`receiptPath`に保存先を通知します。失敗・timeout・保存失敗も元の結果を変更しません。

worker batchは全worker終了後に1 bundleを生成し、run作成前に失敗したworkerも表示します。stderrの`sourcesPath`は再生成用のprivate indexです。`lakda report generate --sources <sourcesPath> --out <new-report-dir>`で再生成できます。private indexとHTML bundleは別directoryで、indexは共有するHTMLへ含めません。

単一runはtarget接続前に`run-start.json`を保存します。最終manifestが存在せず開始記録を検証できる場合、`local`では最小診断をdegradedとして生成します。状態は「結果未確定」で、実行中／異常終了の断定や合否・終了時刻・操作数の補完は行いません。未検証の結果file・媒体は使わず、shareは拒否します。旧runで開始記録もない場合や既存manifestが不正な場合は、入力不足／不正として拒否します。自動生成は元の終了codeを保ち、独立generateはdegradedのexit 2、生成したbundleのverifyは整合していればexit 0です。

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

実GGUFの受入は、運用者が対象modelをloopbackの`8080`で起動し、期待model IDと実file SHA-256を明示した後にだけ実行する。`full`はworkers=1、通常20ケース×3回＋critical 10ケース×3回の90 child runsでAC-007/010の正本となり、90回分の録画負荷を避けるためprofile契約で`video=false`に固定する。`worker-smoke`はworkers=2、critical 10ケース×1回の20 child runsでAC-014の補助だけに使う。旧`--critical-only`等はcustom扱いでAC-007/010へ適格ではない。

```powershell
$env:LAKDA_REAL_LLM_MODEL = "C:\models\release-model.gguf"
$env:LAKDA_REAL_LLM_MODEL_ID = "release-model.gguf"
$env:LAKDA_REAL_LLM_MODEL_SHA256 = "<64-hex>"
npm run acceptance:real-llm:full -- --out=.lakda/reports/full.json --bundle=.lakda/acceptance/full
npm run acceptance:real-llm:worker-smoke -- --out=.lakda/reports/worker-smoke.json --bundle=.lakda/acceptance/worker-smoke
npm run acceptance:verify -- --report=.lakda/reports/full.json --bundle=.lakda/acceptance/full --check-revision
npm run acceptance:verify -- --report=.lakda/reports/worker-smoke.json --bundle=.lakda/acceptance/worker-smoke --check-revision
```

bundleにはdecision JSONL、action sequence、HATE manifest、bundle manifestだけを含める。DOM、trace、screenshot、video、auth state、raw prompt、絶対pathは含めず、Gitへcommitしない。report summary、検証結果、bundle SHAだけをGit文書へ記録する。

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

旧P6 workflowは[履歴archive](docs/release-gate/history/README.md)へ退避済みです。上記は当時の手順であり、現行releaseは[current profile](release-profiles/current.json)と[release-evidence.yml](.github/workflows/release-evidence.yml)を使います。

### 自動・クロスプラットフォーム探索MVP

探索はversioned Charterから開始する。PC WebはPlaywright、mobile Webは390×844 touch profile、Windows／Android／iOSはoperatorが先に起動した127.0.0.1 Airtest/Poco bridgeへ接続する。Lakdaはbridgeやdevice serviceを起動しない。

```powershell
lakda explore run --charter examples/exploration-charter.playwright.json
lakda explore report --session .lakda/explorations/<session-id> --out .lakda/reports/exploration.json
lakda explore pause --session .lakda/explorations/<session-id>
lakda explore resume --session .lakda/explorations/<session-id>
lakda explore kill --session .lakda/explorations/<session-id>
lakda explore bookmark --session .lakda/explorations/<session-id>
lakda explore fork --session .lakda/explorations/<session-id>
lakda explore acceptance --index <exploration-acceptance-index-v1.json> --trust-store <operator-trust-store.json>
```

Airtest/Pocoの参照bridgeは、Python 3.10+を運用想定とするoperator管理venvへ依存を導入し、承認済み画像corpusを用意した端末接続済み環境で起動する。このPython／Airtest組合せは現在のローカルGateでは実行できておらず、実機Acceptance Recordでversionと動作結果を固定する。`--allowed-staging-root`はLakdaのrun artifact staging配下に限定し、外部processの自動起動やredirectは行わない。

```powershell
python -m pip install -r tools/airtest-poco-bridge/requirements.txt
python tools/airtest-poco-bridge/server.py --platform android --port 8765 --target-revision approved-app-build --app-id com.example.approved --app-revision approved-app-build --device-uri Android:/// --templates .lakda/operator/airtest-templates.json --templates-root .lakda/operator/templates --allowed-staging-root .lakda/runs
```

同梱の`examples/airtest-templates.json`はformat確認用の非実行サンプルであり、`operatorReplacementRequired=true`のままbridgeへ渡すと起動を拒否する。承認済み画像を`--templates-root`配下へ配置し、manifest内の相対path、Pocoの`operatorApproved=true`、`mutationKind=none`をoperatorが明示する。完全なtransitive lockは同梱せず、`requirements.top-level-attestation.txt`は直接依存2件のsource attestationとしてのみ扱う。

通常探索はcapture capabilityに応じてAndroid videoまたはWindows／iOSの`sampled-frames/v1`を開始し、finding／non-passだけを保持する。passかつfindingなしのcaptureは削除する。`regression-replay`と実LLM `full`は既存方針どおりvideo／連続frameを強制offする。pause／kill／bookmarkはcontrol request queueへatomic投入し、runnerがaction境界で受理したイベントだけをsessionへ反映する。resumeはcheckpointのaction timestamp、trace/replay-trace SHA-256、post-fingerprint、capabilityを再検証し、暗黙forkは行わない。session HATEはCharter、capability、events、checkpoint、findings、report、参照run manifestの実bytesを再照合する。五lane acceptance indexが揃うまで個別reportは`pending_external`であり、fixture／emulator成功で代替しない。

real Charterでは署名済み`lakda/exploration-target-manifest/v1`、operator trust store、template corpus実bytes digest、bridge/capability bindingをtarget接続より前に検証する。Web revision probeまたはnative bridge報告revision・app／device digestの差分はexit 2で停止する。ただしreference bridgeのnative identity値はCLIで与えたoperator宣言であり、実機APIからの独立観測ではない。実機側の取得記録とmanual-bbを別証跡として残す。binary captureはtarget manifestの`artifactAttestorKeyIds`で許可した外部`lakda/binary-artifact-attestation/v1`のsource/output bytes、scan、tool policy、署名を検証してからHATEへ渡す。reference bridgeはattestationを生成しないため、外部scanner／attestorがfinalization前に署名済み記録を供給できないreal binary runはfail-closedとし、fixture成功で代替しない。

nativeの独立観測を使う実行経路は`lakda/exploration-target-manifest/v2`で指定する。署名済みprovider／build mapping／device digestへ実観測を照合し、初回とresumeの操作をsession journalへ保存する。paused resumeは過去journalのcompleteを接続前に要求し、新しい観測を取得してからreplayする。相対`trustStorePath`は元`targetManifestPath`の親directoryを基準に解決する。CLIのJSON reportは同じoperator pathを使い、HTML reportはreport設定に明示したtrustを使う。

現段階のnative v2 CLIは`capture.video="off"`かつ`capture.sampledFrames.enabled=false`を対象とする。連続撮影を含む設定は未対応理由を返して接続前に停止し、自動で設定を変えない。単発のfinding／non-pass画像は引き続き検証対象である。連続撮影とSDK接続世代の統合、Windows／iOS provider、実機受入は残る。詳細は[native仕様](docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)を参照する。

新しいrequest／response v2の受渡しは、real Charterの`capture`へ次の設定を追加する。これは追加fieldの形を示す例で、policyDigestのplaceholderは実際の検査policyのSHA-256へ置き換える。既存Charterへ追加した場合は、そのCharter digestに対するtarget manifestの署名を更新し、許可attestor keyとtrust storeを揃える。

```json
{
  "binaryAttestation": {
    "stagingRoot": ".lakda/private-attestations",
    "policyDigest": "sha256:<検査policyの実際の64桁hex>",
    "timeoutMs": 30000
  }
}
```

stagingRootは実行時の作業directory基準で解決し、operatorが事前に作成する。run／sessionの公開保存root内や過去HATEの内側へ置かない。Lakdaはpreflightでrun専用`lakda-attestation-*` directoryを確保し、capture停止後に`sources/<sourcePath>`と`attestations/requests/<requestId>.json`を用意する。

検査入力用の`sources/`とは別に、元の媒体fileを`originals/<requestId>/<sourcePath>`へ移管して保持する。`originals/`はscannerの出力先ではなく、HATEや共有HTMLにも含めない。元媒体、検査入力コピー、scanner出力の保管容量を確保する。使用中や異なるvolume等で移管できなければ`media-preservation-unavailable`で止まり、元媒体と作成済みコピーを残す。元fileを削除するfallbackや原本の自動pruneは行わない。停止・失敗時はrun内の未移動媒体とprivateの両方を確認し、移管途中のrunを完了済みとして再exportしない。現在の正常移管は同じvolumeで検証する。異なるvolumeでのhandoff成功は未受入である。

operator管理のscannerはrequestに対応するsourceを検査する。sanitizedの場合は`outputs/<request.outputPath>`へ出力を確定し、requestとpolicyに対応する署名済みv2 responseを`attestations/responses/<requestId>.json`へatomicに配置する。request／responseはcanonical JSON＋LFのUTF-8、各64 KiB以下。共通期限は既定30秒、設定範囲1〜300秒である。Lakdaはscannerを起動しない。形式と署名対象は[SPEC-02](docs/spec/verification-reports/SPEC-02-NATIVE-EVIDENCE.md)を参照する。

受領工程を終えたrunでは`run-metadata.json`の`binaryAttestation`へ要求数・採用数・受領statusを保存する。各要求の最終結果は`attestations/results/<requestId>.json`、受領recordは`attestations/receipts/<requestId>.json`へ保存し、metadataの全要求一覧と照合する。設定なしの旧runは従来のv1契約を維持する。

timeout・検査不合格・採用失敗で媒体が隔離された場合も、全欠落を検証済みresultで説明できれば、outcomeをerrorに保ってHATEを確定する。生成レポートの「根拠・未確認事項」から媒体を保持できなかった理由を確認できる。必須媒体の期待値は解除しない。capture停止未確認、隔離途中の失敗、未記録の必須媒体欠落はHATE未確定のままとし、private sourceと未確定runを復旧・確認用に保持する。期限後の派生bundle、実scanner・実機の受入は継続中である。

媒体の一覧作成前から共通の受渡し期限を数え、64 KiB以下の読書き単位で停止と期限を確認する。元データ・コピー先の再照合も対象とし、途中の停止で既存bytesを消さない。期限後の診断記録確定には、同じtimeoutMsを上限とする別の終了処理を使う。採用期限の延長や遅れた応答の採用には使わない。OSのfile I/Oが停止している間の強制打切りは行わず、そのI/Oが戻った時点で停止を確認する。

履歴やfindingが元画像を参照していても、署名・媒体・適用target条件を確認でき、元path／容量／digestが一意に一致すれば、レポートの詳細からマスク後の画像を開ける。reportのtrust storeを指定し、v2では同じHATEに受領記録を保持する。対応表のない旧IDだけの記録、曖昧な出力、署名や対象を確認できない場合は「対応する証跡を確認できません」と表示する。元画像をレポートへ戻さず、表示profileと機密区分の制限を維持する。

```powershell
npx playwright test tests/exploration.spec.ts --workers=1
npm run acceptance:exploration:fixture
node dist/cli.js explore acceptance --index <exploration-acceptance-index-v1.json> --trust-store <operator-trust-store.json>
```

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
- 通常runのbrowser起動済み`failed` / `partial` / `error`ではtrace、screenshot、連番WebMがあり、WebMはHATE manifestへ`kind=video`で登録される。passed、`regression-replay`、実LLM `full` profile、full fixture acceptanceにはvideo directoryがない。browser未起動のrate_limit/config errorへcaptureを要求しない。
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
