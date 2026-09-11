---
document_id: LAKDA-REPORT-PERFORMANCE-20260910
status: local_verified
last_updated: 2026-09-10
specification: SPEC-01-REPORTING.md
---

# レポートの最大件数・browser表示測定

本記録は画像拡大の追加修正前の測定である。後続の媒体40ケースと最大件数の再測定は[媒体受入記録](MEDIA-ACCEPTANCE-20260910.md)を参照する。

2026-09-10に`npm run acceptance:reports`を実行し、人工保存入力の2 corpus・16表示条件すべてがpassした。対応要件は[SPEC-01の測定契約](SPEC-01-REPORTING.md)と[AC-UP-019／020](../../proposals/20260910-detailed-checklist.md)。媒体なしの表示受入であり、媒体操作の指定browser受入、容量の全境界、固定SHAでのrelease受入を完了した記録ではない。

## 対象と条件

- HEAD: `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`＋dirty差分。
- 測定開始時のsource／schema／script／package等のfile別digest集合SHA-256: `87d37fdd08b0910affce1d8b41874831f4e76443f2db7c03416c76d238f87851`。個別値は結果JSONの`sourceFiles`に保存。
- Windows 11 Home、build `10.0.26200`、AMD Ryzen 5 5500GT、12 logical CPU、memory 68,501,950,464 bytes。
- Node `24.11.0`、npm `11.6.1`。宣言runtimeのNode `24.6.0`／npm `11.5.1`との差は残る。
- Chrome `152.0.7977.83`、Edge `152.0.4191.66`。各browser自身が返したversion。headless・隔離profile、timezone `Asia/Tokyo`。
- 1366×768／390×844とpage zoom 100%／200%の組合せ。200%ではlayout幅683／195、devicePixelRatio 2、visualViewport.scale 1を全caseで確認。
- 100 run・実行記録10,000件・failure 1,000件。均等配置は各runへ100記録・10 failure、集中配置は最初のrunへ全件を保存。failure messageは各2,048文字。
- テスト対象を実行した記録ではなく、性能検証専用の人工HATE入力。入力内のaction／URLを実行しない。外部HTTP requestとpage errorは全16条件で0件。
- 時刻: `2026-09-10T02:50:41.645Z`〜`2026-09-10T02:53:21.356Z`。測定中は別のbuild／testを実行しなかった。OS cacheは消去していない。保存先はworkspace内のC: volumeで、storage機種の同一性は要件にしていない。

## 生成

値はms。別processのCLI起動から終了までを測り、receipt保存を含む。各回の保存receiptとstdoutの一致、独立verify、最初のbundleの移動後verifyもpassした。

| corpus | 入力bytes | view bytes | 1回目 | 2回目 | 3回目 | 4回目 | 5回目 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 均等配置 | 8,622,446 | 9,444,117 | 3826.2 | 3979.8 | 4383.5 | 4226.0 | 4082.9 |
| 集中配置 | 8,682,826 | 9,503,704 | 4110.3 | 3891.0 | 3899.9 | 3983.2 | 4030.8 |

全10回が10,000ms以下。viewを切り捨てず、100 run・10,000履歴・1,000 failureが残ることを検査した。

## 表示・操作

各条件で5 navigationの初期表示を測り、keywordの100変更を測定した。初期値は5回の最大、filterは全100回のnearest-rank p95。単位はms。80 navigation・1,600 filter sampleを全件保存した。

| browser | 幅 | zoom | 均等: 初期最大 | 均等: filter p95 | 集中: 初期最大 | 集中: filter p95 |
|---|---:|---:|---:|---:|---:|---:|
| Chrome | 1366 | 100% | 369.4 | 32.1 | 295.0 | 32.1 |
| Chrome | 1366 | 200% | 356.8 | 32.1 | 384.2 | 32.1 |
| Chrome | 390 | 100% | 329.2 | 32.1 | 322.0 | 32.1 |
| Chrome | 390 | 200% | 332.3 | 32.1 | 337.7 | 32.2 |
| Edge | 1366 | 100% | 289.2 | 32.1 | 272.1 | 32.1 |
| Edge | 1366 | 200% | 358.8 | 32.2 | 313.8 | 32.1 |
| Edge | 390 | 100% | 296.4 | 32.1 | 326.2 | 32.1 |
| Edge | 390 | 200% | 286.9 | 32.2 | 329.3 | 32.1 |

全条件で初期表示3,000ms以下・filter p95 300ms以下。Tab／Enter／Escape、ラベル、AND filter、0件と全解除、一覧2ページ目の保持とfocus復帰、長文、集中履歴の100ページ分割、timezone表示、水平overflowなしを確認した。

## 検出・修正と視覚確認

初回測定は`.lakda/report-acceptance-npjJ0T/result.json`へ保持した（SHA-256 `748d5b7fa82a04f0379014ddf1d812d42a2cda2ce10937970cce91f2f7511ea1`）。Chrome／Edgeの390px・200%で詳細の水平overflowを検出し、この実行をpass扱いにしなかった。長いIDの折返し、pagerの折返し、狭幅時のinput最小幅と集計列を修正し、195 CSS pxの回帰testが失敗からpassへ変わることを確認した。修正後は別directoryで全測定を実施した。

全ページ画像は縦長になるため、Edgeの390px・200%についてviewportの画像も補足した。scroll後の通常captureで白紙が保存された例は残し、browser surface captureとdialogの実測位置を確認した。dialogはlayout座標x=19、y=16、幅157、高さ390で、中央のhit testがDIALOG、active elementが「詳細を閉じる」であった。`visual-g6GbXx/detail-surface.png`でID・本文の折返しと閉じるbuttonを目視した（SHA-256 `08f875c3f0f9e9ddb82da3227396f0b749be44c637910a9e08def959e5cd7e49`）。実機画像ではない。

## 証跡と残り

修正後の結果は`.lakda/report-acceptance-OYuroh/result.json`、SHA-256 `d814c55667532739816f860aa1a6eff904cde4a08fbf48ea6a60642ef508037e`。入力manifest digest、各生成sampleとreceipt、bundle file digest、browser version／zoom／全sample／失敗理由を保存した。同directory内の`distributed/moved-bundle/index.html`と`concentrated/moved-bundle/index.html`が移動後の閲覧用成果物である。

- `npm run check`: exit 0、356 tests（2.3分）、docs／型／lint／buildもpass。log `.lakda/report-acceptance-check.log`、SHA-256 `82ba88fa79c133ff22a586f036e39177dd9ad09425584c180e0746a103e8aaa8`。
- `npm run acceptance:reports`: exit 0。log `.lakda/report-acceptance-final.log`、SHA-256 `ca5f2e98bc32bc8d2291a47adc8cd97a57c1800ffbafc522e36f33ce1f4cda04`。
- offline `npm run pack:check`: exit 0、466 files・50 schemas、隔離installの通常／batch／未確定run／署名済み媒体／媒体対応を維持。log `.lakda/report-acceptance-pack-check.log`、SHA-256 `b5f4d659fccc62be59e57f13b6dbbc5744a78d68f7d97052919a66aaba09bf97`。

これらはlocal補助証跡であり、logは再実行で更新され得る。最大byte容量の全境界、指定browserでの媒体選択／再生位置の全組合せ、fixed SHA・指定runtimeでのrelease受入、実環境・manual-bb・外部QEGは残る。全体ACの完了チェックは変更しない。
