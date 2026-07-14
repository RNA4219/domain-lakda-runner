---
document_id: LAKDA-SPEC-AE-INDEX
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-14
requirements: ../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md
---

# Lakda 適応型探索 仕様書群

## 1. 位置づけ

本ディレクトリは、[追加要件](../../../REQUIREMENTS-ADAPTIVE-EXPLORATION.md)をpost-v1実装へ具体化する規範仕様書群である。現行v1の実行、CLI、artifact、Outcome Policyは[現行仕様](../../../SPECIFICATION.md)を正本とし、本仕様書群は既存modeの意味を変更しない。

適応型探索は新しい`adaptive-explore` modeとして定義する。既存`seeded-random`は実行前にaction planを確定するdeterministic modeとして維持する。

## 2. 読み順と一次所有

要件は必ず1冊だけが一次所有する。他仕様書からの参照は許可するが、異なる定義を置いてはならない。

| 順序 | 仕様書 | チェックリスト | 一次所有要件 | 主な受入条件 |
|---:|---|---|---|---|
| 1 | [共通コア](SPEC-01-COMMON-CORE.md) | [CHK-01](CHECKLIST-01-COMMON-CORE.md) | `REQ-CORE-*`, `REQ-OBS-*`, `REQ-ACT-*`, `REQ-ADP-*`, `REQ-SAFE-*` | `AC-AE-001`, `014`, `016` |
| 2 | [状態グラフ・探索](SPEC-02-STATE-GRAPH-EXPLORATION.md) | [CHK-02](CHECKLIST-02-STATE-GRAPH-EXPLORATION.md) | `REQ-FP-*`, `REQ-GRAPH-*`, `REQ-EXP-*`, `REQ-STOP-*`, `REQ-COV-*`, `REQ-REC-*` | `AC-AE-002`〜`007` |
| 3 | [replay・oracle・証跡](SPEC-03-REPLAY-ORACLE-EVIDENCE.md) | [CHK-03](CHECKLIST-03-REPLAY-ORACLE-EVIDENCE.md) | `REQ-INP-*`, `REQ-REP-*`, `REQ-SHR-*`, `REQ-ORC-*`, `REQ-EVD-*` | `AC-AE-009`〜`013` |
| 4 | [Playwright adapter](SPEC-04-PLAYWRIGHT-ADAPTER.md) | [CHK-04](CHECKLIST-04-PLAYWRIGHT-ADAPTER.md) | `REQ-WEB-*`, `REQ-PW-*` | `AC-AE-008`, `010`, `014` |
| 5 | [Airtest/Poco adapter](SPEC-05-AIRTEST-POCO-ADAPTER.md) | [CHK-05](CHECKLIST-05-AIRTEST-POCO-ADAPTER.md) | `REQ-GAME-*` | `AC-AE-015` |
| 6 | [Security adapter](SPEC-06-SECURITY-ADAPTER.md) | [CHK-06](CHECKLIST-06-SECURITY-ADAPTER.md) | `REQ-SECX-*` | `AC-AE-016` |

受入方法、fixture、閾値、必要証跡は[適応型探索評価仕様](EVALUATION-ADAPTIVE-EXPLORATION.md)を正本とする。

## 3. 共通規約

### 3.1 規範語

- `MUST`は対応するMust要件の実装・受入に必須である。
- `SHOULD`は設計へ含めるが、対応milestoneまで未実装を許容する。
- `COULD`は評価後に採否を決め、未実装時はunsupportedとして表現する。
- 未対応capabilityの暗黙fallback、未知schema versionの暗黙変換は禁止する。

### 3.2 文書状態

仕様書の状態は`draft -> review-ready -> approved`とする。

- `draft`: 内容または仕様完成チェックに未完了がある。
- `review-ready`: 対応チェックリストの「A. 仕様完成」がすべて完了している。
- `approved`: ownerのレビュー記録があり、実装Task Seedの入力に使用できる。

チェックリストの「B. 実装・受入」は実装証跡が得られるまで未完了でよい。仕様書が`review-ready`でも、実装・受入の完了を意味しない。

### 3.3 変更管理

契約変更時は同一変更で、一次所有仕様書、対応チェックリスト、評価case、本READMEの一次所有表を更新する。schemaまたは公開CLIを実装済みの場合は実装とTask Seedも更新する。

## 4. 共通データフロー

```text
Adapter.observe
  -> Observation
  -> StateFingerprint / graph node
  -> Adapter.generateCandidates
  -> Core safety + guard
  -> Generator.select
  -> Adapter.execute
  -> settle + re-observe
  -> ExecutionResult / graph edge
  -> generic | product | security OracleResult
  -> EvidenceArtifactRef / HATE-v1 manifest
```

kill switch、scope逸脱、認証喪失、critical failure、artifact/security failureはGeneratorやcoverage達成より優先して停止させる。

## 5. 実装milestoneへの対応

実装の依存順、Task Seed、Acceptance Record、Phase Gateは[適応型探索実装計画](../../IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md)を正本とする。最初の実行単位は[Task Seed 08](../../tasks/TASK.20260714-08.md)である。

| milestone | 仕様入力 | 実装開始条件 |
|---:|---|---|
| 1 契約固定 | SPEC-01、SPEC-03 | 関連仕様approved、schema Task Seed作成済み |
| 2 Playwright観測 | SPEC-01、SPEC-02、SPEC-04 | `AC-AE-001`, `002`, `008`, `014` fixture固定済み |
| 3 地図と再現 | SPEC-02、SPEC-03、SPEC-04 | graph/trace schemaとdivergence oracle固定済み |
| 4 探索評価 | SPEC-02 | Generator/Stopとcoverage分母規則固定済み |
| 5 誘導と復旧 | SPEC-02 | backtrack、timeout、hard capのnegative case固定済み |
| 6 入力と縮約 | SPEC-03 | mutation denyとimmutable parent trace検査固定済み |
| 7 ゲーム | SPEC-05 | Core/Playwright受入済み、opt-in実機corpus利用可能 |
| 8 セキュリティ | SPEC-06 | authorization profileと専用安全試験承認済み |
| 9 外部連携 | SPEC-03、SPEC-06 | HATE/v1投影と候補/確認済み分類固定済み |

## 6. 非対象

- Playwright、Airtest、Poco、ZAPの操作・scan engineの再実装。
- 人手による完全状態遷移図や全path網羅の必須化。
- LLM単独でのfailure、defect、脆弱性、Gate verdict確定。
- 許可のないactive security操作または顧客影響を生むmutation。
- LakdaによるQEG record、approval、waiver、Gate verdictの直接生成。
