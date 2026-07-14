# Changelog

## Unreleased

### Added
- v0.2.0向けにArtifact Store、Artifact/Outcome Policy、60秒共有Action Budget、逐次worker batch（`RunBatchResult`）を追加。
- `domSnapshots`のredacted HTML保存、`fixtureResetConfigured`導出、`llm.seed`同期、package/CLI version 0.2.0を追加。

### Fixed
- HAR保存時に全header値、cookie/Set-Cookie、query値、bodyをredactionし、HATE再exportで生成済み`exports/`を入力artifactから除外してbytesを安定化。
- DOM snapshotで`data-lakda-sensitive`要素の内容・全属性を除去し、保存bytesと最終artifact容量を照合して任意snapshotを安全に除去。
- HATE export失敗時は`artifactManifestPath`を返さず、fixture acceptanceは実行済みhardening回帰スイートの結果と作業ツリー状態を記録。


- Chromiumを対象とする安全な決定的実行、replay、artifact/HATE export、ローカルLLM探索のv1 PoC。
- Workflow-cookbookのBirdseye索引、fixture受入記録、GitHub Actions検証。

### Validated

- 実Qwen 3.5-4B（loopback `:8080`）で固定corpus 90 runを実行し、strict JSON、候補外操作0、fallback0、critical 30/30を達成。
- HATE/v1 schema、fixture acceptance、GitHub Actionsのdocs-contract・quality・package-smoke・chromiumを確認。

### Security

- 宣言済みaction catalog・allowlist・入力プロファイル・fixture resetを実行境界で検証。
- ローカルLLMをloopback OpenAI互換APIとstrict JSON decisionに限定。