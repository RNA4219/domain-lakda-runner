# Lakda / domain-lakda-runner

Lakda は、Web・ゲーム・セキュリティの操作基盤を共通の状態遷移モデルで探索し、再現可能な証跡を作るテストオーケストレーターです。操作ツールそのものを再実装せず、Playwright、Airtest/Poco、Security bridge を「目と手」として利用します。

## できること

- **Web / SaaS**: Playwright で画面を観測し、安全な操作候補を探索・再生します。
- **ゲーム**: Airtest/Poco の operator-managed loopback bridge を通じて、実機・画面・UI階層を扱います。
- **セキュリティ**: 認可済み対象だけを対象に、認可差分・安全な変異・ZAP候補の再現証跡化を支援します。
- **共通**: 状態 fingerprint、遷移グラフ、seed 付き探索、strict replay、failure shrinking、generic/product/security oracle、HATE/v1 artifact manifest を提供します。

## すぐに試す

```powershell
npm ci
npx playwright install chromium
npm run check
```

ローカルの許可済みWeb対象を smoke 実行する例です。

```powershell
lakda run --base-url http://127.0.0.1:3000 --mode smoke
```

実行後は action sequence、スクリーンショット・trace などのartifact、HATE/v1 manifest が `.lakda/runs/` に保存されます。`adaptive-explore` を使う場合は、先に `lakda.config.json` で adapter、allowlist、停止条件、recovery を明示してください。詳しい手順は [RUNBOOK.md](RUNBOOK.md) を参照してください。

## 安全性

Lakda は探索対象を無制限に操作しません。

- 対象host、操作予算、禁止操作、mutation種別、kill switch を設定で制御します。
- Airtest/Poco と Security bridge は Lakda が外部プロセスを起動せず、operator 管理の loopback endpoint にだけ接続します。
- Security機能は認可済み環境の補助に限定し、本番への攻撃的scanやLLMだけによる脆弱性認定は行いません。
- mock・fixture・状態注入は補助証跡です。実機・実サーバーの受入証跡とは区別します。

## 現在の範囲

- バージョン: `v0.3.0-rc.1`（P6 opt-in release candidate）
- 公開範囲: CLI、adaptive DTO / Adapter SPI、HATE/v1 artifact manifest、schemas
- 公開packageのmanual black-box: 8/8 pass。詳細は [manual-bb記録](docs/acceptance/AC-20260715-13.manual-bb-package-boundary.md) を参照してください。
- 未実施の外部受入: Airtest/Poco実機、認可済みSecurity target、実ZAP、P7 real 16 AC corpus、実target/device manual-bb、QEG final Gate

P7のcase runnerとrunbookは開発・評価用であり、npm packageには含めません。外部受入をfixture結果で完了扱いにしない方針です。

## ドキュメント

| 確認したいこと | 読む資料 |
|---|---|
| 実行方法・CLI・設定 | [RUNBOOK.md](RUNBOOK.md) |
| 現行v1の要件・仕様 | [REQUIREMENTS.md](REQUIREMENTS.md) / [SPECIFICATION.md](SPECIFICATION.md) |
| 適応型探索の追加要件 | [REQUIREMENTS-ADAPTIVE-EXPLORATION.md](REQUIREMENTS-ADAPTIVE-EXPLORATION.md) |
| P8以降の組み合わせ探索・LLM scouting要件ドラフト | [Lakda拡張要件定義書](docs/spec/Lakda拡張要件定義書.md) |
| 適応型探索の仕様・チェックリスト | [docs/spec/adaptive-exploration/](docs/spec/adaptive-exploration/) |
| 受入条件・必要証跡 | [評価仕様](docs/spec/adaptive-exploration/EVALUATION-ADAPTIVE-EXPLORATION.md) |
| 実装計画・Task Seed | [実装計画](docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md) / [docs/tasks/](docs/tasks/) |
| 設計境界・安全方針 | [BLUEPRINT.md](BLUEPRINT.md) / [GUARDRAILS.md](GUARDRAILS.md) |
| 完了・受入証跡 | [docs/acceptance/](docs/acceptance/) / [completion record](docs/completion-record.md) |
| 変更履歴・依存関係 | [CHANGELOG.md](CHANGELOG.md) / [Birdseye](docs/BIRDSEYE.md) |

仕様の正本は、現行v1では [REQUIREMENTS.md](REQUIREMENTS.md) と [SPECIFICATION.md](SPECIFICATION.md)、適応型探索では追加要件と `docs/spec/adaptive-exploration/` 配下の仕様書です。`deep-research-report (11).md` と要件定義報告書は参考資料として扱います。

## 開発・検証

```powershell
npm run check
npm run acceptance:fixture
npm run acceptance:adaptive
npm run pack:check
```

実環境P7の実行条件と証跡要件は [P7 Real Adaptive Acceptance Runbook](docs/acceptance/P7-REAL-ACCEPTANCE-RUNBOOK.md) に固定しています。
