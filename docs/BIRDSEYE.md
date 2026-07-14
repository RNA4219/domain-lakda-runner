# Birdseye

Birdseyeは、v0.2.1/v0.2.0/v1 PoCの正本・Task Seed・fixture/実LLM受入記録の依存関係を軽量に参照する索引です。

- [index.json](birdseye/index.json) はノードと依存エッジの正本です。
- [hot.json](birdseye/hot.json) は優先読込対象です。
- [caps/](birdseye/caps/) は各ノードのCapsuleです。
- v0.2入口: [TASK.20260713-05.md](tasks/TASK.20260713-05.md)、[fixture](acceptance/AC-20260713-03.v02-fixture.json)、[real LLM](acceptance/AC-20260713-04.v02-real-llm.json)。
- v0.2.1入口: [TASK.20260713-06.md](tasks/TASK.20260713-06.md)、[hardening fixture](acceptance/AC-20260713-05.v021-hardening-fixture.json)、[hardening real LLM](acceptance/AC-20260713-06.v021-hardening-real-llm.json)、[commit 0862714 実機再確認](acceptance/AC-20260714-01.v021-real-llm-0862714.md)。
- v0.2.1証跡是正: [TASK.20260714-07.md](tasks/TASK.20260714-07.md)、[20-run coverage訂正](acceptance/AC-20260714-02.v021-evidence-contract-correction.md)、[RC manual設計](release-gate/manual_case_set.json)、[最終実Qwen 90+20 / RC hold](acceptance/AC-20260714-03.v021-real-llm-eef71cb.md)。

更新時は、Workflow-cookbookのCodemapをまずdry-runし、確認後に同じコマンドを実行します。

```powershell
uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps --dry-run
uv run python -m tools.codemap.update --repo-root C:\Users\ryo-n\Codex_dev\domain-lakda-runner --targets docs/birdseye/index.json,docs/birdseye/hot.json --emit index+caps
```