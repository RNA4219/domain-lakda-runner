# Historical: P6 RC workflow

[保存したworkflow](release-p6-rc.yml.txt)は旧P6（`0.3.0-rc.1`）向けの納品処理です。2026-09-10に実行可能なworkflowから外しました。現在のcheckoutを過去の版番号で検査・記録する固定値が残っていたため、運用入口を[current release profile](../../../release-profiles/current.json)と[release-evidence.yml](../../../.github/workflows/release-evidence.yml)へ統一しました。

## 保存した内容と来歴

| 項目 | 値 |
|---|---|
| 元path | `.github/workflows/release-p6-rc.yml` |
| 調査・退避時のbase revision | `b027b6ba9797a2a30b5e98008a1cb848c2c81e05` |
| 元fileの最終変更commit | `b2ab91ec933670191d9de53b522952b61ed1b836` |
| 元Git blob（SHA-1） | `5f977cca806fc066866f702ae8653fb893393d8a` |
| 保存したcheckout bytes | 2,631 bytes、UTF-8、CRLF |
| 保存fileのSHA-256 | `afdd0092f07960f002eaf474a1029e88486112a02457729f5d7f4b9653178cba` |

Git blobの識別値とcheckoutのSHA-256は計算対象が異なります。退避前後の実bytesとSHA-256を照合したうえで元pathを除去しました。保存fileの内容は変更せず、`.gitattributes`で改行変換を停止しています。元workflowの`workflow_dispatch`等は履歴として残りますが、この`.txt`はGitHub Actionsの実行対象ではありません。

`npm run check:docs`は保存bytesのdigest、archiveの存在、旧workflowの再導入、live workflow内の旧P6納品契約を検査します。過去のtag・release・artifact・Acceptance・QEGはそのまま保持します。この保存は現行版のGate成功を示しません。
