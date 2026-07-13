# Changelog

## Unreleased

### Added
- v0.2.0向けにArtifact Store、Artifact/Outcome Policy、60秒共有Action Budget、逐次worker batch（`RunBatchResult`）を追加。
- `domSnapshots`のredacted HTML保存、`fixtureResetConfigured`導出、`llm.seed`同期、package/CLI version 0.2.0を追加。


- Chromiumを対象とする安全な決定的実行、replay、artifact/HATE export、ローカルLLM探索のv1 PoC。
- Workflow-cookbookのBirdseye索引、fixture受入記録、GitHub Actions検証。

### Validated

- 実Qwen 3.5-4B（loopback `:8080`）で固定corpus 90 runを実行し、strict JSON、候補外操作0、fallback0、critical 30/30を達成。
- HATE/v1 schema、fixture acceptance、GitHub Actionsのdocs-contract・quality・package-smoke・chromiumを確認。

### Security

- 宣言済みaction catalog・allowlist・入力プロファイル・fixture resetを実行境界で検証。
- ローカルLLMをloopback OpenAI互換APIとstrict JSON decisionに限定。