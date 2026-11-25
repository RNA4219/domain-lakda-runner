# 画面・API の実行カバレッジ

## 要件と範囲

製品に依存しない `lakda/surface-catalog/v1` を分母にする。製品、対象版、環境、カタログ版、画面、API、画面→API の関係、利用頻度を所有者が登録する。ソース抽出と本番監視からの自動収集は対象外。既存の振る舞い被覆、合否、図の上限は変更しない。

所有者は `publication.screens` と `publication.apis` に公開を許す ID を列挙する。省略は拒否し、空配列は全非公開。関係は両端が許可されたものだけ。これはローカル設定ファイルの所有者による公開許可であり、利用者認証や権限設定の追加ではない。ブラウザー入力で許可範囲を広げる機能は設けない。

## 入力契約

必須キーは `schema, product, version, environment, revision, screens, apis, relations, publication`。画面は `id, name, channel, origin, path, frequency`、API は `id, name, method, origin, path, frequency`、関係は `screen, api`。ID は英数字・ハイフン・アンダースコア。frequency は有限の非負数。origin は HTTP(S) の origin のみ。path は `/users/{id}` のような正規化済みテンプレートで、クエリ、fragment、percent escape、空 segment、`.`、`..`、任意正規表現を認めない。所有者は静的 segment に秘密値を登録しない。

同一 origin と method で一致するテンプレートが複数ある場合は曖昧として到達を付けない。画面も同様。未知 URL は保存・出力しない。本文、ヘッダー、cookie、クエリ値、パス変数の値を観測記録に保存しない。カタログの出力には正規化済みの場所だけを使う。

## 実行観測

Playwright の BrowserContext の request と response、およびページの main-frame navigation を観測する。URL の文字列がテストコードに存在するだけでは到達にしない。SPA の History API による main-frame navigation も対象。iframe と worker の API 呼び出しは API 単体を記録できるが、親画面の関係を推測しない。request 発生時の main frame が一意に既知画面に対応するときだけその関係を記録する。過去に訪れた全画面との直積は作らない。

API の resource type は fetch/xhr に限定せず、登録した method と場所に一致する通信を対象にする。API 自体への document navigation は API 単体の到達であり、遷移前に表示していた画面の関係を引き継がない。

実行設定は `catalog, testId, testRevision, lane`。lane は `mock | real | unknown`、既定 unknown。real は operator の実サーバー宣言、response の serverAddr、同じ URL・method・開始時刻に一意に対応するページ CDP の responseReceived と非キャッシュの観測が揃い、Service Worker 応答・Worker 所有 request でない場合だけ。serverAddr はキャッシュでも過去の接続先を返し得るため単独では使わない。CDP は読み取り専用で、cache・routing・Worker の設定を変更しない。Playwright と独立した CDP セッションの通知順に依存しないよう、対応する応答通知を最大250ms待つ。期限内に照合できなければ unknown。CDP 記録には既知の場所の照合用 digest と時刻・cache flag のみを一時保持し、保存しない。照合不能、同時通信の曖昧さ、CDP 非対応は unknown。mock 宣言は実 transport があっても mock。Playwright fulfill、Service Worker、失敗リクエストなど分類できない呼び出しは unknown。real は本番接続や target authenticity、外部受入の証明ではない。

