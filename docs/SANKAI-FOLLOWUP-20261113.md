---
document_id: LAKDA-SANKAI-REVIEW-20261113
status: reviewing
last_updated: 2026-11-13
---

# Sankai 2026-11-13: 要確認・判断待ち

この記録は、文書パッチ10本に伴う判断待ちと未検証を示す。**ユーザーが判断するまでは元のstatus、見直し日、契約記述を変更しない。** `fixture` / `mock` 成功を実環境受入に読み替えない。過去の `docs/release-gate` と `docs/acceptance` の証跡は変更しない。

## 1. 見直し期限の警告12件: 全件未決

| 対象 | 2026-11-13確認時status | next_review_due | 判断依頼 |
|---|---|---|---|
| `docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md` | `draft` | 2026-09-01 | 継続するならレビュー後に日付更新／終了なら根拠に沿ってstatus整理 |
| `docs/IMPLEMENTATION-PLAN-LAKDA-EXTENSION.md` | `implementation-baseline` | 2026-08-14 | 同上 |
| `docs/tasks/TASK.20260712-00.md` | `in_progress` | 2026-08-12 | 同上 |
| `docs/tasks/TASK.20260712-01.md` | `in_progress` | 2026-08-12 | 同上 |
| `docs/tasks/TASK.20260714-12.md` | `in_progress` | 2026-08-14 | 同上 |
| `docs/tasks/TASK.20260714-25.md` | `in_progress` | 2026-08-14 | 同上 |
| `docs/tasks/TASK.20260712-02.md` | `planned` | 2026-08-12 | 同上 |
| `docs/tasks/TASK.20260712-03.md` | `planned` | 2026-08-12 | 同上 |
| `docs/tasks/TASK.20260714-30.md` | `pending_external` | 2026-08-14 | 外部受入未完了ならstatusを維持して期限を見直す |
| `docs/tasks/TASK.20260714-34.md` | `pending_external` | 2026-08-14 | 同上 |
| `docs/tasks/TASK.20260714-35.md` | `pending_external` | 2026-08-14 | 同上 |
| `docs/tasks/TASK.20260715-42.md` | `pending_external` | 2026-08-14 | 同上 |

更新日を機械的に先送りして期限警告を消すことはしない。各文書の実際の到達状態を確認した上で、個別承認が必要。

## 2. REQUIREMENTS-MAINTAINABILITY.md

`status: review-ready`、`version: 0.1.0-draft`、一方で `HUB.codex.md` の文書優先順位では「現行正本」と記載。レビュー完了・規範化・ドラフトのまま現行作業基準のどれとするかの決定待ち。元の値は保持。

## 3. BLUEPRINT.md

冒頭に v1〜v0.2.1 の歴史的設計境界であると明記するパッチを適用するが、本文はChromium時代の構成が中心。現行multi-adapter設計の正本をここへ移すか、歴史文書として凍結するか判断待ち。本文を無断拡張しない。

## 4. docs/tasks/README.md

見出しは `現行 0.5.0-rc.1`、`package.json` は `0.5.0-rc.2`。単なるバージョン表示の古さと考えられるが、Task索引の適用範囲も見直すか判断待ち。まだ変更しない。

## 5. GUARDRAILS.md と3本の要件・仕様文書

`REQUIREMENTS.md`、`SPECIFICATION.md`、`REQUIREMENTS-ADAPTIVE-EXPLORATION.md` の本文を確認。allow host、deny、mutation、budget、kill switch、HATE/QEG責務および実環境/fixture区別について直接の矛盾は確認していない。ただし、新設されたbridge（loopback/JSON/1 MiB/redirect）、全Security candidateのpermit binding、binary artifact外部attestorの詳細は3本文だけでは完全な規範対応表を構成できない。既存のpost-v1仕様書・実装・テストとの突合は保留。より厳しいGUARDRAILSの停止条件は緩めない。

## 6. README.md 外部リンクとバッジ

- **決定済み（2026-11-13）:** ユーザー指定の正本は `https://github.com/RNA4219/domain-lakda-runner`。独立リポジトリ `https://github.com/RNA4219/workflow-agent-evidence` は404かつ本人に心当たりがないため参照しない。なお `workflow-agent-evidence` は `workflow-cookbook/skills/` 配下のSkillとしては存在するが、ユーザーの削除指示に合わせREADMEのSkill表から当該行ごと削除し、代替リンクは追加しない。
- `https://img.shields.io/badge/reference_staging_600a037-QEG_go-1f883d` はURL構文を確認したが、この環境では実際の画像表示/HTTP成功を確認できていない。リンク先の `docs/release-gate/qeg-600a037/gate-verdict.json` はGitHub上に存在し、履歴のrevisionは `600a037efec8617d2090b1c8be408a1d1b9b1c5a`。画像はブラウザで要確認。

## CIと受入の確認条件

- Windows CIの6 job（`python-bridge`、`python-bridge-dependencies`、`docs-contract`、`quality`、`chromium`、`package-smoke`）はGitHub PR上で実行結果を検証する。SHA固定の`uses`、`docs-contract:10` / `quality:15` / `package-smoke:20` のtimeoutは静的検査済みだが実測はしていない。
- 実target、実LLM、実機、manual-bb、外部QEGをこの文書パッチで完了扱いしない。現行候補 `0.5.0-rc.2` は `pending_external`。

## GitHub反映時の判断

- 2026-11-13: maintainerからPR作成・マージまでの実施を承認された。
- 実環境/外部受入はこの変更で承認しない。12件の期限警告、および設計文書の正本性等は別途判断を要する。
- Birdseyeの索引・capsuleは手作業で差分を同期した。Codemap CLIによる再生成は実施できていないため、次のフルcheckout作業でdry-runと正規更新を行う。
