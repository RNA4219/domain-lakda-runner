# Real SaaS target manifests

このディレクトリの3ファイルは、実SaaS受入の仮想敵（CRM一覧、商品カード、共同作業画面）ごとの接続前契約です。現時点ではすべて `pending_external` であり、URL、認証情報、実行許可を含まないため、受入完了やGate `go` を意味しません。

`run-adaptive-real-acceptance.mjs` を real target に対して実行するには、`LAKDA_ADAPTIVE_TARGET_MANIFEST` が必須です。manifest は、browser/config を読み込む前に schema と `ready` 状態を検証します。さらに config の origin、allow host、mutation allowlist、action contract が manifest と完全に一致しなければ停止します。

`ready` 化は release owner が承認済み非本番環境の以下を入力してから行います。

- HTTPS origin、allow host、path scope、認証元、approval evidence
- reset 手順、kill switch、PII policy
- product の action contract と P0/P1 action ID
- `consensus/v1` readiness と、明示的に許可された network quiet 除外

polling による network quiet 除外は `settleProfile.networkQuietExclusions` だけに path prefix として記録します。real runner は manifest と config の settle policy/readiness が一致した場合だけ、その値を注入します。raw config からの設定や、scope host 外・絶対URLの除外は認めません。実 target が提供されるまでは空配列を維持し、fixture 成功で代替しません。