Service Worker は無効化しない。Worker 内完結のページ側応答は unknown。透過 fetch ではページ側と Worker 側の両方にイベントが出るため、API 集計と観測記録は ID・lane の集合で一度だけ数える。現在の実装では Worker 所有通信に独立した cache provenance を照合できないため、実際に upstream を呼ぶ構成でも unknown とする。frame のない Worker request を親画面へ結び付けず、ページ側の関係も unknown のまま。対応を確実に観測できない browser/worker 構成は unknown または unmeasured とし、イベントの不在を実通信の不存在とはみなさない。[Playwright のイベント所有者の説明](https://playwright.dev/docs/service-workers#network-events-and-routing)

`surface-observations.json` は run ID、attempt、製品・対象版・環境、公開分母の digest、test ID・版、観測完了状態、公開 ID・lane の組だけを保存する。同一組を重複除去し上限を設け、超過・終了失敗・保留応答があれば incomplete。安全な記録は既存の artifact scan、容量判定、HATE digest を通る。カタログ原本、非公開 ID、元 URL を run にコピーしない。

## 集計と証跡

`lakda coverage surfaces --config catalog.json [--input index.json --runs-dir runs] --format json|html [--out new-file]`。index は既存 E2E case index。console は suite の `surfaceCatalog` を使い `/surfaces?suite=...&attempt=N` に同じ回を表示する。最新回の欠落を過去の成功で補わない。複数ケースの観測を同じ index 内で合算し、別回、別版、別環境、改変された manifest は混ぜない。

到達状態は `observed`（選択 lane の実行観測あり）、`not_observed`（全対象テストの観測が完了しているが該当なし）、`unmeasured`（旧結果・未実行・観測欠落・incomplete を含む）。観測ありは失敗・中断テストでも到達であり、合格とは独立。合否は証跡の test outcome として併記する。観測なしは製品機能が存在しない意味ではない。空分母の比率は null。

証跡の drill-down は同じ run・attempt・test・版・lane、観測ファイルと manifest の SHA-256、および `surface-observations.json#種別/ID/lane` の論理的な位置を表示する。非公開情報を含み得る動画・trace・一般ケースページへリンクしない。元の配列位置は非公開要素の数を推測できるため出力しない。所有者が許可を狭めた後は入力時と現在の許可の積集合だけを出す。新しく許可した要素について過去記録の不在を「観測なし」に昇格しない。構造の変更は revision を更新し、要素の定義 digest 不一致は unmeasured。

一覧は画面/API/関係を切り替え、channel、lane、未到達、検索、frequency 降順で絞り込み、50件ずつ表示。図は一覧で選択した1要素の近傍を最大40箱・80線で表示し、省略数を明記する。全件を巨大な図に描かない。数百画面・千 API を取り込んでも一覧と部分図を利用できる。

## 公開境界と互換

保存前と集計前に所有者の公開許可で射影し、一覧・図・証跡・総数・JSON/HTML export の全てに同じ射影を使う。非公開の名前、ID、数、channel、頻度、関係、URL をブラウザーへ送らない。診断は固定文言にし、入力値をエラーへ含めない。

いずれかの suite に `surfaceCatalog` を登録したコンソールは公開範囲を守る実行画面を使う。`/api/suites` と実行状況はテスト本文・合否の件数・一般証跡へのリンクを返さない。`/v/*`、既存の `/coverage` と `/architecture`、その他の経路はサーバー側で 404 にし、混在 suite からの迂回も許さない。`/surfaces` と `/api/surfaces` は同じ射影済み report だけを出す。既存の一般 artifact は所有者のローカル保存領域に保持するが、このモードで配信しない。カタログを登録しないコンソールの既存動作は変えない。既に発行済み・ダウンロード済みの静的ファイルの回収は対象外。

CLI の run/replay で `--surface-catalog` を指定したときも標準出力は run ID・attempt・outcome・exitCode に限定し、一般レポートを自動発行しない。明示的な `--report html` は実行前に拒否し、公開用には `coverage surfaces` を使う。プラットフォーム replay の標準出力も同様。所有者のローカル run 保存は従来の診断 artifact policy を保持し、画面/API の観測には通信内容を追加保存しない。

旧結果の観測は unmeasured。既存 Lakda の `executionMode=real` を API の real 観測に流用しない。観測ファイルのない結果から URL 照合や合否による推測をしない。manifest に登録されたはずのファイルの欠落・改変は照合エラー。観測なしの旧形式は正常に表示する。

検証項目は [CHECKLIST-10](CHECKLIST-10-RUNTIME-SURFACE-COVERAGE.md)。
