---
document_id: LAKDA-REPORT-MEDIA-ACCEPTANCE-20260910
status: local_verified
last_updated: 2026-09-10
specification: SPEC-01-REPORTING.md
---

# レポート媒体のbrowser受入

画像拡大の修正後、`npm run acceptance:reports`で媒体40ケースと最大件数の表示16条件がpassした。[SPEC-01](SPEC-01-REPORTING.md)と[MEDIA-01〜06／詳細画面操作](../../proposals/20260910-report-detail.md)のlocal補助証跡である。実targetを操作した記録や固定SHAのrelease承認ではない。

## 対象

- HEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`＋dirty差分。source／schema／script／package等のfile集合digestは`baa85ec15cc24ee566d4e0a50360dcbed6e3abc68543b130c9eca63d52ad9bbe`。file別の値は結果JSONに保持。
- Windows 11 Home `10.0.26200`、AMD Ryzen 5 5500GT、12 logical CPU、memory 68,501,950,464 bytes。
- Node `24.11.0`／npm `11.6.1`。宣言runtimeのNode `24.6.0`／npm `11.5.1`との差は残る。
- Chrome `152.0.7977.83`／Edge `152.0.4191.66`。headless・隔離profile、timezone `Asia/Tokyo`。browser自身のversionと実測zoomを記録。
- 最終実行: `2026-09-10T03:37:01.938Z`〜`2026-09-10T03:40:06.640Z`。

## 入力と確認内容

canvasで人工画像P（320×600）／Q（320×180）と、再生できるVP8 WebMを作成した。camera、microphone、実アプリ、実targetは使っていない。HATE manifestと保存sessionから通常のreport生成処理へ渡し、生成後とdirectory移動後にbundle verifyを行った。

| ケース | 確認内容 |
|---|---|
| image-links | finding AのP、run全体のP／Q、履歴#2からのP選択と解除。Space／Enter、filter・並び順・2ページ目の保持、行と履歴へのfocus復帰。実表示幅の拡大、画像枠内の矢印キー移動、縮小後のfit・scroll先頭・button focus |
| unavailable-links | finding所属のprimary runには参照がなく、別runにだけ一致候補が1件ある場合の拒否。別のcaseで2つの所属runに同じ参照候補がある場合の拒否。媒体欄の対応未確認理由 |
| shared-exclusion | localで未検査表示したPをshareで除外。finding／履歴から除外理由を確認でき、img／video／保存linkを作らないこと。解除時のfocus |
| video-controls | controls・preload none・自動再生なし。明示的に0.2秒へseekした状態で履歴を選び、時刻を変えないこと。Spaceで再生し、画像への切替で停止、同じvideo要素・時刻を保持して再表示。Escape後500ms以内のpausedとended=false、再open時の初期状態 |
| media-formats | sampled-frame #2／#7の順、実PNG decode、壊れたPNG／WebMの理由表示と保存link、trace ZIPの手順表示、横overflowなし |

動画のseek開始状態はbrowser APIの`currentTime=0.2`で作り、その後の履歴選択や表示切替の挙動を検査した。再生は実際のSpace入力で行った。native controlsの全操作部をpointerで操作する手動受入や、実機の再生互換性を証明したものではない。traceは人工の空ZIPで、既存trace viewer自体の受入ではない。

各bundleは意図した未取得coverage／対応未確認を残し、生成状態`degraded`を維持した。HATEの人工scan fieldやbrowser操作の合格から署名済み媒体へ昇格しない。

| bundle | files | manifest SHA-256 |
|---|---:|---|
| images | 9 | `e9814e740562c5252db81519b20e7f201fdffe6fa1a296547ce7994a8f22df4c` |
| shared | 5 | `4aebb81265f6c4269a56aad4ca155df2251a0a40ba8421bd283e925acc18f4c2` |
| video | 7 | `4a555755e87026af45e30e6cb8ab60010b2f149cf987e5f7b34d19aa07377f1c` |
| formats | 10 | `76e7478891856666934474c8b60ac262a7c5ca4f4bc2330280eb4b511584b398` |

## browser結果

以下の8条件それぞれで上記5ケースがpassし、合計40ケースとなる。レポートからの外部HTTP request／page errorは0件。200%時はdevicePixelRatio 2・visualViewport.scale 1で、layout幅が683／195になることも確認した。

| browser | viewport | zoom | 結果 |
|---|---|---|---|
| Chrome | 1366×768 | 100%／200% | 各5ケースpass |
| Chrome | 390×844 | 100%／200% | 各5ケースpass |
| Edge | 1366×768 | 100%／200% | 各5ケースpass |
| Edge | 390×844 | 100%／200% | 各5ケースpass |

surface capture 72枚を保存した。選択見出し・解除button・focus、画像の原寸スクロール、動画の表示位置を確認できる。Edge 390px・200%の`media/msedge-390-2/expanded-picture.png`を目視した。SHA-256は`485a4f3fe48897bb290c1b6fe4bf18d4a03c4cf4d578f0c237c7d1baa53cadc2`。スクロール枠内で画像を確認でき、dialog自体は横にはみ出さない。

## 検出した問題と検証の修正

- 狭幅では拡大前後とも画像幅55pxで、class変更だけの旧検査が実寸の不変を見逃していた。原寸以上の画像とscroll可能なregionへ変更し、横／縦キー操作・縮小時の復帰を回帰testへ追加した。
- 対応未確認理由は履歴と媒体欄に存在するため、検査locatorを媒体欄へ限定した。
- native dialogのclose eventが処理される前の瞬間を停止失敗としないよう、非表示完了後のpaused／endedを検査した。再生の自然終了ではpassしない。
- 最初の未所属caseは候補を2 runに持っていた。最終corpusでは所属primaryに参照がなく、別runだけに一意な候補がある条件へ変更し、単に複数候補だから拒否された場合と区別した。

途中結果は`.lakda/report-media-trial-60FM3b/`、`.lakda/report-media-trial-8SMgiE/`、`.lakda/report-acceptance-l2PzD1/`へ残した。最終受入は下記の別実行であり、古い成功から新しい条件の合格を推定していない。

## 最終検証と残り

- `npm run check`: docs／型／lint／build、358 testsがpass（2.2分）。log `.lakda/report-media-acceptance-check.log`、SHA-256 `796b7a2b84d78106ab6f841ab57a943bdeed2ca7f4a8a2a0b0da77ae1b35708a`。
- 最後のcorpus条件の補強後、受入helperの3テストとESLintを再実行しpass。runtime sourceはこの補強では変更していない。
- 最終`npm run acceptance:reports`: exit 0。log `.lakda/report-media-acceptance-final.log`、SHA-256 `31f7df80d09cfd7b15ce3ceb66dd777177afc230f4c8f2a081765ed9d447c6d0`。
- offline `npm run pack:check`: exit 0、466 files・50 schemas。隔離installで通常／batch／未確定run／署名済み媒体／媒体対応の生成・検証を確認。log `.lakda/report-media-acceptance-pack-check.log`、SHA-256 `b5f4d659fccc62be59e57f13b6dbbc5744a78d68f7d97052919a66aaba09bf97`。

最大件数の均等／集中corpusも同じ最終commandで再測定した。生成の全10回は3,664.1〜3,883.3ms、初期80 sampleの最大359.4ms、filterの各100 sampleのp95最大33.5msで、元の目標を維持した。全sampleは結果JSONに残した。[前回の性能記録](PERFORMANCE-20260910.md)は当時の結果として保持する。

最終結果は`.lakda/report-acceptance-BAIxYA/result.json`、SHA-256 `de1546686de3844dc6d985a7ee2e18945169da5130e89b20b3e0e9b876a60a4c`。`media/images-moved/index.html`等が閲覧用bundleである。logは再実行で更新され得るlocal補助記録であり、容量の全境界、指定runtime／fixed SHAでのrelease受入、実環境・manual-bb・外部QEGは未完了のままである。
