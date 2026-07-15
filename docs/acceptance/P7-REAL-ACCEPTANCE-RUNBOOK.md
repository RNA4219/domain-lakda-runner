# P7 Real Adaptive Acceptance Runbook

## Status

P7 remains `pending_external`. This runbook defines the operator contract; it does not replace an approved external target, real device, authorized security environment, manual review, or QEG Gate.

## Inputs

The runner fails before loading Lakda or contacting a target unless all inputs are present.

- `LAKDA_ADAPTIVE_REAL_CONFIRM=I_UNDERSTAND`
- `LAKDA_ADAPTIVE_REAL_CONFIG`: an existing `lakda/v1` config with `mode=adaptive-explore` and `baseUrl`; its exact bytes SHA-256 must match the selected corpus case `configDigest`
- `LAKDA_ADAPTIVE_CORPUS_PATH`: an immutable corpus file
- `LAKDA_ADAPTIVE_CASE_ID`: a case ID present in that corpus
- `LAKDA_ADAPTIVE_ENVIRONMENT`: an approved environment label
- `LAKDA_ADAPTIVE_TARGET_REVISION`: an assertion that must exactly match the immutable corpus `targetRevision`

The corpus contract is:

```json
{
  "schemaVersion": "lakda/adaptive-acceptance-corpus/v1",
  "corpusId": "approved-corpus-id",
  "version": "1.0.0",
  "targetRevision": "product-revision-or-app-hash",
  "cases": [
    { "caseId": "web-dom-refresh-001", "acceptanceId": "AC-AE-001", "configDigest": "sha256:<64-lowercase-hex>", "expected": { "outcome": "passed" } }
  ]
}
```

`acceptanceId` must be `AC-AE-001` through `AC-AE-016`; expected outcome must be `passed`, `failed`, `partial`, or `error`. Each case binds the exact config bytes through `configDigest`. The runner derives these values and the target revision from the hashed corpus rather than accepting operator overrides. A revision or config digest mismatch is rejected before config loading or target access. Corpus and report schemas are [adaptive-acceptance-corpus-v1.schema.json](../../schemas/adaptive-acceptance-corpus-v1.schema.json) and [adaptive-acceptance-case-v1.schema.json](../../schemas/adaptive-acceptance-case-v1.schema.json).

## Execution

```powershell
$env:LAKDA_ADAPTIVE_REAL_CONFIRM = "I_UNDERSTAND"
$env:LAKDA_ADAPTIVE_REAL_CONFIG = "C:\approved\lakda.real.json"
$env:LAKDA_ADAPTIVE_CORPUS_PATH = "C:\approved\adaptive-corpus.json"
$env:LAKDA_ADAPTIVE_CASE_ID = "web-dom-refresh-001"
$env:LAKDA_ADAPTIVE_ENVIRONMENT = "staging-chromium"
$env:LAKDA_ADAPTIVE_TARGET_REVISION = "product-revision-or-app-hash"
npm run acceptance:adaptive:real
```

Run one process per case. Do not run the command against production or an unapproved device/host. Security cases additionally require the authorization record, scope, rate/concurrency limits, cleanup reference, and kill-switch reference in the Lakda config.

## Suite Verification

After every case report is reviewed into an explicit relative-path index, run the read-only suite verifier.

```json
{
  "schemaVersion": "lakda/adaptive-acceptance-suite-index/v1",
  "suiteId": "approved-suite-id",
  "version": "1.0.0",
  "reports": [
    { "path": "runs/run-id/adaptive/acceptance-case-web-dom-refresh-001.json", "sha256": "sha256:<64-lowercase-hex>" }
  ]
}
```

```powershell
$env:LAKDA_ADAPTIVE_SUITE_INDEX = "C:\approved\adaptive-suite-index.json"
npm run acceptance:adaptive:verify-real
```

The verifier checks index/report schemas, report SHA-256, case report revision/config binding, final HATE manifest identity, every referenced artifact byte size and SHA-256, unique case IDs, and coverage of all `AC-AE-001` through `AC-AE-016`. Its successful status is only `ready_for_manual_bb_qeg`; `p7Status` and `qegHandoff.status` remain `pending_external`, and `verdictGeneratedByLakda` remains `false`. The index and readiness schemas are [adaptive-acceptance-suite-index-v1.schema.json](../../schemas/adaptive-acceptance-suite-index-v1.schema.json) and [adaptive-acceptance-suite-readiness-v1.schema.json](../../schemas/adaptive-acceptance-suite-readiness-v1.schema.json).

## Evidence Conditions

A case is eligible only when all of the following hold:

- execution mode is `real`, the target revision and approved environment are recorded, and the corpus bytes SHA-256 is recorded;
- the selected case exists in the immutable corpus, the asserted target revision exactly matches the corpus `targetRevision`, the config bytes match the case `configDigest`, and its expected outcome matches the actual Lakda outcome;
- the HATE/v1 manifest passes schema validation, matches run ID/attempt, and every artifact size and SHA-256 matches its current bytes;
- exactly one `adaptive/oracle-results.jsonl` artifact is referenced;
- `adaptive/acceptance-case-<caseId>.json` passes `lakda/adaptive-acceptance-case/v1`, reuses HATE/v1 artifact refs, contains every required case field, and is itself included in the regenerated HATE manifest;
- mock/simulated runs, missing artifacts, infrastructure errors, digest mismatches, or outcome mismatches are not counted as pass;
- Lakda records only the case verdict. HATE/manual-bb/QEG remain external, and Lakda must not generate a QEG verdict, approval, waiver, or record.

AC-AE-015 additionally requires approved real-device evidence. AC-AE-016 additionally requires an approved real security target plus explicit human/oracle confirmation; scanner or LLM output alone remains a candidate. P7 may move from `pending_external` only after all 16 AC reports and the downstream HATE/manual-bb/QEG evidence are reviewed and approved.

## Five-Tool Gate Status

| Step | Status | Evidence |
|---|---|---|
| RanD | degraded | Repository requirements/specification are available; no new RanD packet was produced. |
| Code-to-gate | ready | Static gate can run after the external corpus/config are fixed. |
| HATE | ready | The runner validates and regenerates HATE/v1 for each real case. |
| manual-bb | pending_external | Real target/device observations and oracle review are unavailable. |
| QEG | pending_external | Final bundle, policy, approval, and Gate verdict are external. |
