---
document_id: LAKDA-CHK-MNT-001
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
specification: SPEC-01-REPOSITORY-GOVERNANCE-RELEASE-PROFILE.md
---

# CHECKLIST-01 Repository Governance / Release Profile

対応仕様: [SPEC-01](SPEC-01-REPOSITORY-GOVERNANCE-RELEASE-PROFILE.md)

> 本チェックリストの`[x]`は同一revisionのローカル証跡だけを示します。P7/P11 real target、Airtest/Poco実機、認可済みSecurity target、実Qwen、外部manual-bb、QEGは`pending_external`です。

## A. 仕様完成チェック

- [x] CHK-MNT-001-S-001 — 正本、alias、profile、歴史的artifact境界が定義されている。
- [x] CHK-MNT-001-S-002 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [x] | CHK-MNT-001-I-001 | REQ-MNT-GOV-001 | index/traceability test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-001-I-002 | REQ-MNT-GOV-002 | docs negative test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-001-I-003 | REQ-MNT-GOV-003 | alias/canonical test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-001-I-004 | REQ-MNT-GOV-004 | release profile schema test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-001-I-005 | REQ-MNT-GOV-005 | version/path/check negative | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-001-I-006 | REQ-MNT-GOV-006 | live workflow static check | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-001-I-007 | REQ-MNT-GOV-007 | historical diff audit | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |

## C. 受入Gate

- [x] CHK-MNT-001-A-001 — AC-MNT-001の1対1対応、alias、分岐検出が確認済み。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-001-A-002 — AC-MNT-002のprofile/package一致と過去RC固定値0件が確認済み。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-001-A-003 — 証跡に対象revision、command、artifact pathまたはSHA-256が記録済み。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
