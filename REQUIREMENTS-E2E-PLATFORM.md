---
document_id: LAKDA-REQ-E2E-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-11-17
---

# Lakda E2E Platform requirements

Status: partially implemented; real-target and distribution acceptance pending.

| Requirement | Priority | Repository | Intended result |
|---|---|---|---|
| REQ-E2E-01 | P0 | manual-bb / Lakda | Reviewed scripted scenarios and machine oracle mapping, deterministic code and replay |
| REQ-E2E-02 | P1 | Lakda workflow | Independent scenario fan-out without changing sequential worker contract |
| REQ-E2E-03 | P0/P1 | Lakda | Linux Chromium real test CI; stable distribution and other browsers separately verified |
| REQ-E2E-04 | P1 | Lakda | Read-only cross-run trends with evidence provenance and separate fixture/real series |
| REQ-E2E-05 | P0 | Lakda workflow / caller | Pinned reusable workflow with review and evidence safety checks |

Safety constraints: no Lakda Gate verdict, no LLM pass/fail, no new Lakda
subprocess runner or outbound sender, no fixture/mock/emulator promotion,
only optional schema evolution, no modification of persisted evidence.
Existing chromium.launch and commitSha execFileSync are pre-existing
process-boundary conflicts; this change does not broaden them.

## Runtime screen and API coverage

The owner supplies a versioned screen/API/relation denominator and usage numbers. Runtime browser observations establish reach independently of test verdicts; source strings and old results do not. Mock, real-declared transport and unknown observations remain separate. Every visible observation traces to the same attempt, test revision and digest-verified evidence. Uncovered rows support numeric priority sorting and large inventories use paginated lists and bounded neighborhood diagrams. No request contents, concrete path variables or unknown URLs enter the new observation artifacts. Owner publication policy applies before observation persistence and before every surface list, graph, evidence, aggregate and JSON/HTML export; scoped consoles deny broader evidence routes on the server. Source extraction, production telemetry collection, deployment and authentication/permission changes are outside scope. See [requirements, contracts and compatibility](docs/spec/e2e-platform/SPEC-10-RUNTIME-SURFACE-COVERAGE.md) and [acceptance conditions](docs/spec/e2e-platform/CHECKLIST-10-RUNTIME-SURFACE-COVERAGE.md).

Out of scope (K-01..K-07): exploration charter handoff, Gate accounting,
schedule and summaries, notification and starter pack.

## 製品アーキテクチャに沿ったドメイン被覆（確定）

| ID | 製品担当者が必要とする結果 |
|---|---|
| DOM-01 | 対象製品・版に対して、業務、構成要素、方向付きの連携、そこで保証する振る舞いと出典、対象外の理由を記録できる。ケースがない項目も一覧に残る。 |
| DOM-02 | 振る舞いから受入条件、ケース版、具体的な確認項目、選んだ実行回の証跡をたどれる。通過しただけの構成要素には合格を付けない。 |
| DOM-03 | 対象の振る舞いを一度ずつ数え、設計被覆と今回の判定済み被覆を分ける。合格と不合格はともに判定済みに含める。対象が定義されていなければ被覆率を「算出できない」と示す。 |
| DOM-04 | ケース未設計、設計済みで今回未判定、対象外、対応のないケースを識別する。未報告の再実行に前回の結果を引き継がない。 |

Misskey のお気に入り登録・解除が合格しても、二重登録を拒否する条件は個別に確認するまで未確認として残る。[マッピング仕様と使い方](docs/spec/e2e-platform/SPEC-09-DOMAIN-COVERAGE.md)
