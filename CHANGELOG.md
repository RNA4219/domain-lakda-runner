# Changelog

## Unreleased

## 0.4.0-rc.2 - Unreleased

### Added

- release profile v1、P7/P11共通real acceptance、P11 target manifest/candidate audit、Adapter/Generator/Oracle registryを追加。
- `llm-select`のstrict選択、`lakda runs list/show/compare`、sanitized examples、公開run schemaを追加。

### Changed

- Playwright Adapter、Coordinator、Combination、CLIを互換facadeの背後で責務分割し、追加要件に対する変更境界を縮小。
- package、runtime producer、文書、検証profileを`0.4.0-rc.2`へ同期。

### Release Status

- fixtureとローカル自動検証を候補版証跡とし、実target・実機・認可済みsecurity target・manual-bb外部確認・QEGは`pending_external`。
- revision `74a2a9b47cc106795320323a597dfdf5931cbead`の[ローカル受入記録](docs/acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)を追加。manual-bb strict Gateは外部項目未実施により`no_go`。

## 0.4.0-rc.1 - Superseded candidate

### Changed

- ライセンスをRNA Third-Party Service Attribution License 1.0へ変更し、第三者向け有償サービス利用を顧客向け帰属表示付きで許可。
- 帰属表示なしのホワイトラベル利用向けに、別途書面による商用ライセンス導線を追加。
- 過去のMIT版の権利を維持し、v0.3.0-rc.4 / 28bdbd03a14a1228c61f3c23ea88a8c8ce5d934eを最後のMIT tag付きrelease、5f6854145ce0317f6c4d309a2672c530e6c5ac4dを最後にMITで公開されたcommitとして記録。
- LICENSE関連文書とvendored HATE schemaの元MIT LICENSEをnpm packageへ同梱。
- package/release検証で、商用問い合わせ先プレースホルダーの残存とREADME・package metadata・runtime version定数の不一致を拒否。

- P7の固定corpus実環境受入、実機Airtest/Poco、認可済みSecurity target、manual-bb/QEG Gateを継続する。

## 0.3.0-rc.5 - 2026-07-16

### Changed

- 現行source revisionを固定して再検証するrc.5 Gate運用へ更新し、RanD・reference staging・manual-bb・QEGの証跡連鎖を明確化。
- QEGを唯一の最終Go判定として、QEG Go後だけtag/releaseを許可するCI workflowへ更新。
- CLI、artifact、HATE manifest、package検査のruntime producer versionを`0.3.0-rc.5`に統一。
## 0.3.0-rc.4 - 2026-07-16

### Fixed

- ルート直下に残っていた調査報告書と要件定義の元資料を `docs/reference/` に集約し、全相対リンクを更新。
- README、CHANGELOG、package metadata、runtime producer version、release/package検査の版番号を `0.3.0-rc.4` に統一。reference stagingの過去revisionと現行package versionを明確に分離。

## 0.3.0-rc.3 - 2026-07-16

### Fixed

- `--trace` と `--config` のどちらが欠けても target 接続前に fail-closed することを fixture で個別に検証。
- `lakda/investigation/v1` の `traceRef`、`configDigest`、`divergenceReason`、`terminationReason` を公開Schemaへ反映し、portable ref以外を拒否。

## 0.3.0-rc.2 - 2026-07-16

### Added

- P10 strict replayの`scout`、`investigate`、`promote`フローを追加し、同一trace/configを一回だけ再生する調査契約を固定。
- candidate、実行結果、topology、generic/product/security oracle、HATE evidenceの不一致を fail-closed で記録し、再現判定とportable promotionを分離。
- 人間向けREADME、RUNBOOK、拡張仕様書にSkills、HATE、QEGの導線と外部Gate境界を追記。

### Release Status

- P0〜P10のfixture・CI検証を含むopt-in RC。既存modeと`lakda/action-plan/v1`は維持する。
- P7の固定corpus実環境受入、実機Airtest/Poco、認可済みSecurity target、manual-bb/QEG final Gateは`pending_external`であり、production Goを意味しない。

## 0.3.0-rc.1 - 2026-07-15

### Added

- Web・ゲーム・Securityを共通のObservation / ActionCandidate / ExecutionResult / OracleResult / EvidenceArtifact契約で扱う`adaptive-explore`を追加。
- DOM再観測、状態fingerprint/graph、coverage/plateau停止、seed付き未踏優先探索、backtrack、strict replay、failure shrinkingを追加。
- Playwright adapter、operator管理のAirtest/PocoおよびSecurity loopback bridge、Security authorization/rate/concurrency/kill-switch/cleanup、ZAP候補分類を追加。
- 公開package entrypointからadaptive DTO、Adapter SPI、Playwright/Airtest-Poco/Security adapterを利用可能にした。

### Release Status

- P0〜P6のunit/contract/integration/fixture受入を満たすopt-in RC。既存4 modeと`lakda/action-plan/v1`は維持する。
- Airtest/Poco実機、認可済みSecurity target、実ZAP、AC-AE-015/016、manual-bb/QEG final Gateは`pending_external`であり、production Goを意味しない。
- 配布物はsecurity-scan対象のnpm tarball。公開registryへのpublish、Git tag、GitHub Releaseは別承認とする。

## 0.2.1

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
