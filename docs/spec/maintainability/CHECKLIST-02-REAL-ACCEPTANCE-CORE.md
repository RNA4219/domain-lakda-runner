---
document_id: LAKDA-CHK-MNT-002
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
specification: SPEC-02-REAL-ACCEPTANCE-CORE.md
---

# CHECKLIST-02 Real Acceptance Core

対応仕様: [SPEC-02](SPEC-02-REAL-ACCEPTANCE-CORE.md)

> 本チェックリストの`[x]`は同一revisionのローカル証跡だけを示します。P7/P11 real target、Airtest/Poco実機、認可済みSecurity target、実Qwen、外部manual-bb、QEGは`pending_external`です。

## A. 仕様完成チェック

- [x] CHK-MNT-002-S-001 — preflight順、終了code、v1/v2互換、HATE再照合が定義されている。
- [x] CHK-MNT-002-S-002 — Workflow-cookbookのPlan/Patch/Tests/Commands/Notesがある。

## B. 実装・受入チェック

| 完了 | チェックID | 要件ID | 検証方法 | 証跡 |
|---|---|---|---|---|
| [x] | CHK-MNT-002-I-001 | REQ-MNT-ACC-001 | shared core contract test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-002-I-002 | REQ-MNT-ACC-002 | pre-connect preflight negative | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-002-I-003 | REQ-MNT-ACC-003 | exit 0/1/2 test | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-002-I-004 | REQ-MNT-ACC-004 | P11 v2 candidate audit | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-002-I-005 | REQ-MNT-ACC-005 | P7/P11 legacy compatibility | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |
| [x] | CHK-MNT-002-I-006 | REQ-MNT-ACC-006 | HATE tamper/path traversal | [AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md) |

## C. 受入Gate

- [x] CHK-MNT-002-A-001 — AC-MNT-003で入力欠落時の接続0回、exit 2、pending_externalを確認した。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-002-A-002 — AC-MNT-004でv2 audit、HATE tamper拒否、v1読取互換を確認した。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
- [x] CHK-MNT-002-A-003 — real target未実施をfixture成功で完了扱いしていない。（[AC-20260722-20](../../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)）
