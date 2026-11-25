# ローカル E2E プラットフォームの導入

## まず1件試す

Git、Node.js 24.6.0、npm 11.5.1、FFmpeg（libx264）と ffprobe を用意します。ターミナルで `ffmpeg -version` と `ffprobe -version` が通ることを確認してください。Lakda のリポジトリで次を実行します。

```sh
npm ci
npm run platform:setup
npm run platform
```

端末に表示された URL を開くと、配送案内の受入条件を確認できます。「第1回を開始」で Chromium が同梱のページを開き、質問を押して回答の表示を確かめます。合格後に「ケースの結果・操作ログ」を開くと、その回の記録に移れます。サンプルには manual-bb のエクスポートを同梱しています。

録画を見るときは、操作ログの画面で「元の動画の保存場所」を開き、「このPCから動画を選ぶ」で表示された MP4 を指定します。選んだ動画がこの回の記録と一致すると、画面内で再生できます。

Ctrl+C で終了します。もう一度 `npm run platform` を実行すると、同じ版の履歴を開けます。サンプルの記録は Lakda の `.lakda/platform-demo/<コミット>/` に保存します。

「システム構成図」では、見本の箱や接続線を選んで理由・出典・指摘を読めます。自分の構成は「構成ファイルを開く」で読み込みます。コンソール自身の構成図は `/architecture?system=lakda` から直接開けます。

## 自分の製品で第1回を始める

1. **設定を作る。** 以下は製品を Lakda と同じ親ディレクトリの `my-product` にチェックアウトした例です。Lakda のルートで実行してください。既存の設定は上書きしません。

   ```sh
   npm run platform -- --init ../my-product/platform.json
   ```

2. **テスト対象を登録する。** 作成した設定で製品名と、配信するビルド、版の照合記録の場所を指定します。配信対象は `index.html` と同じディレクトリの HTML・CSS・JS です。`baseUrl` はケースのレビュー時に決めた `http://127.0.0.1:<ポート>/` に合わせます。

   | 設定 | 指定するもの |
   | --- | --- |
   | `target.directory` | 製品の配信ファイルがあるディレクトリ |
   | `architecture`（任意） | 「システム構成図」で最初に開く `aym.architecture/v1` の JSON・YAML。設定ファイルからの相対パスを指定します |
   | `target.binding` | 製品のビルド記録。対象の製品 ID、コミット、環境 ID、ビルドの SHA-256 を持つ `qeg-build/v1` ファイル |
   | `target.observation` | 同じ版・環境で、配信した各ファイルとディスク上の各ファイルの SHA-256 を記録した JSON |
   | `suites[].checkout` | 上記コミットを指す製品の Git チェックアウト |
   | `suites[].scenarios` | チェックアウト配下にある manual-bb のエクスポート先。ここだけは `checkout` からの相対パス |
   | `suites[].featureSpec`、`suites[].manualCaseSet` | エクスポートに使った仕様とケース集。ケース名と受入条件を画面に表示するために使います |
   | `store` | 製品の実行履歴・録画・表示用 HTML の保存先。対象版や登録ケースを切り替える際は新しい保存先を指定します |

   ほかの相対パスは設定ファイルがあるディレクトリを基準にします。録画ツールを PATH に追加できない場合は、設定の最上位に `ffmpeg`、`ffprobe` の絶対パスを指定できます。

3. **レビューしたケースを用意する。** エクスポート済みならそのディレクトリを指定します。新規の場合は製品側で承認した binding とその SHA-256 を使い、製品のルートで次を実行します。

   ```sh
   bb-harness export-e2e --feature-spec qa/feature.json --manual-case-set qa/cases.json --binding qa/case-binding.json --approved-binding-sha256 <承認記録のSHA-256> --out qa/exports
   ```

   ケース設計の例は [feature.json](feature.json)、[cases.json](cases.json)、[binding.json](binding.json) にあります。ひな形の `target.binding` は配信ビルドの記録です。上の `--binding` は操作と期待値の対応を記録します。

4. **コンソールを開く。** Lakda のルートから起動し、表示された URL で対象製品・版・受入条件を確認して開始します。初回は第1回の予定から始まり、実行後は製品概要に結果が表示されます。

   ```sh
   npm run platform -- --config ../my-product/platform.json
   ```

### 配信ビルドの記録形式

製品で記録した値を使います。以下は上記のひな形が読み込むキーです。

```json
{
  "bindingVersion": "qeg-build/v1",
  "target": {
    "projectId": "my-product",
    "revision": "<製品の40桁のGitコミット>",
    "environmentId": "local-qa",
    "buildId": "sha256:<ファイル一覧のSHA-256>"
  }
}
```

```json
{
  "productId": "my-product",
  "revision": "<同じGitコミット>",
  "environment": "local-qa",
  "files": {
    "index.html": {
      "servedSha256": "<配信されたバイト列のSHA-256>",
      "diskSha256": "<配信元ファイルのSHA-256>"
    }
  }
}
```

`files` には配信する全ファイルを列挙します。ファイル名順に「名前・半角空白・64桁の小文字 SHA-256・LF」を連結した UTF-8 文字列の SHA-256 が `buildId` の値です。起動時に両方の記録と実ファイルを照合します。[ローカル実行画面の仕様](../../docs/spec/e2e-platform/SPEC-08-LOCAL-EXECUTION-UI.md)を参照してください。

### 起動時に困ったとき

製品概要の「検証範囲を見る」から、スイートの最新回で確認できた振る舞いを開けます。実行結果の「この回の検証範囲」は選んだ回を表示します。製品を登録するときは、設定の `suites` の各項目に `"coverageMap": "対象製品のマップ.json"` を指定してください。製品 ID・対象コミット・環境が一致するマップを使用します。[マップの記入方法](../../docs/spec/e2e-platform/SPEC-09-DOMAIN-COVERAGE.md)

| 症状 | 確認すること |
| --- | --- |
| Chromium またはビルドが見つからない | Lakda のルートで `npm ci`、`npm run platform:setup` を実行する |
| ffmpeg または ffprobe が見つからない | 両方を含む FFmpeg の bin を PATH に追加して端末を開き直す |
| 画面ポートが使用中 | `npm run platform -- --port 18873` で画面のポートを変更する。製品用のポートはレビュー済みの URL で固定される |
| チェックアウトや配信ファイルの版が一致しない | 製品の `git rev-parse HEAD`、配信記録、登録したケースの版を確認する |
