# Birdseye

Birdseyeは、v0.2.0/v1 PoCの正本・Task Seed・fixture/実LLM受入記録の依存関係を軽量に参照する索引です。

- [index.json](birdseye/index.json) はノードと依存エッジの正本です。
- [hot.json](birdseye/hot.json) は優先読込対象です。
- [caps/](birdseye/caps/) は各ノードのCapsuleです。
- v0.2入口: [TASK.20260713-05.md](tasks/TASK.20260713-05.md)、[fixture](acceptance/AC-20260713-03.v02-fixture.json)、[real LLM](acceptance/AC-20260713-04.v02-real-llm.json)。

更新時は、Workflow-cookbookのCodemapをまずdry-runし、確認後に同じコマンドを実行します。

```powershell
uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps --dry-run
uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps
```