---
document_id: LAKDA-E2E-CHK-04
status: review-ready
version: 0.1.0-draft
last_updated: 2026-11-17
specification: SPEC-04-CROSS-RUN-ANALYTICS.md
---

# CHECKLIST-04-CROSS-RUN-ANALYTICS.md

Corresponding specification: [SPEC-04-CROSS-RUN-ANALYTICS.md](SPEC-04-CROSS-RUN-ANALYTICS.md).

## A. Specification review

- [ ] CHK-E2E-04-S-001 - Requirement owner and safety boundaries approved.
- [ ] CHK-E2E-04-S-002 - Accepted and rejected inputs fully defined.

## B. Implementation and acceptance

| Done | Check | Requirement | Evidence |
|---|---|---|---|
| [ ] | CHK-E2E-04-I-001 | REQ-E2E-04 | Test record pending |
| [ ] | CHK-E2E-04-I-002 | REQ-E2E-04 | CI run SHA pending |
| [ ] | CHK-E2E-04-I-003 | REQ-E2E-04 | External target validation pending |

## C. Release acceptance

- [ ] Import old-dated passing and failing synthetic results. Check saved metadata, run listing, JSON/HTML trend, generated report, and report verification. Confirm the two totals are 163070 and 103305 ms and their nearest-rank median is 103305 ms.
- [ ] Check zero, partially missing, invalid and absent durations, including legacy metadata. Verify only fully measured runs contribute to duration statistics.
- [ ] Require the index label to agree with device, unknown, explicitly browser-measured and native runs. Reject an incompatible label and real-evidence promotion. Confirm old artifacts are byte-identical after reading.
- [ ] Bind the manual-bb cases and execution evidence to the tested PR head. Android provenance coverage uses a synthetic device fixture.

- [ ] CHK-E2E-04-A-001 - Correctness, safety and compatibility proven.
- [ ] CHK-E2E-04-A-002 - No fixture/mock/emulator treated as real evidence.
- [ ] CHK-E2E-04-A-003 - No Lakda Gate verdict or new subprocess/network sender.
