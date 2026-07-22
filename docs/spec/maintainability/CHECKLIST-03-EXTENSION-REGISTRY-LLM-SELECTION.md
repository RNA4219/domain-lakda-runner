---
document_id: LAKDA-CHK-MNT-003
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
specification: SPEC-03-EXTENSION-REGISTRY-LLM-SELECTION.md
---

# CHECKLIST-03 Extension Registry / LLM Selection

対応仕様: [SPEC-03](SPEC-03-EXTENSION-REGISTRY-LLM-SELECTION.md)

> 本チェックリストの`[x]`は同一revisionのローカル証跡だけを示します。P7/P11 real target、Airtest/Poco実機、認可済みSecurity target、実Qwen、外部manual-bb、QEGは`pending_external`です。

## A. 仕様完成チェック

- [x] CHK-MNT-003-S-001 — built-in registry、Oracle分離、strict llm-selectが定義されている。
- [x] CHK-MNT-003-S-002 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [x] | CHK-MNT-003-I-001 | REQ-MNT-EXT-001 | registry unknown/capability test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-003-I-002 | REQ-MNT-EXT-002 | arbitrary plugin/process negative | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-003-I-003 | REQ-MNT-EXT-003 | oracle separation test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-003-I-004 | REQ-MNT-EXT-004 | request redaction/schema test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-003-I-005 | REQ-MNT-EXT-005 | response negative corpus | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-003-I-006 | REQ-MNT-EXT-006 | timeout/no-fallback test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-003-I-007 | REQ-MNT-EXT-007 | seed determinism test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-003-I-008 | REQ-MNT-EXT-008 | existing mode regression | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |

## C. 受入Gate

- [x] CHK-MNT-003-A-001 — AC-MNT-005でallowlist registryとOracle/QEG境界を確認した。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-003-A-002 — AC-MNT-006で不正LLM応答100%拒否、random fallback 0件を確認した。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-003-A-003 — decision証跡にraw prompt、secret、PII、実入力がない。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
