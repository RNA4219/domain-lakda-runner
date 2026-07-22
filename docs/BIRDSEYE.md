# Birdseye

Birdseyeは、現行Lakdaの要件、仕様、Task Seed、受入記録、履歴証跡の依存関係を軽量に参照する索引です。

- [index.json](birdseye/index.json) はノードと依存エッジの正本です。
- [hot.json](birdseye/hot.json) は優先読込対象です。
- [caps/](birdseye/caps/) は各ノードのCapsuleです。
- 現行文書入口: [docs index](README.md)、[spec index](spec/README.md)、[task index](tasks/README.md)。
- 保守性要件: [REQUIREMENTS-MAINTAINABILITY](../REQUIREMENTS-MAINTAINABILITY.md)、[実装計画](IMPLEMENTATION-PLAN-MAINTAINABILITY.md)、[仕様とチェックリスト](spec/maintainability/README.md)。
- 現行release候補: [release profile](../release-profiles/current.json)。profileとpackage versionを同時に検証します。
- 履歴証跡: [acceptance index](acceptance/README.md)、[release-gate index](release-gate/README.md)。既存artifactはimmutableです。

更新時は、Workflow-cookbookのCodemapをまずdry-runし、確認後に同じコマンドを実行します。

```powershell
uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps --dry-run
uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps
```
