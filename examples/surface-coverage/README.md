# 実行中の画面・API 到達を確認する

[catalog.json](catalog.json) は会社・製品に依存しない架空の例。利用頻度は入力値であり、自動収集しない。所有者が対象製品 ID、commit SHA、環境、origin、画面・API と関係、公開 ID を登録する。静的 segment に顧客 ID や秘密値を置かず、変数は `{id}` にする。

まず `npm ci`、`npm run platform:setup`。登録したローカルコンソール設定の対象 suite に `surfaceCatalog`（設定ファイルからの相対パス）と `surfaceLane`（mock / real / unknown、既定 unknown）を加え、`npm run platform -- --config <config.json>` で開く。

カタログを登録したコンソールは画面・API の実行画面になる。実行前に対象 suite を選び、同じ実行回の一覧と部分図を開く。観測なしの旧結果は未計測。動画・trace・一般ケース詳細と既存構成図は非公開情報を含み得るため、このモードでは URL を直接指定しても配信しない。カタログを登録しないコンソールの従来動作は維持する。

CLI は登録済みの承認された非本番対象で使う。`--execution-mode real` は既存の実行宣言であり、API の分類ではない。API の real は `--surface-lane real` の宣言と実 transport の観測が揃う場合だけ。

```powershell
node dist/cli.js replay --config lakda.config.json --input actions.json --base-url http://127.0.0.1:18943/ --surface-catalog catalog.json --test-id TC-1 --test-revision case-1 --surface-lane mock --report off
node dist/cli.js coverage surfaces --config catalog.json --format html --out design.html
node dist/cli.js coverage surfaces --config catalog.json --input index.json --runs-dir runs --format html --out coverage.html
node dist/cli.js coverage surfaces --config catalog.json --input index.json --runs-dir runs --format json --out coverage.json
```

index は同じ回の `lakda/e2e-case-index/v1`。`--runs-dir` は index の各 `runRef` の親ディレクトリ。新しいファイルだけに出力し、既存ファイルを上書きしない。プラットフォーム用 replay でも `scripts/e2e-platform-replay.mjs` に `--surface-catalog` と `--surface-lane` を渡せる。CI での分母・テスト ID・版は呼び出し側が固定する。

カタログを指定した run/replay は一般レポートを自動発行せず、標準出力も実行 ID と状態だけに限定する。公開に使う JSON/HTML は `coverage surfaces` で発行する。明示的な `--report html` は実行前に拒否する。

証跡の source は `surface-observations.json#種別/ID/lane` という論理的な位置。公開範囲を狭めても、非公開になった要素の配列位置や総数を公開しない。run ID、attempt、テスト ID・版、観測 SHA-256 と manifest SHA-256 で同じ記録を照合できる。出力済みのファイルや既にダウンロードされたファイルを後から回収する機能はなく、再発行時に現在の公開許可を適用する。

仕様は [SPEC-10](../../docs/spec/e2e-platform/SPEC-10-RUNTIME-SURFACE-COVERAGE.md)。

## 遅れて呼ばれるAPIとSPA

`navigate` 自体はDOMContentLoadedで終わります。APIの応答後に表示される要素を画面の準備完了条件として登録すると、その画面から次の操作へ進む前に待ちます。

```json
{
  "id": "reset-password",
  "name": "再設定画面",
  "channel": "web",
  "origin": "http://127.0.0.1:18943",
  "path": "/app",
  "hashRoute": "/home/detail/{id}",
  "ready": { "testId": "screen-ready", "timeoutMs": 5000 },
  "frequency": 10
}
```

`hashRoute` と `ready` は任意です。API側のpathにはfragmentを指定しません。同じURL内で差し替わる画面は、各画面に `"state": { "testId": "detail-screen" }` のような表示要素を登録します。複数が同時に表示されたときは曖昧として到達を付けません。DOM状態の到達は分類不能（unknown）で、DOM状態だけからAPIとの関係を推測しません。hash routeは値を保存せず、登録したtemplateのIDだけを記録します。

testIdのない製品では、API応答後に表示されるボタン等を使えます。例えば末尾スラッシュ付き画面をそのまま登録します。

```json
{
  "id": "signin", "name": "ログイン", "channel": "web",
  "origin": "http://127.0.0.1:18943", "path": "/signin/", "frequency": 10,
  "ready": { "role": "button", "name": "ログインする", "timeoutMs": 5000 }
}
```

