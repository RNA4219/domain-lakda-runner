---
document_id: LAKDA-ATTESTATION-MEDIA-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 検査対象媒体の隔離・採用のローカル検証

[Task 67](../../tasks/TASK.20260910-67.md)と[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)の媒体処理を、HEAD `b027b6ba9797a2a30b5e98008a1cb848c2c81e05`とdirty差分で検証した。[要求／応答受領の先行記録](ATTESTATION-EXCHANGE-20260910.md)から、streamingコピー、隔離元の保持、採用、exchangeのstage／retainまで進めた。通常run／HATE／report v2への接続は残る。

## 確認した動作

- 停止済みsourceをprivate領域へコピーし、size／SHA-256と元fileを再照合した後だけrunから取り除く。容量超過・中断・更新を検出した場合、元fileを保持する。
- sanitizedは署名済みoutputだけを予定pathへ採用する。no-sensitive-contentは検査済みsourceを元pathへ保持する。両方ともprivate sourceを保持し、未署名outputを作らない。
- 保存したrequest／response／receiptと署名を採用時にも確認する。同sizeで内容の違うsource／output、保存後に変わったresponseを拒否する。
- 採用先を上書きせず、private claimで同一requestの採用試行を一度に限定する。確定済みrunと、junctionへ置換されたdirectoryを拒否する。
- コピーの最後の停止／期限確認に失敗した場合、その処理が作った採用先だけを取り除く。既存の採用先とprivate sourceを消さない。
- exchange.stageは隔離後に要求を発行し、retainは応答受領から採用へ進む。受領がresponse-verifiedでも後続停止で採用failedとなるcaseを確認した。

先行testでは、元fileのdigest確認後、最後の停止確認の間に更新された元fileまで削除していた。削除直前にidentity・size・更新時刻を照合する修正を加え、同sizeの更新でも拒否する最終testにした。先行失敗は別logへ保持した。

## 実行結果

| 検証 | 結果 | 範囲 |
|---|---|---|
| 契約・受領・媒体 | 33 tests pass、exit 0 | 契約9件、受領11件、媒体13件。新しい媒体testは実file、人工byte列、一時鍵、制御した停止・clockを使用 |
| npm run check | 392 tests pass、exit 0 | 文書、型、lint、build、既存v1とreportを含む全体回帰 |
| npm run pack:check | 490 files、54 schemas、exit 0 | offline cacheで配布内容・隔離install・既存CLI／bridge／report経路を検証 |

Windows、Node 24.11.0／npm 11.6.1で実行した。宣言runtimeのNode 24.6.0／npm 11.5.1とは異なる。fixtureの人工byte列は画像内容の検査やcodecの検証に使っていない。実画像negative corpus、scanner、実署名operator、実機、手動受入を代替しない。packageのreport試験は既存v1の回帰であり、新v2 report表示の受入ではない。

再実行:

```powershell
npx playwright test tests/attestation-contracts.spec.ts tests/attestation-exchange.spec.ts tests/attestation-media.spec.ts --workers=1
npm run check
npm run pack:check
```

## sourceと証跡のSHA-256

| path | bytes | SHA-256 |
|---|---:|---|
| `src/exploration/attestation-contracts.ts` | 7611 | `26541d8b459056023c42d1bf93dfc349d7e53976b2b8244f4c89452080369fcf` |
| `src/exploration/attestation-response.ts` | 4350 | `d6daa575edbe07ebe3fc712419c41553cf6836a44f44baebeddef94d325b9c0e` |
| `src/exploration/attestation-io.ts` | 6697 | `7fac2961ade4c60df92b7669b3612bc47d3e3025db589602393640a3d5f1d2a8` |
| `src/exploration/attestation-exchange.ts` | 9837 | `324bc0db79a8a2fc78aca8e563342937264b63baa8e8cc8112656f66ad052d3a` |
| `src/exploration/attestation-copy.ts` | 4779 | `531a97ec1f4513b17e272700ea5035d8aa222e1058e19cc9fae11f4e5573db39` |
| `src/exploration/attestation-media.ts` | 5943 | `8c59239a0aea375dfac3657a06f662bed997a000649d15ef3df7f1b3d65dc2f1` |
| `tests/attestation-media.spec.ts` | 14987 | `c7d31871b5d303a2eceaf2d3ac5c76246e7ef6a525a4c7334f08ab69e710e075` |
| `.lakda/attestation-media-boundary-red.log` | 2959 | `17ab15309b919d9d46d048e01a038c13dfd5f5e2e9366a9a442bff0d788fed12` |
| `.lakda/attestation-media-digests-green.log` | 4823 | `1ad0cb6f216c207772978f35edf684652ab217eb29764ec9db68b0b6b1202abf` |
| `.lakda/attestation-media-check.log` | 67100 | `be59205288679db0085cd6124e454897b383d90288095b9ab3735b695c68c372` |
| `.lakda/attestation-media-pack-check.log` | 4420 | `a88efce298b4c0b88d80a64608b82e3fff7d1ac291f43eb223a37d08a6778dd4` |

## 継続する実装

Charterの明示設定と署名済みtargetへのbinding、通常runのcapture停止後への接続、未隔離rawが残る場合のfinalization拒否、HATEへの受領記録保存とv2再照合、sanitized outputに対応する必須媒体判定、report v2読取、期限後の派生bundleが残る。Task 67とAC-UP-003〜005全体は未完了である。
