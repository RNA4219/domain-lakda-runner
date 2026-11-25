# 実行カバレッジ受け入れ条件

- [x] AC-S01: 版付き画面/API/関係を検証し、重複・参照切れ・不正な場所・未知キーを拒否する。
- [x] AC-S02: コード記載とテスト合格だけでは到達せず、旧結果は unmeasured。
- [x] AC-S03: 実ブラウザーの遷移と通信で到達し、失敗テストの到達と合否を分ける。
- [x] AC-S04: mock/real/unknown を分離し、fulfill・Service Worker・応答欠落を実扱いしない。
- [x] AC-S05: 同じ回・テスト・版・環境・manifest digest・観測位置へ追跡できる。欠落・改変・異なる回を拒否する。
- [x] AC-S06: 複数画面/API の関係を時点と frame で結び、無関係な組を生成しない。
- [x] AC-S07: query、body、認証情報、動的パス値、未知 URL が観測・JSON・HTML に残らない。
- [x] AC-S08: 非公開要素が一覧・図・証跡・集計・export・診断から漏れない。後から狭めた許可も有効。
- [x] AC-S09: 数百画面・千 API、頻度順、検索、lane、ページング、部分図と省略表示が動く。
- [x] AC-S10: npm run platform の同じ実行回の画面、CLI JSON/HTML、既存テスト、package を検証する。
- [x] AC-S11: Service Worker を有効のまま、Worker 内完結と upstream fetch を検証する。同一 API の二重計上と Worker の実通信からの親画面紐付けを防ぐ。
- [x] AC-S12: キャッシュが保持する serverAddr を実通信と誤認しない。CDP の非キャッシュ記録が一意に照合できない場合も unknown。

実結果は [ローカル受入記録](../../acceptance/AC-20261125-runtime-surface-coverage.md)。外部製品の受入や QEG verdict ではない。
