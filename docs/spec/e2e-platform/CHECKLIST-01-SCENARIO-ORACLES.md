---
document_id: LAKDA-E2E-CHK-01
status: review-ready
version: 0.1.0-draft
last_updated: 2026-11-17
specification: SPEC-01-SCENARIO-ORACLES.md
---

# CHECKLIST-01-SCENARIO-ORACLES.md

Corresponding specification: [SPEC-01-SCENARIO-ORACLES.md](SPEC-01-SCENARIO-ORACLES.md).

## A. Specification review

- [ ] CHK-E2E-01-S-001 - Requirement owner and safety boundaries approved.
- [ ] CHK-E2E-01-S-002 - Accepted and rejected inputs fully defined.

## B. Implementation and acceptance

| Done | Check | Requirement | Evidence |
|---|---|---|---|
| [ ] | CHK-E2E-01-I-001 | REQ-E2E-01 | Test record pending |
| [ ] | CHK-E2E-01-I-002 | REQ-E2E-01 | CI run SHA pending |
| [ ] | CHK-E2E-01-I-003 | REQ-E2E-01 | External target validation pending |
| [x] | 閉じる操作の直後に非表示を確認し、表示されたままなら失敗を記録する | REQ-E2E-01 | `tests/reviewed-v02.spec.ts` |

## C. Release acceptance

- [ ] CHK-E2E-01-A-001 - Correctness, safety and compatibility proven.
- [ ] CHK-E2E-01-A-002 - No fixture/mock/emulator treated as real evidence.
- [ ] CHK-E2E-01-A-003 - No Lakda Gate verdict or new subprocess/network sender.
