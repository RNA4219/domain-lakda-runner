# Third-Party Notices

## システム構成図

構成図の画面、入力モデル、注文管理の見本は ai-yori-murasaki のコミット `e9a2ca5073abf65fbc286e2c496653768e01bffb` を基にしている。Lakda のナビゲーション、単体 HTML への同梱とテスト結果へのリンクを追加した。Copyright (c) 2026 RNA4219。[移植元](https://github.com/RNA4219/ai-yori-murasaki/tree/e9a2ca5073abf65fbc286e2c496653768e01bffb/ai_yori_murasaki/web)・[MIT ライセンス原文](vendor/architecture/LICENSE)

構成ファイルの YAML 解析には、移植元と同じ js-yaml 4.3.2 を同梱している。単体 HTML にも両方のライセンス原文を含める。[js-yaml](https://github.com/nodeca/js-yaml)・[MIT ライセンス原文](vendor/architecture/yaml/LICENSE)

## Vendored HATE v1 artifact manifest schema

- File: `vendor/hate/v1/artifact-manifest.schema.json`
- Source repository: https://github.com/RNA4219/harness-auto-test-evidence
- Source path: `schemas/HATE/v1/artifact-manifest.schema.json`
- Pinned commit: `3a4b655c2434109e230f8b862a9d5fe14f1c069e`
- SHA-256: `9070bfeef4ecf17f6ba7eda5d7b158e3f54bf5a4577f13387f33d4835b74a263`
- Original license: MIT License
- Preserved license text: `vendor/hate/LICENSE`

The vendored schema is not relicensed under RNA-TPSAL-1.0. Its original MIT
terms remain in force. Ordinary npm dependencies are not reproduced here;
`package-lock.json` and package metadata are the authoritative dependency
records.
