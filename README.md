# domain-lakda-runner

ローカル優先で Chromium を安全かつ再現可能に操作し、再生可能な action sequence と HATE/v1 artifact manifest を生成する runner です。

## 正本

1. [REQUIREMENTS.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/REQUIREMENTS.md) — 現行v1の規範的な要件
2. [SPECIFICATION.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/SPECIFICATION.md) — 現行v1のCLI、データフロー、LLM契約
3. [REQUIREMENTS-ADAPTIVE-EXPLORATION.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/REQUIREMENTS-ADAPTIVE-EXPLORATION.md) — post-v1適応型探索・共通コアの追加要件ドラフト
4. [docs/spec/adaptive-exploration/](https://github.com/RNA4219/domain-lakda-runner/tree/main/docs/spec/adaptive-exploration) — post-v1の6仕様書・対応チェックリスト・一次所有表
5. [EVALUATION-ADAPTIVE-EXPLORATION.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/docs/spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md) — post-v1の16受入条件と必要証跡
6. [IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) — post-v1のWorkflow-cookbook実装計画とPhase Gate
7. [BLUEPRINT.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/BLUEPRINT.md) — Workflow-cookbook 形式の実装境界
8. [GUARDRAILS.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/GUARDRAILS.md) — 安全・変更境界
9. [RUNBOOK.md](RUNBOOK.md) — 実行・検証手順
10. [EVALUATION.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/EVALUATION.md) — 現行v1の受入条件と品質指標
11. [docs/tasks/](https://github.com/RNA4219/domain-lakda-runner/tree/main/docs/tasks) — 実装Task Seed
12. [docs/BIRDSEYE.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/docs/BIRDSEYE.md) — 依存関係の軽量索引
13. [CHANGELOG.md](CHANGELOG.md) — 変更履歴
14. [docs/completion-record.md](https://github.com/RNA4219/domain-lakda-runner/blob/main/docs/completion-record.md) — v0.2/v1 PoCの完了証跡

`deep-research-report (11).md` は参考資料、`domain-lakda-runner 要件定義報告書.docx` は原資料です。両者は変更せず、現行v1は `REQUIREMENTS.md` と `SPECIFICATION.md`、post-v1適応型探索は追加要件ドラフトと対応する仕様書群を優先します。

## 現在の状態

- フェーズ: v0.3.0-rc.1 / P6 opt-in release candidate
- 実装対象: 既存v0.2.1機能に加え、`adaptive-explore`、状態fingerprint/graph/coverage、seed付き探索、strict replay、failure shrinking、Playwright adapter、Airtest/Poco loopback bridge、認可済みSecurity bridge/race/cleanup、generic/product/security oracle分離
- 配布境界: CLI、公開adaptive DTO/Adapter SPI、HATE/v1証跡、schemas。P7 case runnerと受入runbookは開発・評価用でnpm packageには含めない
- 本証跡未完了: Airtest/Poco実機、認可済みSecurity target、実ZAP、固定16 AC corpus、manual-bb/QEG final Gate。fixtureだけで完了扱いにしない
- 非対象: QEG record/Gate生成、Airtest/ZAP機能自体の再実装、本番への攻撃的scan、LLM単独の不具合・脆弱性認定
- 連携経路: `Lakda → HATE/v1 artifact-manifest → hate export qeg → QEG validate/gate`

## 開発

```powershell
npm ci
npx playwright install chromium
npm run check
```

CLI の公開契約と実行例は [RUNBOOK.md](RUNBOOK.md) を参照してください。
