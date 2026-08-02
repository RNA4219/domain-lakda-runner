---
task_id: TASK.20260802-59
intent_id: INT-LAKDA-FAILURE-CAPTURE-001
status: reviewing
owner: RNA4219
created_at: 2026-08-02
updated_at: 2026-08-02
priority: P1
depends_on: []
---

# Task Seed: non-pass画面証跡・WebM保持policy

## Objective

browser起動後のnon-passで既存screenshot／traceを維持し、通常runでは人間が再生可能なWebMを既定で保持する。回帰replay、実LLM full profile、full fixture acceptanceでは録画負荷を避ける。

## Scope

In: deterministic／adaptive Playwright、config schema、Artifact Policy、HATE/v1登録、文書、契約テスト。Out: Airtest/Poco bridgeの録画実装、Security target録画、直前N秒の循環buffer、外部process起動、QEG verdict。

## Requirements

`REQ-FN-009`、`REQ-FN-016`、`REQ-FN-017`、`REQ-SEC-010`、`AC-020`。

## Plan

1. `video=false | true | "retain-on-non-pass"`の後方互換契約を追加し、通常runの既定をnon-pass保持にする。
2. context終了後にWebMをportable連番へ正規化し、最終execution outcomeがpassedならnon-pass保持動画を削除する。
3. `regression-replay`、実LLM `full` profile、full fixture acceptanceを設定値にかかわらず`video=false`にする。
4. deterministic／adaptiveのnon-passでscreenshot、trace、WebM、HATE refを検証する。
5. Skill、README、RUNBOOK、要件、仕様、EVALUATIONチェックリストを同期する。

## Checklist

- [x] 既存`video=true`の全run保持契約を維持する。
- [x] `retain-on-non-pass`のpassed削除とnon-pass保持を実装する。
- [x] 通常runの既定を`retain-on-non-pass`にする。
- [x] `regression-replay`、実LLM `full` profile、full fixture acceptanceを設定値にかかわらず`video=false`にする。
- [x] Playwright一時名を`0001.webm`からのportable pathへ正規化する。
- [x] videoをsanitized bundleとGitへ含めない境界を文書化する。
- [x] local Gateと差分監査を再実行する。
- [ ] commit後の対象revisionへ証跡を固定する。

## Tests

- config schemaの正常／未知mode拒否、通常既定、regressionの明示値上書きoff。
- deterministic既定passedのWebM 0件、`video=true`のpassed保持、既定failedの連番WebM／HATE video ref。
- real LLM profileの`full=false`、worker-smoke/custom=`retain-on-non-pass`。
- adaptive failedのscreenshot／trace／連番WebM／HATE video ref。
- typecheck、lint、build、全Playwright suite、docs、package。

## Evidence

- 対象working tree: base revision `1f8bc0d7d0895d002f35c82f9e4c31d6b1fe9bc1` + 本Taskの未commit差分。
- `npm run check`: pass（docs contract、typecheck、lint、build、Playwright 205/205）。
- `npm run acceptance:adaptive`: pass（132/132）。
- `npm run acceptance:fixture`: pass（`overall=true`、critical golden 30/30、manifest 215/215）。
- `npm run pack:check`: pass（259 files、isolated install、CLI help、package import）。初回はsandbox外npm cacheへの書込みがEPERMとなり、許可されたsandbox外再実行で確認した。
- lakda-maintainer Skillの`quick_validate.py`: pass（`Skill is valid!`）。
- `git diff --check`: pass。

## External acceptance

実target、manual-bb、QEGは未実施で`pending_external`。本記録はproduction Goを表さない。

## Notes

`retain-on-non-pass`はrun中の録画を成功時に破棄する方式であり、直前N秒だけを保持する真のring bufferではない。fixture証跡を実target受入へ昇格せず、LakdaはQEG verdictを生成しない。

なお、探索v1の後続変更（session HATE、five-lane aggregator、native scope/profile固定）を含む現行worktreeでは、上記Evidenceの件数は履歴値であり、最新revisionのGate結果を示さない。最新の検証結果は作業完了時に別途固定する。
