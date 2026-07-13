# domain-lakda-runner v1 PoC 完了記録

- 完了日: 2026-07-13
- 対象: Chromium、smoke、seeded-random、regression-replay、`llm-explore`、HATE/v1 artifact manifest
- コード受入commit: `3d18a7a546786f271287b6b55079f76fa9a8e318`
- 受入記録commit: `977369cee6be063923353aa4535524540582b980`
- CI: [run 29228033697](https://github.com/RNA4219/domain-lakda-runner/actions/runs/29228033697)、[run 29228572961](https://github.com/RNA4219/domain-lakda-runner/actions/runs/29228572961) は全job成功。

## 受入結果

- [fixture受入record](acceptance/AC-20260713-01.fixture.json): 既知欠陥検出率100%、false positive 0%、replay成功率100%、必須artifact欠落率0%、HATE manifest 215/215。
- [実Qwen受入record](acceptance/AC-20260713-02.real-llm.json): 20 decision×3とcritical 10×3の90 runすべてで、strict JSON、提示candidateだけの選択、探索成功、暗黙fallbackなし、critical golden成功を達成。
- 実機recordは、dataset SHA-256、GGUF SHA-256、実model ID、llama-server build、chat template SHA-256、sampling/timeout、実行command、run集計hashを保存する。raw run directoryは保存しない。

## 検証コマンド

```text
npm run check
npm run check:hate
npm run acceptance:fixture -- --out=docs/acceptance/AC-20260713-01.fixture.json
npm run acceptance:real-llm -- --out=docs/acceptance/AC-20260713-02.real-llm.json
```

## 境界確認

LakdaはHATE/v1 artifact manifestまでを生成し、QEG record、Gate verdict、QEG用`lakda:` ID、HATE audit recordを生成しない。QEG変換とGate判定は後続のHATE/QEG責務である。

実Qwen受入に用いたlocal llama-serverは、この作業で起動したloopback processである。完了確認後に停止する。