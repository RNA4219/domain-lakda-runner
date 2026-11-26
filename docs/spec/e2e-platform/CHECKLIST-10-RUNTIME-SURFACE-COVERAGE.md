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
- [x] AC-S13: CDP request event と response timing の基準時刻の差があっても、同じ実通信を一意に照合する。応答通知の遅延、cache、Worker の分類を維持する。
- [x] AC-S14: password/api-key/token/cookieと衝突する公開IDを、replayの保存・scan・manifest・CLI再読込を通して保持する。一般の秘密値・PIIのredactionを維持する。
- [x] AC-S15: DOMContentLoaded後に遅延開始するAPIをready条件まで観測する。ready timeout時の不在はunmeasuredとする。
- [x] AC-S16: 対象製品の版が実行元Git SHAと異なる場合も、両方のbindingを独立照合して集計できる。対象版・環境・producer manifestの不一致は拒否する。
- [x] AC-S17: 複数hash routeと同一URL内のDOM状態を区別する。動的値・非公開状態・曖昧状態を公開しない。
- [x] AC-S18: 既存Playwright E2Eに公開SDKを付け、mock/real/unknownとoutcomeを分け、専用indexからJSON/HTMLへ到達を表示する。SDKはbrowserの所有権を奪わない。
- [x] AC-S19: 新しい画面定義とSDKでも公開範囲縮小・digest・上限・一般証跡経路の制限、および旧記録との互換を維持する。

実結果は [ローカル受入記録](../../acceptance/AC-20261125-runtime-surface-coverage.md)。外部製品の受入や QEG verdict ではない。

AC-S14〜19の開発検証は `tests/surface-field-feedback.spec.ts`。通常suiteと区別したlocalhost機能受入は[専用記録](../../acceptance/AC-20261125-surface-field-feedback.md)を参照する。

- [ ] AC-S20: CLIと公開SDKで単一末尾スラッシュ付き画面/APIの到達と実通信の関係を計上する。slashなし、root、中間空segment、二重末尾、テンプレート、hashRouteの厳密な区別、非公開の重なり、旧定義digestを確認する。
- [ ] AC-S21: testIdなし合成製品のrole/name readyで遅延APIを待つ。完全一致、複数候補、未表示、不在、timeoutのincomplete、testId互換、state契約、公開出力/診断の非漏えいを確認する。
- [ ] AC-S22: 指定PCのCLI replayと公開SDKのcheckpoint/finish、専用index、JSON/HTMLを正式manual-bbケース版/対象SHAに結び付ける。全ケースpassとGate go、check、pack、適用GitHub checksおよびマージtreeを確認する。

AC-S20〜22の手順とローカル記録先は[末尾スラッシュ・role ready受入](../../acceptance/AC-20261126-surface-slash-role-ready.md)。チェック欄は実行証跡と別管理し、外部製品の検証を意味しない。
