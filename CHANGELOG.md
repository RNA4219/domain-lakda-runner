# Changelog

## Unreleased

### Added
- v0.2.0向けにArtifact Store、Artifact/Outcome Policy、60秒共有Action Budget、逐次worker batch（`RunBatchResult`）を追加。
- `domSnapshots`のredacted HTML保存、`fixtureResetConfigured`導出、`llm.seed`同期、package/CLI version 0.2.0を追加。
- `full` 90-runと`worker-smoke` 20-runを固定profile化し、`lakda/real-llm-acceptance/v2` report、sanitized bundle、独立verifierを追加。
- 実GGUF/model/runtime/chat-template attestation、Code-to-gate strict、HATE二段検証、manual-bb staging、QEG final gateを接続するself-hosted RC workflowを追加。

### Fixed
- HAR保存時に全header値、cookie/Set-Cookie、query値、bodyをredactionし、HATE再exportで生成済み`exports/`を入力artifactから除外してbytesを安定化。
- DOM snapshotで`data-lakda-sensitive`要素の内容・全属性を除去し、保存bytesと最終artifact容量を照合して任意snapshotを安全に除去。
- HATE export失敗時は`artifactManifestPath`を返さず、fixture acceptanceは実行済みhardening回帰スイートの結果と作業ツリー状態を記録。
- 既存20-run実Qwen記録をAC-014のworker-smoke補助証跡へ訂正し、AC-007/AC-010への過大なcoverage主張を防止。
- Code-to-gateの既知secret marker/CSS content誤検知を上流回帰fixtureで修正し、LakdaのMedium finding 5件を期限・担当付きでtriage。

### Existing

- Chromiumを対象とする安全な決定的実行、replay、artifact/HATE export、ローカルLLM探索のv1 PoC。
- Workflow-cookbookのBirdseye索引、fixture受入記録、GitHub Actions検証。

### Validated

- 過去のv1 90-runは履歴証跡として保持する。v0.2.1のAC-007/AC-010達成は対象runtime commit上のv2 `full` bundle検証後にのみ主張する。
- 決定的fixture、v2 bundle改ざんテスト、実Code-to-gate→HATE→QEG PoCを検証。実staging manual-bb未提供時のrelease状態は`hold`。
- HATE/v1 schema、fixture acceptance、GitHub Actionsのdocs-contract・quality・package-smoke・chromiumを確認。

### Security

- 宣言済みaction catalog・allowlist・入力プロファイル・fixture resetを実行境界で検証。
- ローカルLLMをloopback OpenAI互換APIとstrict JSON decisionに限定。