# domain-lakda-runner v0.2.1 / v1 PoC 完了記録

> [!IMPORTANT]
> v0.2.1 release evidence契約は2026-07-14に是正した。旧20-run記録は`worker-smoke`相当でAC-014の補助に限定され、AC-007/AC-010には不適格である。[coverage訂正](acceptance/AC-20260714-02.v021-evidence-contract-correction.md)を正本とする。実staging manual-bbとQEG final Gateが未完了ならreleaseは`hold`である。

- 完了日: 2026-07-13
- 対象: Chromium、smoke、seeded-random、regression-replay、`llm-explore`、HATE/v1 artifact manifest
- コード受入commit: `3d18a7a546786f271287b6b55079f76fa9a8e318`
- v0.2.0実装commit: `00b0fc4d2dc993611c936a80d6a28b7855e9a611`
- v0.2.1 hardening commit: `6fad63bbce5f6876688ca4a5b4ce20078d609d83`
- v0.2.1 docs/acceptance commit: `cecf5a0`
- 受入記録commit: `977369cee6be063923353aa4535524540582b980`
- CI: [run 29228033697](https://github.com/RNA4219/domain-lakda-runner/actions/runs/29228033697)、[run 29228572961](https://github.com/RNA4219/domain-lakda-runner/actions/runs/29228572961) は全job成功。
- v0.2.1 CI: [run 29256031922](https://github.com/RNA4219/domain-lakda-runner/actions/runs/29256031922) はdocs-contract、package-smoke、quality、chromium全job成功。
- v0.2 CI: [run 29243640000](https://github.com/RNA4219/domain-lakda-runner/actions/runs/29243640000) はpackage-smoke、chromium、quality、docs-contract全job成功。

## v0.2.0 / v0.2.1 責務分離・hardening受入

- [Task Seed](tasks/TASK.20260713-05.md): Artifact Store、Artifact/Outcome Policy、Action Budget、逐次worker、DOM redaction、設定正規化。
- [v0.2 fixture record](acceptance/AC-20260713-03.v02-fixture.json): AC-014〜AC-016を含むfixture全体成功。fake LLM workers=2、共有budget、DOM/HATE static登録を契約テストで検証。
- [v0.2.1 fixture record](acceptance/AC-20260713-05.v021-hardening-fixture.json): fixture acceptance全体と`tests/v02.spec.ts`のhardening回帰14件が成功。現行IDではAC-014〜AC-016とAC-019/020（記録時の旧AC-017/018）に対応する。recordには検証時のcommitと`worktreeDirty`を残す。
- [v0.2 実Qwen record](acceptance/AC-20260713-04.v02-real-llm.json): critical 10ケース×2 workerの20 child runs。現行契約では`worker-smoke`相当でAC-014補助のみ。
- [v0.2.1 実Qwen record](acceptance/AC-20260713-06.v021-hardening-real-llm.json): critical 10ケース×2 workerの20 child runs。現行契約では`worker-smoke`相当でAC-014補助のみ。
- [commit 0862714 実Qwen再確認](acceptance/AC-20260714-01.v021-real-llm-0862714.md): 20 child runの実機観測。現行契約では`worker-smoke`相当であり、AC-007/010不適格。five-tool証跡上のmanual-bb/QEG未完了も明記。
- `workers=1`は従来の`RunResult`、`workers>1`は`lakda/run-batch/v1` envelopeを返し、child runだけを永続化する。
## 受入結果

- [fixture受入record](acceptance/AC-20260713-01.fixture.json): 既知欠陥検出率100%、false positive 0%、replay成功率100%、必須artifact欠落率0%、HATE manifest 215/215。
- [実Qwen受入record](acceptance/AC-20260713-02.real-llm.json): 20 decision×3とcritical 10×3の90 runすべてで、strict JSON、提示candidateだけの選択、探索成功、暗黙fallbackなし、critical golden成功を達成。
- 実機recordは、dataset SHA-256、GGUF SHA-256、実model ID、llama-server build、chat template SHA-256、sampling/timeout、実行command、run集計hashを保存する。raw run directoryは保存しない。

## 検証コマンド

```text
npm run check
npm run check:hate
npm run pack:check
npm run acceptance:fixture
npm run acceptance:real-llm:full -- --out=.lakda/reports/full.json --bundle=.lakda/acceptance/full
npm run acceptance:real-llm:worker-smoke -- --out=.lakda/reports/worker-smoke.json --bundle=.lakda/acceptance/worker-smoke
npm run acceptance:verify -- --report=.lakda/reports/full.json --bundle=.lakda/acceptance/full --check-revision
npm run acceptance:verify -- --report=.lakda/reports/worker-smoke.json --bundle=.lakda/acceptance/worker-smoke --check-revision
```

## 境界確認

LakdaはHATE/v1 artifact manifestまでを生成し、QEG record、Gate verdict、QEG用`lakda:` ID、HATE audit recordを生成しない。QEG変換とGate判定は後続のHATE/QEG責務である。

実Qwen受入に用いたlocal llama-serverは、この作業で起動したloopback processである。完了確認後に停止する。

## v0.3.0-rc.1 / P6 opt-in RC

- [P6 RC納品記録](acceptance/AC-20260715-06.p6-rc.md)を正本とする。
- P0〜P6のlocal/fixture Gate、Code-to-gate strict readiness、HATE pinned schema、package security scanを通過したnpm tarballを生成した。
- [公開package manual-bb](acceptance/AC-20260715-13.manual-bb-package-boundary.md)は8/8 pass。初回に検出したruntime HATE schema同梱漏れを修正・再実行した。Airtest/Poco実機、認可済みSecurity target、実ZAP、AC-AE-015/016、実target/device manual-bb、QEG final Gateは`pending_external`であり、production Goではない。
