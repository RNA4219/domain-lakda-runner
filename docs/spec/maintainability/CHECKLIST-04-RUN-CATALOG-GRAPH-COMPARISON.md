---
document_id: LAKDA-CHK-MNT-004
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
specification: SPEC-04-RUN-CATALOG-GRAPH-COMPARISON.md
---

# CHECKLIST-04 Run Catalog / Graph Comparison

対応仕様: [SPEC-04](SPEC-04-RUN-CATALOG-GRAPH-COMPARISON.md)

> 本チェックリストの`[x]`は同一revisionのローカル証跡だけを示します。P7/P11 real target、Airtest/Poco実機、認可済みSecurity target、実Qwen、外部manual-bb、QEGは`pending_external`です。

## A. 仕様完成チェック

- [x] CHK-MNT-004-S-001 — read-only CLI、比較項目、tamper/version/traversal境界が定義されている。
- [x] CHK-MNT-004-S-002 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [x] | CHK-MNT-004-I-001 | REQ-MNT-RUN-001 | read-only list/show test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-004-I-002 | REQ-MNT-RUN-002 | limit/order test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-004-I-003 | REQ-MNT-RUN-003 | HATE bytes/hash preflight | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-004-I-004 | REQ-MNT-RUN-004 | canonical graph diff | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-004-I-005 | REQ-MNT-RUN-005 | tamper/version/traversal negative | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-004-I-006 | REQ-MNT-RUN-006 | schema/redaction test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-004-I-007 | REQ-MNT-RUN-007 | CLI surface negative | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |

## C. 受入Gate

- [x] CHK-MNT-004-A-001 — AC-MNT-007で上限・順序・読取専用を確認した。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-004-A-002 — AC-MNT-008で正常比較と全negativeを確認した。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-004-A-003 — 比較artifactを不具合/QEG verdictとして生成していない。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
