---
document_id: LAKDA-SPEC-MNT-INDEX
status: review-ready
version: 0.1.0-draft
last_updated: 2026-07-22
requirements: ../../../REQUIREMENTS-MAINTAINABILITY.md
---

# Lakda 保守性・拡張性仕様

各仕様は1件の正本チェックリストと1対1で対応する。実装結果はチェックリストの「証跡」欄にrun ID、artifact path、SHA-256、またはtest recordを記録する。

| 領域 | 仕様 | 正本チェックリスト | 受入 |
|---|---|---|---|
| Repository Governance / Release Profile | [SPEC-01](SPEC-01-REPOSITORY-GOVERNANCE-RELEASE-PROFILE.md) | [CHECKLIST-01](CHECKLIST-01-REPOSITORY-GOVERNANCE-RELEASE-PROFILE.md) | AC-MNT-001〜002 |
| Real Acceptance Core | [SPEC-02](SPEC-02-REAL-ACCEPTANCE-CORE.md) | [CHECKLIST-02](CHECKLIST-02-REAL-ACCEPTANCE-CORE.md) | AC-MNT-003〜004 |
| Registry / LLM Selection | [SPEC-03](SPEC-03-EXTENSION-REGISTRY-LLM-SELECTION.md) | [CHECKLIST-03](CHECKLIST-03-EXTENSION-REGISTRY-LLM-SELECTION.md) | AC-MNT-005〜006 |
| Run Catalog / Graph Comparison | [SPEC-04](SPEC-04-RUN-CATALOG-GRAPH-COMPARISON.md) | [CHECKLIST-04](CHECKLIST-04-RUN-CATALOG-GRAPH-COMPARISON.md) | AC-MNT-007〜008 |
| Module Boundaries / Examples | [SPEC-05](SPEC-05-MODULE-BOUNDARIES-EXAMPLES.md) | [CHECKLIST-05](CHECKLIST-05-MODULE-BOUNDARIES-EXAMPLES.md) | AC-MNT-009〜010 |

関連正本:

- [保守性・拡張性要件](../../../REQUIREMENTS-MAINTAINABILITY.md)
- [Workflow-cookbook実装計画](../../IMPLEMENTATION-PLAN-MAINTAINABILITY.md)
- [current release profile](../../../release-profiles/current.json)
