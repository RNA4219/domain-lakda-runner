---
document_id: LAKDA-ATTESTATION-MEDIA-LINKS-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 検査済み画像と履歴・findingの対応付けのローカル検証

[Task 67](../../tasks/TASK.20260910-67.md)の媒体受渡しと[SPEC-01の参照解決](SPEC-01-REPORTING.md)を接続した。検証対象はHEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`とdirty差分。固定commitのrelease受入ではなく、Task全体はin_progressである。

## 実装と確認した範囲

- 媒体の署名・実bytes・適用target条件を確認してから、検証済みsource→sanitized output対応を参照索引へ渡す。v2は既存request／receipt／run／session／policy bindingを維持し、旧v1をv2証明へ昇格しない。
- 元path・容量・digestが同じsource内で一致する既存媒体IDへ解決する。元画像を公開directoryへ戻さず、追加filesystem走査や別runからの推測を行わない。
- 既知の元pathに誤った容量・digestが付いていれば入力不整合とする。未検証署名・trust欠落・key拒否では対応を使わず、未知参照や複数の一致候補は未解決として扱う。
- 参照元の高い機密区分を出力へ伝える。複数候補でも全候補へ伝え、restrictedのリンクとbytesを表示しない。confidentialは区分を保持し、text-onlyは項目との対応を保持したまま媒体を除外する。
- IDだけの履歴は同じsourceの検証済み完全参照から対応付ける。IDの命名規則や未署名の採用metadataから補完しない。
- v1／v2のsession findingと明示参照event、v2で束縛した子runのoracle履歴とbookmarkから、同じ検査済み画像へ辿れる。生成bundleの双方向参照、元HATE manifest不変、元画像不在を確認した。
- 実browserのfile表示でfinding詳細・run履歴選択後の画像decodeを確認し、HTTP(S) requestは0件だった。画像・署名・targetは人工fixtureであり、実scannerや実機へは接続していない。

## 試験結果

| 検証 | 実結果 | 範囲 |
|---|---|---|
| 関連5 test file | 30 tests pass、exit 0 | replacements 6、media-target 10、media-links 9、signed-media 3、proof 2 |
| npm run typecheck | exit 0 | 追加moduleと人工fixtureの型契約 |
| npm run check | 439 tests pass、exit 0 | docs・型・ESLint・build・全体回帰。test実行2.5分 |
| npm run pack:check | 521 files／55 schemas、exit 0 | offline cache、配布内容、隔離install、report CLI、署名付き・項目対応付き媒体 |

Windows、Node 24.11.0／npm 11.6.1で実施した。宣言runtimeのNode 24.6.0／npm 11.5.1によるrelease受入とは区別する。既存のHATE／QEGの責務とoutcomeを変更していない。

## 先行失敗とセルフレビュー

最初の生成testでは署名済み画像がrun単位のままで、findingへ関連付かなかった。参照索引の先行5件も対応未実装により失敗した。実装後は全30件がpassした。

追加レビューでは、HATEで許容されるdigestのprefixなし・大文字表記を新しいoutput照合が誤って拒否する点を検出し、境界で表記を正規化した。別の統合試験は人工fixtureのrun登録event不足でsession bindingに拒否されていたため、既存契約に沿ってeventとmanifest参照を揃えた。検証規則は緩めていない。いずれの先行logも下表に保持した。[SR-41／42](SELF-REVIEW-20260910.md)へ判断を記録した。

## 再実行

```powershell
npx playwright test tests/report-media-replacements.spec.ts tests/report-media-target.spec.ts tests/report-media-links.spec.ts tests/report-signed-media.spec.ts tests/report-proof.spec.ts --workers=1
npm run check
$env:npm_config_cache = (Resolve-Path -LiteralPath '.lakda/npm-cache-offline').Path
$env:npm_config_offline = 'true'
npm run pack:check
```

## 残る工程

大型媒体I/O中の停止・期限、既消費pause時と隔離途中の終了、期限後の派生bundleはTask 67で継続する。Task 68のnative identity、Task 69の固定SHA・manual・実機・外部Gate、容量等の未完了受入条件も維持する。今回のローカル成功で全7件の改修やAC全体を完了にはしない。

## sourceとlogのSHA-256

下表の16件は今回の対象source・仕様・先行失敗・最終logを識別する。先行検証文書のdigestは履歴として変更しない。

| path | bytes | SHA-256 |
|---|---:|---|
| `src/reporting/media-replacements.ts` | 2221 | `a6753a4155e63e5c59d221c9f7f273a70efc90836fbd2d739b171c9f4ba62e77` |
| `src/reporting/evidence-index.ts` | 4877 | `14fd2241e9e92e353d88c104ec7ffcb933f21391533e2b62756360af8a0f5ceb` |
| `src/reporting/media-proof.ts` | 7697 | `1fde5ca160d642e7d100bc6b3fe7c01e2fee257b8a0cfbe66a4f17af5159a65a` |
| `src/reporting/evidence-links.ts` | 4674 | `a644d41a59fbbe6a20b622b5d45202d1340dfb25e8620b6ee6d6c3cd297e8404` |
| `src/reporting/generation.ts` | 7151 | `1772ccbabd681204d1337c3998e6eb851193dc53a021827973f7de01da37d95b` |
| `tests/report-media-replacements.spec.ts` | 5010 | `74bac96e40cbf1239417aa8eedb15a5f8d17df3bc27d6723a79f0dbf555850e6` |
| `tests/report-media-target.spec.ts` | 31268 | `b0c0498e7962504eeeace7fa709dab893a04aae11ba5072bd2484be94458fbd4` |
| `docs/spec/verification-reports/SPEC-01-REPORTING.md` | 31393 | `27ba8848fc063206885e450a26ccc83318aab3ec2bf740a6a2570e414faaeda3` |
| `.lakda/attestation-media-links-red.log` | 2488 | `7f9bb1a7aa2f09cc0433e19cbe96c9c090796daa4257b45883e0f08987c62da5` |
| `.lakda/media-replacements-unit-red.log` | 7802 | `d8c4ecff449fb57d6d9860f6e169f6d92f09f3f2d4b464abd72c612eb348a59a` |
| `.lakda/media-replacements-run-integration.log` | 4377 | `2a1793f2696f59760f39586a30095c6786d91ba351106b510844937d81a2eeb7` |
| `.lakda/media-replacements-digest-red.log` | 2188 | `78b039c1d9214fc2abd3e960963041f8e568af81f9d58c3dbedbf8ceaf155971` |
| `.lakda/media-replacements-related-final.log` | 4641 | `22807eaa90fa7061c4f1464faf6fc39449e3eda7bcdb6353b8d03b899646b82a` |
| `.lakda/media-replacements-types-final.log` | 81 | `a7146661d36faf27db56ff0b856ed4fcbfaf38f4b68159e20bb87749b594de5a` |
| `.lakda/media-replacements-check-final.log` | 73780 | `a60986fdc021760b13da3e7b8424ad2a66d8cf809afe8e8ca2b21a17ab832228` |
| `.lakda/media-replacements-pack-final.log` | 4477 | `2134c3dd8146bee652b70e66ab3e553dc933d6a6d62c63b57b1e9e1f370d1b84` |
