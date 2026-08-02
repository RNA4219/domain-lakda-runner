# RC5 実SaaS仮想敵 target manifest

このmanifestは探索能力の受入設計であり、target接続・認証・実行を許可しない。3件すべて`pending_external`であり、owner承認、対象revision、非本番environment、認証境界、許可mutationが揃うまでLakdaは接続しない。

| ID | 仮想敵 | 探索観点 | 必要なscope | 状態 |
|---|---|---|---|---|
| SAAS-ROW-01 | 一覧/業務SaaS | 同名「編集」「削除」が行ごとに並ぶ | rowの安定`data-testid`または公開heading、read-only/非破壊更新fixture | pending_external |
| SAAS-CARD-02 | EC/コンテンツSaaS | 商品/記事cardごとの同名「詳細」「保存」 | cardのstable key、匿名化ID、購入・公開のdeny境界 | pending_external |
| SAAS-SETTINGS-03 | 管理/settings SaaS | tab/menu/icon、非同期save、認証変更 | dialog/tab scope、明示action contract、credential-change deny | pending_external |

## 共通受入条件

- 各targetはcommit/release revision、config digest、scope host、owner、environment、fixture/resetまたはcleanupを明記する。
- ambiguous candidateは実行せず、`coverageDebt`に`reason`、`role`、公開可能な`name`またはhash、`matchedCount`を記録する。
- scope付きlocatorは一意な`data-testid`またはpublic role/name scopeに限る。raw identifier、認証情報、PIIをrecipeやartifactへ含めない。
- mutationはHTML/HTTP等の機械情報またはproduct action contractを優先し、表示文字列推定だけで許可を広げない。
- settle policyはtargetごとに`lightweight-dom/v1`または`dom-network-topology/v2`を固定し、QEG前にmanual-bbで確認する。

## 外部受入の入力

各IDについて、ownerが承認したbase URL、target revision、read-only又は隔離されたtest persona、許可されたmutation kind、network/cleanup policy、manual-bb担当者を提示する。未提示のtargetはP11/QEGの対象外とする。