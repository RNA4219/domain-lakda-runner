# Lakda + manual-bb starter

1. Prepare a feature design in manual-bb; install with `python -m pip install bb-harness`, see `skills/manual-bb-test-harness/SKILL.md` in that repository.
2. Export one charter: `bb-harness export lakda-charter --input manual_case_set.json --charter-id CHARTER-001 --template lakda/charters/charter.template.json --output new-charter`.
3. **Human check required:** approve target URL, allowHosts, scope, stopWhen, duration, executionMode, and signed real target manifest before `lakda explore run --charter new-charter/charter.json`.
4. Inspect findings and promote reproduced failures; store each promotion and artifact in `lakda/traces/<promotionId>/` without rewriting it.
5. Import the report into manual-bb, answer charter questions in session_log, and explicitly choose pass/fail. Let manual-bb/QEG own Gate.
6. Configure the repository variable `LAKDA_BASE_URL`, approve real-target access, and enable `lakda-scheduled.yml` for scheduled replay. The example pins the Lakda source revision; update the SHA after review.

The starter has no actual target, authentication, or storageState. For authorized real targets, replace the loopback fixture values deliberately. Text-only reports are the only uploaded CI output.