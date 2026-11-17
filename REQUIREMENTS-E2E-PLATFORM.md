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

Out of scope (K-01..K-07): exploration charter handoff, Gate accounting,
schedule and summaries, notification and starter pack.