roleは `button/link/textbox/checkbox/combobox/option/menuitem/tab`、nameは完全一致するaccessible nameです。部分一致や正規表現は使えません。候補が一意かつ表示されるまで待ちます。未表示・複数・不一致のまま期限を過ぎるとincompleteになります。`testId` とrole/nameは同時指定できません。既存のtestId readyとSDK呼出方法はそのまま使えます。CLI replayの各操作後、SDKの `checkpoint()` と `finish(outcome)` が同じ条件を待ちます。finishはcontextを閉じる前に呼んでください。readyの定義や名前は観測・公開レポート・固定診断へ追加出力しません。

`/signin/` と `/signin` は別URLです。実際の正規URLを登録してください。APIのpathとhashRouteも末尾を厳密に区別します。`/` は有効、`//`、`/a//b`、`/a//` は無効です。`/users/{id}/` は空でない1segmentと単一末尾に一致します。定義を変更した旧記録は再実行してください。

state/readyのtestIdは `data-testid` 属性の値です。stateはtestIdだけを受け付けます。画面状態の取得はブラウザー内で行い、初期化中の短い遷移も上限付きの一時バッファで保持します。DOM本文や非公開状態のselector値は観測ファイルへ保存しません。バッファ上限を超えた場合はincompleteとして扱います。
DOM状態とAPIの対応を計測できない関係は「未計測」です。画面とAPIの両方に到達していても、関係を推測して「到達」や「観測なし」へ変更しません。

readyが期限内に満たされなければ観測はincompleteになり、呼ばれなかったAPIは未計測になります。ready未指定時の「観測なし」は、実行期間内で観測しなかったという意味です。後で始まる通信の不存在を示しません。準備完了条件はテストの合否を変更するoracleではありません。

画面IDを `reset-password-screen` へ改名する必要はありません。正当なIDはJSONの標準エスケープを使って保存し、読み込むと元の値に戻ります。汎用redactionと最終bytesのsecret/PII scanは維持します。すでにIDが壊れた旧観測は修復・上書きせず、修正版で再実行してください。

## 対象製品の版と実行元の版

catalog.versionは試験対象製品のcommitです。run metadataのcommitShaとHATE commit_shaはreplayを回した実行元のGit SHAで、別々に照合します。対象製品のcheckoutを置いたり、catalog.versionを0埋めに変えたりする必要はありません。run metadataのsurfaceCoverage.targetは所有者の対象版宣言です。接続先の真正性を独立に検証したという意味ではありません。

## 既存のPlaywright E2Eに付ける

公開packageの `startSurfaceCoverage` は、呼出側のBrowserContextへ観測を付けます。テストをLakdaのreplayへ移す必要はありません。下の例のcatalogでは、既存のAPI差し替えテストを `mock` として記録します。

```js
import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { startSurfaceCoverage, surfaceRunIndex } from "domain-lakda-runner";

test("既存の画面テスト", async ({ context, page }, testInfo) => {
  const coverage = await startSurfaceCoverage(context, {
    catalogPath: "catalog.json",
    outputDir: ".lakda/surface-runs",
    testId: "TC-DETAIL",
    testRevision: "case-1",
    lane: "mock",
    attempt: testInfo.retry + 1
  });
  let outcome = "passed";
  try {
    // 既存のroute/操作/期待結果をそのまま使う。
    await page.goto("http://127.0.0.1:18943/app#/home/detail/example");
    await expect(page.getByTestId("screen-ready")).toBeVisible();
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    const record = await coverage.finish(outcome);
    await writeFile(testInfo.outputPath("surface-index.json"),
      JSON.stringify(surfaceRunIndex([record], { id: "playwright", attempt: 1 })));
  }
});
```

finishはBrowserContextが閉じられる前に呼んでください。`coverage.checkpoint()` で途中の準備状態を明示的に待つこともできます。SDKはブラウザーを閉じず、routing・認証・cache・Service Workerを変更しません。外部テストのoutcomeは呼出側から受け取り、到達と合否を別々に記録します。

出力の専用index（`lakda/surface-run-index/v1`）を `coverage surfaces --input ... --runs-dir .lakda/surface-runs` へ渡すと、同じJSON/HTMLの一覧・部分図で確認できます。複数ケースは、同じ対象版の `record` を `surfaceRunIndex(records)` へまとめます。SDKの保存は外部観測bundleで、replay用のaction-sequenceを生成しません。通常のLakda runとは保存先を分けてください。各bundleは観測・対象宣言・実行元revision・test版・outcome・HATE digestを保持し、最終bytesのscanと再読込で照合します。
