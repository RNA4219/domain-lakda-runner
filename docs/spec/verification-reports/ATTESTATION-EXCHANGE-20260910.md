---
document_id: LAKDA-ATTESTATION-EXCHANGE-20260910
status: local-evidence
last_updated: 2026-09-10
---

# 媒体検査要求・応答受領のローカル検証

対象は`b027b6ba9797a2a30b5e98008a1cb848c2c81e05`とdirty作業差分。[Task 67](../../tasks/TASK.20260910-67.md)、[SPEC-02](SPEC-02-NATIVE-EVIDENCE.md)の要求／応答契約とprivate file受領を検証した。AC-UP-003〜005の補助証跡であり、媒体bytesの採用、通常runへの接続、実scanner・実機受入の完了記録ではない。

## 実装と確認範囲

- request v1にrun／session、target manifest、source、予定output、policy、UUID nonce、共通期限を固定する。response v2はrequest全体とdigest、source／output、scan／tool／policy、完了日時を署名対象に含む。
- 許可されたEd25519公開鍵を使い、別run／target／policy、source／output不一致、署名の改変、不正key、期限切れ、scan failを拒否する。旧v1をv2へ変換しない。
- 公開run外へ固有directoryを作り、canonical JSON fileを上書き不可で保存する。公開要求の改変、二重発行、同一requestの並行／再受領、非canonical応答、finalized run内の処理を拒否する。
- run内の媒体で待機期限を共有し、単調時計にも上限を固定する。停止と期限を応答読取後・署名検証後にも確認する。AbortSignalでの停止はfixture実測で1秒以内。
- receipt v1は`response-verified`と拒否／期限切れ／停止／I/O errorを区別する。応答digest・受領時刻のnull条件、固定reason、日時順序を検証する。`response-verified`だけで媒体採用の成功とは扱わない。

停止確認の追加前には、検証中の停止で`response-verified`を返すtestが失敗した。修正後は停止・期限の両方を拒否した。先行失敗ログを上書きせず保存している。

## 実行結果

| 検証 | 実結果 | 範囲 |
|---|---|---|
| 契約／受領／schema catalog | 21 tests pass、exit 0 | 新しい契約9件、private file受領11件、全schemaのcompile 1件 |
| npm run check | 379 tests pass、exit 0 | 文書、型、lint、build、既存v1を含む全体回帰 |
| npm run pack:check | 484 files、54 schemas、exit 0 | offline cacheで配布内容と隔離installを検証。CLI／package import／bridge／通常・batch・未確定・署名媒体・関連媒体reportがpass |

Node 24.11.0／npm 11.6.1、Windowsで実行した。宣言runtimeのNode 24.6.0／npm 11.5.1とは異なる。packageの媒体report検証は既存v1の回帰であり、新v2の媒体採用・report表示を確認したものではない。

再実行:

```powershell
npx playwright test tests/attestation-contracts.spec.ts tests/attestation-exchange.spec.ts tests/schema-catalog.spec.ts --workers=1
npm run check
npm run pack:check
```

## sourceと証跡のSHA-256

| path | bytes | SHA-256 |
|---|---:|---|
| `src/exploration/attestation-contracts.ts` | 7611 | `26541d8b459056023c42d1bf93dfc349d7e53976b2b8244f4c89452080369fcf` |
| `src/exploration/attestation-response.ts` | 4350 | `d6daa575edbe07ebe3fc712419c41553cf6836a44f44baebeddef94d325b9c0e` |
| `src/exploration/attestation-io.ts` | 4750 | `6dc048db0f6e148a7d08b6a8ce890f568a31b0d5abe3be2d070fa8d4a845029b` |
| `src/exploration/attestation-exchange.ts` | 7524 | `a9051929449f093e63b053526570ccb22ab6fe2af2b1f828d931c9aaace24a38` |
| `schemas/lakda-binary-attestation-request-v1.schema.json` | 1705 | `135a295bb0b5f1911e593c8f3f5a13ad4698200324070351bba2b9b0580dee05` |
| `schemas/lakda-binary-artifact-attestation-v2.schema.json` | 2652 | `d6324f4e651033c19351a16b34bf1b998cd555fa941853b7288fdd0f56ca782b` |
| `schemas/lakda-binary-attestation-receipt-v1.schema.json` | 1972 | `3d2ec612b5ff5f6b9bca77afa906649e72dffa92be90d7ab9b49d76ea382d5da` |
| `tests/attestation-contracts.spec.ts` | 10360 | `5bbece43ba4358069fa3b8c0cf1c08ab3b3b370203ddbe6a461640a5417bca31` |
| `tests/attestation-exchange.spec.ts` | 9378 | `c324a096cfd137fabd1a5cd3174ed5c159dfab4e073aa17b259b41fa4f1a9d95` |
| `.lakda/attestation-exchange-boundary-red.log` | 2726 | `325bef9c5d3d8c6f3c3fdb6d67847e66e9560c2317039bace3b6aa9c52410917` |
| `.lakda/attestation-receipt-green.log` | 3249 | `6724e05568348c75124458e048de8610c77d5ee8d47729e4ee6ba1906bbc3d43` |
| `.lakda/attestation-exchange-check.log` | 65278 | `e1f6584bae7aedae42150e29c43c73cd11a10a12263fef236382acdbdd207926` |
| `.lakda/attestation-exchange-pack-check.log` | 4420 | `bdd02bf4dc256a8fb44711d9a66d98ecc66244f74c77ab1ca4dcd15bb14dfb84` |

## 残る実装・受入

撮影完了後の実媒体隔離、source／output bytesの照合と採用、Charter設定と署名済みtargetへのbinding、core finalizationの直列化、HATEの最終記録、v2 report読取、期限後の明示的な派生bundleが残る。現在の内部モジュールは通常runから呼ばれていない。実scanner／署名operatorとの接続、実画像negative corpus、人間による確認、実機3lane、固定SHAの統合受入も未実施。Task 67と対応AC全体は未完了として維持する。
