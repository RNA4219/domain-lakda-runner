---
document_id: LAKDA-SPEC-MNT-004
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
requirements: ../../../REQUIREMENTS-MAINTAINABILITY.md
checklist: CHECKLIST-04-RUN-CATALOG-GRAPH-COMPARISON.md
---

# SPEC-04 Run Catalog / Graph Comparison

対応チェックリスト: [CHECKLIST-04](CHECKLIST-04-RUN-CATALOG-GRAPH-COMPARISON.md)

## Objective

保存済みrunを変更せずに検索・表示・比較し、状態遷移と品質指標の回帰を独立再検証可能にする。

## Primary owner IDs

REQ-MNT-RUN-001, REQ-MNT-RUN-002, REQ-MNT-RUN-003, REQ-MNT-RUN-004, REQ-MNT-RUN-005, REQ-MNT-RUN-006, REQ-MNT-RUN-007

## Public I/O

- `lakda runs list --output-dir <dir>`: 最大100件を開始日時降順、同値時run ID順で返す。
- `lakda runs show --run-dir <dir>`: run metadata、qualification、HATE検証状態、graph/coverage要約を返す。
- `lakda runs compare --base-run-dir <dir> --head-run-dir <dir> [--out <json>]`: canonical comparisonを返す。

出力schemaは`lakda/run-index/v1`、`lakda/run-detail/v1`、`lakda/run-comparison/v1`とする。

## Contract

- list/show/compareは読取専用で、run directory、manifest、metadata、graph、traceを修復・移動・削除しない。
- compareは両runのHATE manifestをschema検証し、portable pathが各run root内にあること、実bytesのsize/SHA-256が一致することを先に確認する。
- graph revisionとfingerprint/canonicalization versionが比較可能な場合だけstate/edgeを差分化する。非互換versionは推測変換せず非0 exitにする。
- 差分はadded/removed/changed state、transition、transition-pair、round-trip、coverage numerator/denominator、outcome、termination reasonをstable sortしたcanonical JSONで保存する。
- 出力にsecret、PII、絶対path、storageState、raw DOM/inputを含めない。範囲外ref、symlink escape、`..` traversalを拒否する。
- delete/prune/upload commandは本改修へ含めない。

## Plan

1. run catalog readerと3 schemaを追加する。
2. HATE/portable path verifierを再利用する。
3. graph/coverage差分をcanonical化する。
4. CLIとtamper/version/traversal negativeを追加する。

## Patch

- 保存runをmigrationしない。
- history比較で未知fieldを黙って欠落させない。
- optional outputだけを新規作成し、入力dirへ書かない。

## Tests

- 0件、1件、100件、101件、同一timestampのlist順序。
- showのmanifest/bytes再照合とredaction。
- state/transition/coverage/outcomeの決定的diff。
- tamper、missing、version mismatch、path traversal。

## Commands

- `npm run test:contracts`
- `npm test`
- `git diff --check`

## Notes

AC-MNT-007、AC-MNT-008は保存証跡の比較能力であり、比較結果自体をdefectまたはrelease verdictへ昇格しない。
