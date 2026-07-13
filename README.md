# domain-lakda-runner

ローカル優先で Chromium を安全かつ再現可能に操作し、再生可能な action sequence と HATE/v1 artifact manifest を生成する runner です。

## 正本

1. [REQUIREMENTS.md](REQUIREMENTS.md) — 規範的な要件
2. [SPECIFICATION.md](SPECIFICATION.md) — CLI、データフロー、LLM契約
3. [BLUEPRINT.md](BLUEPRINT.md) — Workflow-cookbook 形式の実装境界
4. [GUARDRAILS.md](GUARDRAILS.md) — 安全・変更境界
5. [RUNBOOK.md](RUNBOOK.md) — 実行・検証手順
6. [EVALUATION.md](EVALUATION.md) — 受入条件と品質指標
7. [docs/tasks/](docs/tasks/) — 実装Task Seed
8. [docs/BIRDSEYE.md](docs/BIRDSEYE.md) — 依存関係の軽量索引
9. [CHANGELOG.md](CHANGELOG.md) — 変更履歴
10. [docs/completion-record.md](docs/completion-record.md) — v0.2/v1 PoCの完了証跡

`deep-research-report (11).md` は参考資料、`domain-lakda-runner 要件定義報告書.docx` は原資料です。両者は変更せず、正本2文書を優先します。

## 現在の状態

- フェーズ: v0.2.1 PoC hardening 完了（Action Budget・HAR/security・Policy・DOM/異常系）
- 実装対象: Chromium、smoke、seeded-random、regression-replay、`llm-explore`、persona、artifact、HATE/v1 manifest、workers=1..4逐次batch、Action Budget、HAR/security、redacted DOM snapshot
- 非対象: QEG record/Gate生成、Firefox/WebKit、route crawl、form fuzz、visual baseline、並列worker、Classifier/Auth/Doctor/LLM transportの追加分割
- 連携経路: `Lakda → HATE/v1 artifact-manifest → hate export qeg → QEG validate/gate`

## 開発

```powershell
npm ci
npx playwright install chromium
npm run check
```

CLI の公開契約と実行例は [RUNBOOK.md](RUNBOOK.md) を参照してください。
