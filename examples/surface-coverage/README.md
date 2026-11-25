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
